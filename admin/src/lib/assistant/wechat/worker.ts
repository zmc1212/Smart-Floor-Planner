import { sql } from 'drizzle-orm';
import { AssistantRepository, one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { decryptText, encryptText } from '@/lib/crypto';
import { resolveWorkerDeployment } from '@/lib/xiaok-v1/worker-runtime-config';
import { AssistantError, fail, safeText, type MessageContent } from '../contracts';
import { ConversationService } from '../core/conversation';
import { projectMessage } from '../knowledge/sources';
import { closeChannel, pairDigest, type ChannelRow } from './channels';
import { checkRecipient, savedRecipient } from './recipient';
import { weixinClient } from './ilink';
import { wechatSubject } from './subject';
import { queueWechatReports, reportText, type ReportEvent } from './reports';
import { mainRelease } from '@/lib/xiaok-v1/main-publication';

type Event = ReportEvent & { id: string; event_key: string; context_secret: string; text_value: string | null;
  status: 'received' | 'running' | 'sending'; run_id: string | null };
type Reply = { event: Event; notice?: string; output?: { id: string; seq: string; conversation: string } };
const unavailable = '小K暂时无法回答这个问题，请稍后再试。';
const withdrawn = '这条答复的依据已不可用，请重新提问。';

function account(c: ChannelRow) {
  return { origin: c.api_origin, token: decryptText(c.bot_secret), peer: c.peer_id, bot: c.bot_id };
}
function locked<T>(lease: ChannelRow, work: (tx: PostgresTransaction, c: ChannelRow) => Promise<T>) {
  return withTenantTransaction(lease.enterprise_id, async tx => {
    if (lease.stage_id === 'main') await mainRelease(tx, lease.enterprise_id);
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

async function prepare(tx: PostgresTransaction, c: ChannelRow, event: Event): Promise<Reply | 'queued' | null> {
  // An interrupted send has no trustworthy receipt. A second send could duplicate a real reply.
  if (event.status === 'sending') {
    await finish(tx, c, event.id, 'unknown', 'wechat_delivery_unknown');
    return null;
  }
  const actor = wechatSubject(c);
  const repo = new AssistantRepository(tx, actor);
  await repo.settings(true);
  if (event.proactive) return {event};
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
  if (/^绑定\s+[a-f0-9]{16}$/iu.test(event.text_value.trim())) {
    if (c.stage_id !== 'main') return {event,notice:'请把绑定口令发到主小K的微信会话。当前会话是阶段专属入口。'};
    const publication = await mainRelease(tx, c.enterprise_id);
    if (!publication?.enabled || !publication.reports) return {event,notice:'本企业的微信报告暂未开启。'};
    const provided = event.text_value.trim().split(/\s+/u)[1].toUpperCase();
    const candidate = await one<ChannelRow>(tx,sql`select * from app.assistant_wechat_channels where enterprise_id=${c.enterprise_id}
      and stage_id='main' and pair_digest=${pairDigest(provided)} and pair_until>now() and status<>'closed' and verified_at is null
      and (id=${c.id} or (${c.recipient_key === null} and status='pending')) for update`);
    if (candidate) {
      const recipient = savedRecipient({...candidate,verified_at:new Date().toISOString()});
      if (!recipient) fail('context_changed');
      await checkRecipient(tx,recipient);
      if (candidate.id !== c.id) await closeChannel(tx,candidate,'linked_existing');
      await tx.execute(sql`update app.assistant_wechat_channels set verified_at=now(),pair_secret=null,pair_digest=null,pair_until=null,
        recipient_key=${candidate.recipient_key},recipient_binding_id=${candidate.recipient_binding_id},project_id=${candidate.project_id},
        recipient_audience=${candidate.recipient_audience},
        mini_user_id=${candidate.mini_user_id},identity_version=${candidate.identity_version},recipient_requires_service=${candidate.recipient_requires_service},
        latest_context=${event.context_secret},recipient_version=recipient_version+1 where id=${c.id}`);
      return {event,notice:'本人微信已关联。可以直接问小K工地的日报或周报，也可以在小程序报告页订阅日报、周报。'};
    }
    return {event,notice:'绑定口令无效或已到期，请到小程序的工地日报与周报页重新获取。'};
  }
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
  return 'queued';
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
    if (c.stage_id === 'main') {
      const publication = await mainRelease(tx,c.enterprise_id);
      if (!publication?.enabled || output && await one(tx,sql`select 1 from app.assistant_run_steps s
        left join app.assistant_stage_agents a on a.enterprise_id=s.enterprise_id and a.stage_id=s.input_summary->>'stage'
        where s.enterprise_id=${c.enterprise_id} and s.run_id=${event.run_id} and
        (s.kind='main_publication' and (s.private_checkpoint->>'v')::int<>${publication.version}
        or s.capability_name='consult_renovation_stage' and not a.enabled)`)) {
        await finish(tx,c,event.id,'failed','context_changed'); return;
      }
    }
    if (output && checked) {
      const conversation = await repo.conversation(output.conversation, 'share');
      const raw = await one(tx, sql`select * from app.assistant_messages where enterprise_id=${c.enterprise_id}
        and conversation_id=${output.conversation} and id=${output.id} and author_kind='assistant' for share`);
      const current = raw && await projectMessage(tx, repo.actor, conversation, raw);
      if (current?.available && safeText(current.content as MessageContent) === checked) text = checked;
    }
    if (event.report_id && (event.proactive || output && checked && text === checked)) {
      const report = await reportText(tx,c,event);
      if (!report && event.proactive) { await finish(tx,c,event.id,'failed','wechat_report_unavailable'); return; }
      text = report || '这份工地报告当前已不可查看，请从小程序核对工地和权限。';
    }
    const context = event.proactive ? c.latest_context : event.context_secret;
    if (!context) { await finish(tx,c,event.id,'failed','wechat_report_unavailable'); return; }
    try {
      await client.reply(account(c), decryptText(context), 'xiaok-' + c.id + '-' + event.id, text);
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
  return withTenantTransaction(enterpriseId, async tx => {
    await queueWechatReports(tx,enterpriseId);
    return one<ChannelRow>(tx, sql`update app.assistant_wechat_channels c
    set lease_id=gen_random_uuid(),poll_after=now()+interval '120 seconds' from (
      select ch.id from app.assistant_wechat_channels ch
      join app.enterprises e on e.id=ch.enterprise_id and e.status='active'
      join app.assistant_enterprise_settings s on s.enterprise_id=ch.enterprise_id and s.enabled
      left join app.assistant_stage_agents a on a.enterprise_id=ch.enterprise_id and a.stage_id=ch.stage_id
      where ch.enterprise_id=${enterpriseId} and ch.status='connected' and coalesce(a.enabled,true)
      and (ch.stage_id<>'main' or exists(select 1 from app.assistant_main_publications p where p.enterprise_id=ch.enterprise_id and p.enabled))
      and ch.poll_after<=now() order by ch.poll_after limit 1 for update of ch skip locked
    ) available where c.id=available.id returning c.*`);
  });
}
function firstPending(tx: PostgresTransaction, c: ChannelRow) {
  return one<Event>(tx, sql`select * from app.assistant_wechat_events
    where enterprise_id=${c.enterprise_id} and channel_id=${c.id} and status in ('received','running','sending') order by id limit 1`);
}
export async function tickWechatChannel(enterpriseId: string, client = weixinClient) {
  const lease = await take(enterpriseId);
  if (!lease) return false;
  let backoff = 1;
  try {
    let event = await locked(lease, firstPending);
    if (!event) {
      const updates = await client.updates(account(lease), lease.cursor_value);
      event = await locked(lease, async (tx, c) => {
        for (const message of updates.messages) {
          await tx.execute(sql`insert into app.assistant_wechat_events(enterprise_id,channel_id,event_key,text_value,context_secret)
            values(${enterpriseId},${c.id},${message.key},${message.text},${encryptText(message.context)})
            on conflict (channel_id,event_key) do nothing`);
        }
        // Commit the cursor and inbox together before admitting the first event.
        const latest = updates.messages.at(-1);
        await tx.execute(sql`update app.assistant_wechat_channels set cursor_value=${updates.cursor},last_poll_at=now(),
          latest_context=coalesce(${latest && c.recipient_key ? encryptText(latest.context) : null},latest_context),
          last_error=case when last_error='wechat_service_unavailable' then null else last_error end where id=${c.id}`);
        if (updates.messages.length) return firstPending(tx, c);
      });
    }
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
      if (reply === 'queued') return 'queued';
      if (reply) {
        const { gate } = await resolveWorkerDeployment();
        if (gate.status === 'open' && gate.enterpriseId === enterpriseId) await send(lease, reply, client);
      }
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
