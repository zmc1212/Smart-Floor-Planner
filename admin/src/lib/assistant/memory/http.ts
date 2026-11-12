
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { currentDelegationViews, delegationModelView, delegationNoticeAvailable } from '@/lib/native-workflow/live/delegation-chat';
import { delegationNotice } from '@/lib/native-workflow/live/delegation-state';
import { DelegationService } from '@/lib/native-workflow/live/delegation-store';
import { fail, id, requireCapability, type ActorContext } from '../contracts';
import { idempotent } from '../core/conversation';
import { executeLongTermTool, isLongTermTool } from './agent';
import { MemoryService } from './long-term';
import { privateMemoryScope } from './scope';

export async function longTermHttp(actor: ActorContext, conversationId: string, method: string, params: URLSearchParams,
  body: Row, requestKey?: string) {
  requireCapability(actor, 'assistant.chat.self');
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const repo = new AssistantRepository(tx, actor);
    await repo.settings(method !== 'GET');
    const c = await repo.conversation(conversationId);
    const scope = await privateMemoryScope(tx, actor, c);
    if (!scope) fail('assistant_resource_not_found', 404);
    const { enterpriseId, ownerId } = scope;
    const reader = 'native.delegation.notice.read:' + ownerId;
    if (method === 'GET') {
      if ([...params.keys()].some(key => key !== 'q') || (params.get('q') ?? '').length > 500) fail('invalid_message', 422);
      const service = new MemoryService(tx, scope);
      const memories = await service.retrieve(params.get('q') || '记忆历史', 20);
      const tasks = await new DelegationService(tx, scope).list();
      const delegations = delegationModelView(await currentDelegationViews(tx, tasks));
      const notices = await rows(tx, sql`select m.id::text,m.created_at as persisted_at,d.updated_at as read_at
        from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
        left join app.domain_event_deliveries d on d.enterprise_id=e.enterprise_id and d.event_id=e.id and d.consumer_key=${reader}
        where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and e.type=${delegationNotice}
          and e.payload->>'ownerId'=${ownerId} order by m.seq desc limit 12`);
      const visible = [];
      for (const notice of notices) {
        if (await delegationNoticeAvailable(tx, actor, c, String(notice.id))) visible.push({
          messageId: notice.id, delivery: 'persisted_in_app', persistedAt: notice.persisted_at, readAt: notice.read_at ?? null,
        });
      }
      return { memories, delegations, notices: visible };
    }
    if (params.size || !requestKey) fail('invalid_message', 422);
    if (method === 'PATCH') {
      if (Object.keys(body).length !== 1) fail('invalid_message', 422);
      const messageId = id(body.noticeMessageId);
      if (!await delegationNoticeAvailable(tx, actor, c, messageId)) fail('assistant_resource_not_found', 404);
      await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
        select enterprise_id,source_event_id,${reader},'delivered' from app.assistant_messages
        where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and id=${messageId} on conflict do nothing`);
      const read = await one(tx, sql`select d.updated_at from app.domain_event_deliveries d join app.assistant_messages m
        on m.enterprise_id=d.enterprise_id and m.source_event_id=d.event_id where d.enterprise_id=${enterpriseId}
        and m.conversation_id=${conversationId} and m.id=${messageId} and d.consumer_key=${reader}`);
      return { messageId, readAt: read?.updated_at ?? null };
    }
    if (method !== 'POST' || Object.keys(body).some(key => !['messageId','tool','input','expectedVersion'].includes(key))
      || typeof body.tool !== 'string' || !isLongTermTool(body.tool) || !body.input || typeof body.input !== 'object'
      || !Number.isSafeInteger(body.expectedVersion)) fail('invalid_message', 422);
    const messageId = id(body.messageId), tool = body.tool;
    return idempotent(tx, actor, 'long-term:' + conversationId, requestKey, body, async () => {
      if (Number(c.version) !== Number(body.expectedVersion)) fail('version_conflict');
      const source = await one(tx, sql`select * from app.assistant_messages where enterprise_id=${enterpriseId} and conversation_id=${conversationId}
        and id=${messageId} and user_id=${ownerId} and author_kind='user' for share`);
      if (!source) fail('assistant_resource_not_found', 404);
      const result = await executeLongTermTool(tx, actor, c, source, { id: requestKey, name: tool, arguments: JSON.stringify(body.input) });
      if (!result.ok) fail(result.record.error?.code ?? 'tool_execution_failed', result.status === 'denied' ? 403 : 422);
      const receipt = JSON.parse(result.content).result as Row;
      if (receipt.memory) {
        const { key, revision, state } = receipt.memory as Row;
        return { memory: { key, revision, state } };
      }
      const { id, version, status } = receipt.delegation as Row;
      return { delegation: { id, version, status } };
    });
  });
}
