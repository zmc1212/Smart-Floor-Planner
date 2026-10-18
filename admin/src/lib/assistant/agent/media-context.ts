import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fail, type ActorContext, type Evidence } from '../contracts';
import { resolveEvidence } from '../knowledge/sources';
import type { ModelMessage, ModelPart } from '../contracts/model';
import { businessSnapshotAvailable, type BusinessSnapshot } from './business-tools';
import { constructionNoticeAvailable } from '@/lib/construction/customer';
import { publicMessageAvailable } from '@/lib/construction/public-projections';
import { materialSnapshotAvailable, type MaterialDependency } from './materials';
import { needIssueSnapshotAvailable, type NeedIssueDependency } from '@/lib/construction/need-issues';
import { synthesisContextAvailable } from './synthesis-sources';
import type { SynthesisContext } from './synthesis';
export type MediaDependency = { type: 'assistant_media'; id: string; hash: string };
/** Call only after conversation authorization; this does not grant conversation access. */
export async function resolveAgentMedia(tx: PostgresTransaction, enterpriseId: string, conversationId: string, ref: MediaDependency) {
  const media = await one(tx, sql`select a.* from app.assistant_media a where a.enterprise_id=${enterpriseId}
    and a.conversation_id=${conversationId} and a.id=${ref.id} and a.source_hash=${ref.hash} and a.deleted_at is null
    and (a.source_ref is null or exists(select 1 from app.leads l join app.floor_plans f on f.enterprise_id=l.enterprise_id and f.id=l.primary_floor_plan_id
      where l.enterprise_id=a.enterprise_id and l.id::text=a.source_ref->>'leadId' and l.customer_user_id=a.customer_user_id and l.archived_at is null
      and f.id::text=a.source_ref->>'floorPlanId' and f.status='completed' and f.layout_data->>'version'='4' and f.layout_data->>'measurementMode'='surveying'))`);
  return media;
}
export async function agentMessageAvailable(tx: PostgresTransaction, enterpriseId: string, conversationId: string, messageId: string) {
  const synthesis = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId} and s.kind='agent_synthesis_context'`);
  if (synthesis) {
    const conversation = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${conversationId}`);
    const owner = await one(tx, sql`select user_id,admin_id from app.assistant_participants where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and status='active'
      ${conversation?.purpose === 'customer_consultation' ? sql`and user_id is not null` : sql``} order by id limit 1`);
    if (owner && !owner.user_id && !(conversation?.entry_snapshot as { preview?: unknown })?.preview) return false;
    if (!conversation || !owner || !await synthesisContextAvailable(tx, { enterpriseId, principal: owner.user_id
      ? { kind: 'user', userId: String(owner.user_id) } : { kind: 'admin', adminId: String(owner.admin_id) }, contextVersion: 0, capabilities: [] },
      conversation, synthesis.source_refs as SynthesisContext)) return false;
  }
  if (!await publicMessageAvailable(tx, enterpriseId, conversationId, messageId)) return false;
  if (!await constructionNoticeAvailable(tx, enterpriseId, conversationId, messageId)) return false;
  const construction = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId} and s.kind='agent_construction_context'`);
  for (const mid of (construction?.source_refs || []) as string[]) if (!await constructionNoticeAvailable(tx, enterpriseId, conversationId, mid, false, true)) return false;
  const materials = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId} and s.kind='agent_material_context'`);
  for (const ref of (materials?.source_refs || []) as MaterialDependency[]) if (!await materialSnapshotAvailable(tx, enterpriseId, ref)) return false;
  const issues = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId} and s.kind='agent_need_issue_context'`);
  for (const ref of (issues?.source_refs || []) as NeedIssueDependency[]) if (!await needIssueSnapshotAvailable(tx, enterpriseId, ref)) return false;
  const step = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId} and s.kind='agent_checkpoint'`);
  const refs = (step?.source_refs || []) as MediaDependency[];
  for (const ref of refs) if (ref.type === 'assistant_media' && !await resolveAgentMedia(tx, enterpriseId, conversationId, ref)) return false;
  // Staff packets and same-thread replies use this guard too. Source withdrawal
  // must invalidate derived text there, not only the customer's citation sheet.
  const referenceStep = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId} and s.kind='agent_reference_context'`);
  const citations = await tx.execute(sql`select resource_type,chunk_id,document_version_id,source_hash from app.assistant_message_citations
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and message_id=${messageId}`);
  const evidence: Evidence[] = [...(referenceStep?.source_refs || []) as Evidence[], ...citations.rows.map(c => ({ ref: {type:String(c.resource_type),id:String(c.chunk_id),version:String(c.document_version_id)},hash:String(c.source_hash),text:'' }))];
  if (evidence.length) {
    const conversation = await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${conversationId}`);
    // Only customer-consultation sources are projected in a human handoff.
    if (conversation?.purpose === 'customer_consultation') {
      const owner = await one(tx,sql`select user_id from app.assistant_participants where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and user_id is not null and status='active' order by id limit 1`);
      if (!owner) return false;
      const actor: ActorContext = {enterpriseId,principal:{kind:'user',userId:String(owner.user_id)},contextVersion:0,capabilities:[]};
      for (const e of evidence) if (!await resolveEvidence(tx,actor,conversation,e,true)) return false;
    }
  }
  const tool = await one(tx, sql`select s.private_checkpoint from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId} and s.kind='agent_business_result'`);
  if (tool?.private_checkpoint) {
    try { if (!await businessSnapshotAvailable(tx, enterpriseId, tool.private_checkpoint as BusinessSnapshot)) return false; }
    catch { return false; }
  }
  return true;
}
export function withoutImageBytes(messages: ModelMessage[]): ModelMessage[] {
  return messages.map(m => m.role === 'user' || m.role === 'system' ? { ...m, content: m.content.map(p => p.type === 'image' ? { ...p, data: '' } : p) } : m);
}
export async function hydrateImages(tx: PostgresTransaction, enterpriseId: string, conversationId: string, messages: ModelMessage[]) {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'system') { result.push(message); continue; }
    const content: ModelPart[] = [];
    for (const part of message.content) {
      if (part.type !== 'image') { content.push(part); continue; }
      const media = await resolveAgentMedia(tx, enterpriseId, conversationId, { type: 'assistant_media', id: part.mediaId, hash: part.hash });
      if (!media) fail('context_changed');
      content.push({ ...part, data: (media.data as Buffer).toString('base64') });
    }
    result.push({ ...message, content });
  }
  return result;
}
