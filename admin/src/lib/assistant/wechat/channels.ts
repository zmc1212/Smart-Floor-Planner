import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { one } from '@/db/repositories/assistant-repository';
import { UserRepository } from '@/db/repositories/user-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { decryptText, encryptText } from '@/lib/crypto';
import type { FollowupAudience } from '@/lib/construction/report-scope';
import { readStageAgent } from '@/lib/xiaok-v1/stage-workflow-settings';
import type { StageId } from '@/lib/xiaok-v1/stages';
import { AssistantError, fail, principalKey } from '../contracts';
import { mainRelease } from '@/lib/xiaok-v1/main-publication';
import { checkRecipient, miniUser, resolveRecipient, savedRecipient, type Recipient, type RequestedRecipient } from './recipient';
import { authorizeKnowledgeManager } from '../knowledge/manager';
import { weixinClient, weixinOrigin, type WeixinLogin } from './ilink';
import { wechatSubject } from './subject';

export type ChannelRow = {
  id: string; enterprise_id: string; stage_id: StageId | 'main'; status: 'pending' | 'connected' | 'closed';
  recipient_key: string | null; recipient_binding_id: string | null; project_id: string | null; mini_user_id: string | null;
  recipient_audience: FollowupAudience | null;
  identity_version: number | null; recipient_requires_service: boolean; verified_at: string | null; recipient_version: number;
  pair_secret: string | null; pair_until: string | null; latest_context: string | null; daily_since: string | null; weekly_since: string | null;
  login_state: string | null; qr_secret: string | null; expires_at: string | null;
  api_origin: string; bot_id: string; peer_id: string; bot_secret: string;
  user_id: string; conversation_id: string | null; lease_id: string | null; cursor_value: string;
  last_poll_at: string | null; last_reply_at: string | null; last_error: string | null;
};

export type ChannelView = {
  id: string; status: 'pending' | 'connected' | 'closed'; loginState: string | null;
  qr: string | null; expiresAt: string | null; lastPollAt: string | null; lastReplyAt: string | null; error: string | null;
};
export type Scope = { enterpriseId: string } & ({ adminId: string; stage: StageId | 'main'; recipient?: never } |
  { stage: 'main'; recipient: RequestedRecipient; adminId?: never });

function qr(row: ChannelRow): WeixinLogin { return JSON.parse(decryptText(row.qr_secret)); }
export const pairDigest = (value:string) => createHash('sha256').update(value).digest('hex');
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
    if (scope.recipient) {
      if (scope.recipient.actor.enterpriseId !== scope.enterpriseId) fail('settings_enterprise_changed');
    } else await authorizeKnowledgeManager(tx, scope.enterpriseId, scope.adminId);
    // Publishing can close or pause channels. Keep its publication → channel lock order.
    if (scope.stage === 'main') await mainRelease(tx, scope.enterpriseId);
    return work(tx);
  });
}

async function recipientOf(tx: PostgresTransaction, scope: Scope) {
  return scope.recipient && (await resolveRecipient(tx, scope.recipient)).recipient;
}

async function matchesRecipient(tx: PostgresTransaction, row: ChannelRow, recipient: Recipient) {
  if (row.recipient_key !== principalKey(recipient.actor) || row.identity_version !== recipient.actor.contextVersion) return false;
  if (row.recipient_binding_id === recipient.bindingId && row.project_id === recipient.projectId
    && row.recipient_audience === (recipient.audience ?? null)) return true;
  if (!recipient.audience || row.recipient_audience || !row.project_id) return false;
  // Let the role entry manage a still-authorized legacy subscription without widening it.
  const legacy = savedRecipient({ ...row, verified_at: row.verified_at ?? new Date().toISOString() });
  if (!legacy) return false;
  try {
    const binding = await checkRecipient(tx, legacy);
    return binding?.audience === recipient.audience;
  } catch (error) {
    if (error instanceof AssistantError && [401, 403, 404, 409].includes(error.status)) return false;
    throw error;
  }
}
function current(tx: PostgresTransaction, scope: Scope) {
  return one<ChannelRow>(tx, sql`select * from app.assistant_wechat_channels where enterprise_id=${scope.enterpriseId}
    and stage_id=${scope.stage} and ${scope.recipient ? sql`mini_user_id=${miniUser(scope.recipient.actor)}` : sql`recipient_key is null`}
    order by (status<>'closed') desc,created_at desc,id desc limit 1 for update`);
}
async function targetEnabled(tx: PostgresTransaction, scope: Scope) {
  return scope.stage === 'main' ? (await mainRelease(tx, scope.enterpriseId))?.enabled :
    (await readStageAgent(tx, scope.enterpriseId, scope.stage))?.enabled;
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
    last_error=null,pair_secret=null,pair_digest=null,pair_until=null,latest_context=null,verified_at=null,daily_since=null,weekly_since=null,
    recipient_version=recipient_version+1 where id=${row.id} and enterprise_id=${row.enterprise_id} returning *`))!;
}

export async function closeStageWechatChannel(tx: PostgresTransaction, enterpriseId: string, stage: StageId) {
  const row = await one<ChannelRow>(tx, sql`select * from app.assistant_wechat_channels
    where enterprise_id=${enterpriseId} and stage_id=${stage} and status<>'closed' for update`);
  if (row) await closeChannel(tx, row, 'disabled');
}

export function readChannel(scope: Scope) {
  return managed(scope, async tx => {
    const row = await current(tx, scope);
    const recipient = await recipientOf(tx, scope);
    return row && recipient && !await matchesRecipient(tx, row, recipient) ? null : view(row);
  });
}
export async function startChannel(scope: Scope, client = weixinClient) {
  // Only serialize QR creation for this enterprise/stage. QR status long-polling happens outside transactions.
  return managed(scope, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'wechat:' + scope.enterpriseId + ':' + scope.stage},0))`);
    if (!await targetEnabled(tx, scope)) fail('wechat_stage_disabled');
    const previous = await current(tx, scope);
    const recipient = await recipientOf(tx, scope);
    if (recipient?.audience && !(await mainRelease(tx, scope.enterpriseId))?.reports) fail('wechat_stage_disabled');
    if (previous && view(previous)?.status !== 'closed') {
      if (recipient && !await matchesRecipient(tx, previous, recipient)) fail('context_changed');
      return view(previous);
    }
    if (previous?.status === 'pending') await closeChannel(tx, previous, 'expired');
    const code = recipient ? randomBytes(8).toString('hex').toUpperCase() : null;
    const login = await client.login();
    return view(await one<ChannelRow>(tx, sql`insert into app.assistant_wechat_channels
      (enterprise_id,stage_id,status,login_state,qr_secret,expires_at,api_origin,recipient_key,recipient_binding_id,project_id,mini_user_id,
        identity_version,recipient_requires_service,pair_secret,pair_digest,pair_until,recipient_audience)
      values(${scope.enterpriseId},${scope.stage},'pending','wait',${encryptText(JSON.stringify(login))},now()+interval '5 minutes',${weixinOrigin},
        ${recipient ? principalKey(recipient.actor) : null},${recipient?.bindingId ?? null},${recipient?.projectId ?? null},
        ${recipient ? miniUser(recipient.actor) : null},${recipient?.actor.contextVersion ?? null},${!!recipient?.actor.customerServiceRequired},
        ${code ? encryptText(code) : null},${code ? pairDigest(code) : null},now()+interval '15 minutes',${recipient?.audience ?? null}) returning *`));
  });
}
export async function pollChannel(scope: Scope, channelId: string, pin?: string, client = weixinClient) {
  const pending = await managed(scope, async tx => {
    const row = await current(tx, scope);
    if (!row || row.id !== channelId) fail('version_conflict');
    const recipient = await recipientOf(tx, scope);
    if (recipient && !await matchesRecipient(tx, row, recipient)) fail('context_changed');
    return row;
  });
  if (view(pending)?.status !== 'pending') return view(pending);
  const result = await client.status(pending.api_origin, qr(pending).code, pin);
  return managed(scope, async tx => {
    const row = await current(tx, scope);
    if (!row || row.id !== channelId) fail('version_conflict');
    const recipient = await recipientOf(tx, scope);
    if (recipient && !await matchesRecipient(tx, row, recipient)) fail('context_changed');
    if (row.status !== 'pending' || row.api_origin !== pending.api_origin || row.login_state !== pending.login_state) return view(row);
    if (Date.parse(row.expires_at!) <= Date.now() || result.state === 'expired') return view(await closeChannel(tx, row, 'expired'));
    if (result.state === 'already_bound') return view(await closeChannel(tx, row, 'already_bound'));
    if (result.state === 'confirmed') {
      if (!await targetEnabled(tx, scope)) return view(await closeChannel(tx, row, 'disabled'));
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
    await recipientOf(tx, scope);
    return view(row.status === 'closed' ? row : await closeChannel(tx, row, 'disconnected'));
  });
}

type RecipientAction = {kind:'state'} | {kind:'renew'} | {kind:'upgrade'} | {kind:'preferences'; daily:boolean; weekly:boolean};
export function recipientState(requested: RequestedRecipient, action: RecipientAction = {kind:'state'}, expected?: {id:string;version:number}) {
  const scope = {enterpriseId:requested.actor.enterpriseId,stage:'main' as const,recipient:requested};
  return managed(scope,async tx => {
    let row = await current(tx,scope);
    const { recipient, binding } = await resolveRecipient(tx, requested);
    const app = await mainRelease(tx,scope.enterpriseId);
    const base = { published:!!app?.enabled, reports:!!app?.enabled && app.reports, audience: binding.audience as FollowupAudience };
    if (!row || row.status === 'closed') return {...base,channel:null};
    const match = await matchesRecipient(tx, row, recipient);
    if (action.kind !== 'state') {
      if (!expected || expected.id !== row.id || expected.version !== row.recipient_version) fail('version_conflict');
      if (!match || !base.published) fail('context_changed');
      if (action.kind === 'renew') {
        if (row.verified_at) fail('context_changed');
        const code=randomBytes(8).toString('hex').toUpperCase();
        row = (await one<ChannelRow>(tx,sql`update app.assistant_wechat_channels set pair_secret=${encryptText(code)},pair_digest=${pairDigest(code)},
          pair_until=now()+interval '15 minutes',recipient_version=recipient_version+1 where id=${row.id} returning *`))!;
      } else if (action.kind === 'upgrade') {
        if (!recipient.audience || row.recipient_audience || !row.verified_at || !base.reports || row.status !== 'connected')
          fail('context_changed');
        row = (await one<ChannelRow>(tx, sql`update app.assistant_wechat_channels set
          recipient_audience=${recipient.audience},recipient_binding_id=${recipient.bindingId},project_id=null,
          recipient_requires_service=${!!recipient.actor.customerServiceRequired},daily_since=null,weekly_since=null,
          recipient_version=recipient_version+1 where id=${row.id} returning *`))!;
      } else {
        if (!row.verified_at || !base.reports || row.status !== 'connected') fail('context_changed');
        row = (await one<ChannelRow>(tx,sql`update app.assistant_wechat_channels set
          daily_since=case when ${action.daily} then coalesce(daily_since,now()) end,
          weekly_since=case when ${action.weekly} then coalesce(weekly_since,now()) end,recipient_version=recipient_version+1 where id=${row.id} returning *`))!;
      }
    }
    const publicState = view(row)!;
    return {...base,channel:{...publicState,qr:match ? publicState.qr : null,id:row.id,version:row.recipient_version,match,
      scope: match ? row.recipient_audience ? 'role' as const : 'project' as const : 'unverified' as const,
      verified:match && !!row.verified_at,daily:match && !!row.daily_since,weekly:match && !!row.weekly_since,
      command:match && row.pair_secret && row.pair_until && new Date(row.pair_until).getTime()>Date.now() ? '绑定 '+decryptText(row.pair_secret) : null}};
  });
}
