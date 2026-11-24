import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { UserRepository } from '@/db/repositories/user-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { decryptText, encryptText } from '@/lib/crypto';
import { readStageAgent } from '@/lib/xiaok-v1/stage-workflow-settings';
import type { StageId } from '@/lib/xiaok-v1/stages';
import { fail } from '../contracts';
import { authorizeKnowledgeManager } from '../knowledge/manager';
import { weixinClient, weixinOrigin, type WeixinLogin } from './ilink';
import { wechatSubject } from './subject';

export type ChannelRow = {
  id: string; enterprise_id: string; stage_id: StageId; status: 'pending' | 'connected' | 'closed';
  login_state: string | null; qr_secret: string | null; expires_at: string | null;
  api_origin: string; bot_id: string; peer_id: string; bot_secret: string;
  user_id: string; conversation_id: string | null; lease_id: string | null; cursor_value: string;
  last_poll_at: string | null; last_reply_at: string | null; last_error: string | null;
};

export type ChannelView = {
  id: string; status: 'pending' | 'connected' | 'closed'; loginState: string | null;
  qr: string | null; expiresAt: string | null; lastPollAt: string | null; lastReplyAt: string | null; error: string | null;
};
type Scope = { enterpriseId: string; adminId: string; stage: StageId };

function qr(row: ChannelRow): WeixinLogin { return JSON.parse(decryptText(row.qr_secret)); }
const iso = (value: string | null) => value ? new Date(value).toISOString() : null;
function view(row?: ChannelRow): ChannelView | null {
  if (!row) return null;
  const expired = row.status === 'pending' && Date.parse(row.expires_at!) <= Date.now();
  return { id: row.id, status: expired ? 'closed' : row.status, loginState: expired ? 'expired' : row.login_state,
    qr: !expired && row.status === 'pending' ? qr(row).display : null, expiresAt: iso(row.expires_at),
    lastPollAt: iso(row.last_poll_at), lastReplyAt: iso(row.last_reply_at), error: row.last_error };
}

function managed<T>(scope: Scope, work: (tx: PostgresTransaction) => Promise<T>) {
  return withTenantTransaction(scope.enterpriseId, async tx => {
    await authorizeKnowledgeManager(tx, scope.enterpriseId, scope.adminId);
    return work(tx);
  });
}
function current(tx: PostgresTransaction, scope: Scope) {
  return one<ChannelRow>(tx, sql`select * from app.assistant_wechat_channels where enterprise_id=${scope.enterpriseId}
    and stage_id=${scope.stage} order by created_at desc,id desc limit 1 for update`);
}
export async function closeChannel(tx: PostgresTransaction, row: ChannelRow, reason: string) {
  if (row.conversation_id && row.status === 'connected') {
    // Cancel queued work and release its slot. Already-dispatched usage follows the normal reconciliation path.
    const { cancelRuns } = await import('../core/conversation');
    await cancelRuns(tx, wechatSubject(row), row.conversation_id);
  }
  await tx.execute(sql`update app.assistant_wechat_events set status=case when status='sending' then 'unknown' else 'failed' end,
    text_value=null, context_secret=null where channel_id=${row.id} and enterprise_id=${row.enterprise_id}
    and status in ('received','running','sending')`);
  return (await one<ChannelRow>(tx, sql`update app.assistant_wechat_channels set status='closed', login_state=${reason},
    qr_secret=null,expires_at=null,bot_id=null,peer_id=null,bot_secret=null,cursor_value='',lease_id=null,
    last_error=null where id=${row.id} and enterprise_id=${row.enterprise_id} returning *`))!;
}

export async function closeStageWechatChannel(tx: PostgresTransaction, enterpriseId: string, stage: StageId) {
  const row = await one<ChannelRow>(tx, sql`select * from app.assistant_wechat_channels
    where enterprise_id=${enterpriseId} and stage_id=${stage} and status<>'closed' for update`);
  if (row) await closeChannel(tx, row, 'disabled');
}

export function readChannel(scope: Scope) {
  return managed(scope, async tx => view(await current(tx, scope)));
}
export async function startChannel(scope: Scope, client = weixinClient) {
  // Only serialize QR creation for this enterprise/stage. QR status long-polling happens outside transactions.
  return managed(scope, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'wechat:' + scope.enterpriseId + ':' + scope.stage},0))`);
    const agent = await readStageAgent(tx, scope.enterpriseId, scope.stage);
    if (!agent?.enabled) fail('wechat_stage_disabled');
    const previous = await current(tx, scope);
    if (previous && view(previous)?.status !== 'closed') return view(previous);
    if (previous?.status === 'pending') await closeChannel(tx, previous, 'expired');
    const login = await client.login();
    return view(await one<ChannelRow>(tx, sql`insert into app.assistant_wechat_channels
      (enterprise_id,stage_id,status,login_state,qr_secret,expires_at,api_origin)
      values(${scope.enterpriseId},${scope.stage},'pending','wait',${encryptText(JSON.stringify(login))},now()+interval '5 minutes',${weixinOrigin}) returning *`));
  });
}
export async function pollChannel(scope: Scope, channelId: string, pin?: string, client = weixinClient) {
  const pending = await managed(scope, async tx => {
    const row = await current(tx, scope);
    if (!row || row.id !== channelId) fail('version_conflict');
    return row;
  });
  if (view(pending)?.status !== 'pending') return view(pending);
  const result = await client.status(pending.api_origin, qr(pending).code, pin);
  return managed(scope, async tx => {
    const row = await current(tx, scope);
    if (!row || row.id !== channelId) fail('version_conflict');
    if (row.status !== 'pending' || row.api_origin !== pending.api_origin || row.login_state !== pending.login_state) return view(row);
    if (Date.parse(row.expires_at!) <= Date.now() || result.state === 'expired') return view(await closeChannel(tx, row, 'expired'));
    if (result.state === 'already_bound') return view(await closeChannel(tx, row, 'already_bound'));
    if (result.state === 'confirmed') {
      if (!(await readStageAgent(tx, scope.enterpriseId, scope.stage))?.enabled) return view(await closeChannel(tx, row, 'disabled'));
      // This channel subject has no Mini Program OpenID, credentials, administrator role or project membership.
      const subject = await new UserRepository(tx).create({ enterpriseId: BigInt(scope.enterpriseId), nickname: '微信 ClawBot 咨询' });
      return view(await one<ChannelRow>(tx, sql`update app.assistant_wechat_channels set status='connected', login_state=null,
        bot_secret=${encryptText(result.token)}, bot_id=${result.bot}, peer_id=${result.peer}, user_id=${subject.id},
        api_origin=${result.origin}, qr_secret=null,expires_at=null where id=${row.id} returning *`));
    }
    const state = result.state === 'redirect' ? 'scanned' : result.state === 'wait' ? row.login_state : result.state;
    return view(await one<ChannelRow>(tx, sql`update app.assistant_wechat_channels set login_state=${state},
      api_origin=${result.state === 'redirect' ? result.origin : row.api_origin} where id=${row.id} returning *`));
  });
}
export function disconnectChannel(scope: Scope, channelId: string) {
  return managed(scope, async tx => {
    const row = await current(tx, scope);
    if (!row || row.id !== channelId) fail('version_conflict');
    return view(row.status === 'closed' ? row : await closeChannel(tx, row, 'disconnected'));
  });
}
