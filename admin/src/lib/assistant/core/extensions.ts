import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one } from '@/db/repositories/assistant-repository';
import { requireCapability, fail, type ActorContext, type ResourceRef } from '../contracts';
import { ContextRegistry } from '../capabilities/registry';
import { appendMessage, cancelRuns } from './conversation';

/** Internal services only. No P1 route grants these capabilities. */
export async function changeMode(actor: ActorContext, conversationId: string, mode: 'ai' | 'human' | 'handoff_requested') {
  requireCapability(actor, 'assistant.mode.manage');
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const repo = new AssistantRepository(tx, actor); await repo.settings(); await repo.conversation(conversationId);
    await cancelRuns(tx, actor, conversationId);
    await tx.execute(sql`update app.assistant_conversations set mode=${mode},context_revision=context_revision+1,version=version+1,updated_at=now()
      where enterprise_id=${actor.enterpriseId} and id=${conversationId}`);
  });
}
export async function bindContext(actor: ActorContext, conversationId: string, ref: ResourceRef, registry: ContextRegistry) {
  requireCapability(actor, 'assistant.binding.manage');
  await registry.resolve(actor, ref);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const repo = new AssistantRepository(tx, actor); await repo.settings(); await repo.conversation(conversationId);
    await tx.execute(sql`insert into app.assistant_context_bindings(enterprise_id,conversation_id,resource_type,resource_id,relation,source_version)
      values(${actor.enterpriseId},${conversationId},${ref.type},${ref.id},'context',${ref.version || '1'}) on conflict do nothing`);
    await tx.execute(sql`update app.assistant_conversations set context_revision=context_revision+1,version=version+1,updated_at=now()
      where enterprise_id=${actor.enterpriseId} and id=${conversationId}`);
  });
}
export async function appendEventNotice(actor: ActorContext, conversationId: string, eventId: string, purpose: string, text: string) {
  requireCapability(actor, 'assistant.event.append');
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const repo = new AssistantRepository(tx, actor); await repo.settings(); await repo.conversation(conversationId);
    if (!await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${actor.enterpriseId} and id=${eventId}`)) fail('assistant_resource_not_found', 404);
    const message = await appendMessage(tx, actor, conversationId, { author: 'system', eventId, purpose, content: { version: 1, blocks: [{ type: 'notice', code: purpose, fallbackText: text }] } });
    return String(message.id);
  });
}
