import { sql } from 'drizzle-orm';
import { AssistantRepository, one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { decryptText, encryptText } from '@/lib/crypto';
import { resolveWorkerDeployment } from '@/lib/xiaok-v1/worker-runtime-config';
import { AssistantError, safeText, type MessageContent } from '../contracts';
import { ConversationService } from '../core/conversation';
import { projectMessage } from '../knowledge/sources';
import { closeChannel, type ChannelRow } from './channels';
import { weixinClient } from './ilink';
import { wechatSubject } from './subject';

type Event = { id: string; event_key: string; context_secret: string; text_value: string | null;
  status: 'received' | 'running' | 'sending'; run_id: string | null };
type Reply = { event: Event; notice?: string; output?: { id: string; seq: string; conversation: string } };
const unavailable = '小K暂时无法回答这个问题，请稍后再试。';
const withdrawn = '这条答复的依据已不可用，请重新提问。';

function account(c: ChannelRow) {
  return { origin: c.api_origin, token: decryptText(c.bot_secret), peer: c.peer_id, bot: c.bot_id };
}
function locked<T>(lease: ChannelRow, work: (tx: PostgresTransaction, c: ChannelRow) => Promise<T>) {
  return withTenantTransaction(lease.enterprise_id, async tx => {
    const c = await one<ChannelRow>(tx, sql`select * from app.assistant_wechat_channels
      where enterprise_id=${lease.enterprise_id} and id=${lease.id} and lease_id=${lease.lease_id} and status='connected' for update`);
    if (c) return work(tx, c);
  });
}
async function finish(tx: PostgresTransaction, c: ChannelRow, id: string, status: 'sent' | 'failed' | 'unknown', error: string | null) {
  await tx.execute(sql`update app.assistant_wechat_events set status=${status},context_secret=null,text_value=null
    where enterprise_id=${c.enterprise_id} and channel_id=${c.id} and id=${id}`);
  await tx.execute(sql`update app.assistant_wechat_channels set last_error=${error},
    last_reply_at=case when ${status}='sent' then now() else last_reply_at end where id=${c.id}`);
}

async function prepare(tx: PostgresTransaction, c: ChannelRow, event: Event): Promise<Reply | null> {
  // An interrupted send has no trustworthy receipt. A second send could duplicate a real reply.
  if (event.status === 'sending') {
    await finish(tx, c, event.id, 'unknown', 'wechat_delivery_unknown');
    return null;
  }
  const actor = wechatSubject(c);
  const repo = new AssistantRepository(tx, actor);
  await repo.settings(true);
  if (event.status === 'running') {
    const run = await one(tx, sql`select r.status,r.output_message_id,m.seq from app.assistant_runs r
      left join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.output_message_id
      where r.enterprise_id=${c.enterprise_id} and r.conversation_id=${c.conversation_id} and r.id=${event.run_id}`);
    if (run && ['running','queued'].includes(String(run.status))) return null;
    if (run?.status === 'succeeded' && run.output_message_id && run.seq)
      return { event, output: { id: String(run.output_message_id), seq: String(run.seq), conversation: c.conversation_id! } };
    return { event, notice: unavailable };
  }
  if (event.text_value === null) return { event, notice: '这个微信入口支持文字提问，请把问题写成文字发给小K。' };
  if (['Reset','/reset'].includes(event.text_value)) {
    await tx.execute(sql`update app.assistant_wechat_channels set conversation_id=null where id=${c.id}`);
    return { event, notice: '已开启新对话。' };
  }
  const service = new ConversationService(actor, tx);
  let conversation = c.conversation_id;
  if (!conversation) {
    conversation = String((await service.create('wechat-create:' + event.id)).id);
    await tx.execute(sql`update app.assistant_wechat_channels set conversation_id=${conversation} where id=${c.id}`);
  }
  const sent = await service.send(conversation, 'wechat-msg:' + event.event_key, { version: 1, blocks: [{ type: 'text', text: event.text_value }] });
  if (!sent.runId) return { event, notice: unavailable };
  await tx.execute(sql`update app.assistant_wechat_events set status='running',run_id=${sent.runId},text_value=null where id=${event.id}`);
  return null;
}

async function send(lease: ChannelRow, reply: Reply, client: typeof weixinClient) {
  const { output, event } = reply;
  let checked = '';
  if (output) {
    // Use the same authorized projection as the client, including live web-source checks.
    const page = await new ConversationService(wechatSubject(lease)).messages(output.conversation, String(BigInt(output.seq) + 1n), 1);
    const message = page.items.find(m => m.id === output.id && m.authorKind === 'assistant' && m.available);
    if (message) checked = safeText(message.content as MessageContent);
  }
  const armed = await locked(lease, async (tx, c) => one(tx, sql`update app.assistant_wechat_events set status='sending'
    where id=${event.id} and channel_id=${c.id} and status in ('received','running') returning id`));
  if (!armed) return;
  // Keep the binding and current source locks through the short send. Disconnect cannot
  // acknowledge completion halfway through an already-started delivery.
  await locked(lease, async (tx, c) => {
    const repo = new AssistantRepository(tx, wechatSubject(c));
    await repo.settings(true, 'share');
    let text = reply.notice ?? withdrawn;
    if (output && checked) {
      const conversation = await repo.conversation(output.conversation, 'share');
      const raw = await one(tx, sql`select * from app.assistant_messages where enterprise_id=${c.enterprise_id}
        and conversation_id=${output.conversation} and id=${output.id} and author_kind='assistant' for share`);
      const current = raw && await projectMessage(tx, repo.actor, conversation, raw);
      if (current?.available && safeText(current.content as MessageContent) === checked) text = checked;
    }
    try {
      await client.reply(account(c), decryptText(event.context_secret), 'xiaok-' + c.id + '-' + event.id, text);
    } catch (error) {
      const code = error instanceof AssistantError ? error.code : 'wechat_delivery_unknown';
      const rejected = code === 'wechat_provider_rejected' || code === 'wechat_login_invalid';
      await finish(tx, c, event.id, rejected ? 'failed' : 'unknown', rejected ? code : 'wechat_delivery_unknown');
      if (code === 'wechat_login_invalid') await closeChannel(tx, c, 'login_invalid');
      return;
    }
    await finish(tx, c, event.id, 'sent', null);
  });
}

async function take(enterpriseId: string) {
  return withTenantTransaction(enterpriseId, tx => one<ChannelRow>(tx, sql`update app.assistant_wechat_channels c
    set lease_id=gen_random_uuid(),poll_after=now()+interval '120 seconds' from (
      select ch.id from app.assistant_wechat_channels ch
      join app.enterprises e on e.id=ch.enterprise_id and e.status='active'
      join app.assistant_enterprise_settings s on s.enterprise_id=ch.enterprise_id and s.enabled
      left join app.assistant_stage_agents a on a.enterprise_id=ch.enterprise_id and a.stage_id=ch.stage_id
      where ch.enterprise_id=${enterpriseId} and ch.status='connected' and coalesce(a.enabled,true)
      and ch.poll_after<=now() order by ch.poll_after limit 1 for update of ch skip locked
    ) available where c.id=available.id returning c.*`));
}
export async function tickWechatChannel(enterpriseId: string, client = weixinClient) {
  const lease = await take(enterpriseId);
  if (!lease) return false;
  let backoff = 1;
  try {
    const event = await locked(lease, (tx, c) => one<Event>(tx, sql`select * from app.assistant_wechat_events
      where enterprise_id=${enterpriseId} and channel_id=${c.id} and status in ('received','running','sending') order by id limit 1`));
    if (event) {
      let reply;
      try { reply = await locked(lease, (tx, c) => prepare(tx, c, event)); }
      catch (err) {
        if (!(err instanceof AssistantError) || err.code === 'conversation_busy') throw err;
        // The admission transaction rolled back. Report the actual failure without feeding it to the model.
        const text = err.code === 'assistant_quota_exceeded' ? '本企业的小K用量已达上限，请稍后再试。'
          : err.code === 'invalid_message' ? '这条消息超出了小K可处理的文字长度，请分开发送。' : unavailable;
        reply = { event, notice: text };
      }
      if (reply) {
        const { gate } = await resolveWorkerDeployment();
        if (gate.status === 'open' && gate.enterpriseId === enterpriseId) await send(lease, reply, client);
      }
    } else {
      const updates = await client.updates(account(lease), lease.cursor_value);
      await locked(lease, async (tx, c) => {
        for (const message of updates.messages) {
          await tx.execute(sql`insert into app.assistant_wechat_events(enterprise_id,channel_id,event_key,text_value,context_secret)
            values(${enterpriseId},${c.id},${message.key},${message.text},${encryptText(message.context)})
            on conflict (channel_id,event_key) do nothing`);
        }
        // Advancing the cursor and recording the entire page are one commit.
        await tx.execute(sql`update app.assistant_wechat_channels set cursor_value=${updates.cursor},last_poll_at=now(),
          last_error=case when last_error='wechat_service_unavailable' then null else last_error end where id=${c.id}`);
      });
    }
  } catch (error) {
    backoff = 8;
    await locked(lease, async (tx, c) => {
      if (error instanceof AssistantError && error.code === 'wechat_login_invalid') await closeChannel(tx, c, 'login_invalid');
      else await tx.execute(sql`update app.assistant_wechat_channels set last_error='wechat_service_unavailable' where id=${c.id}`);
    });
  } finally {
    await locked(lease, (tx, c) => tx.execute(sql`update app.assistant_wechat_channels set lease_id=null,
      poll_after=now()+make_interval(secs=>${backoff}::int) where id=${c.id}`));
  }
  return true;
}
