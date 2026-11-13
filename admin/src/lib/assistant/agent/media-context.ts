import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, type ActorContext, type Evidence } from '../contracts';
import { resolveEvidence } from '../knowledge/sources';
import type { ModelMessage, ModelPart } from '../contracts/model';
import { businessSnapshotAvailable, type BusinessSnapshot } from './business-tools';
import { constructionNoticeAvailable, constructionRead } from '@/lib/construction/customer';
import { customerSiteMedia, publishedSitePhotoIds } from '@/lib/construction/site-publications';
import { publicMessageAvailable } from '@/lib/construction/public-projections';
import { materialSnapshotAvailable, type MaterialDependency } from './materials';
import { needIssueSnapshotAvailable, type NeedIssueDependency } from '@/lib/construction/need-issues';
import { synthesisContextAvailable } from './synthesis-sources';
import type { SynthesisContext } from './synthesis';
import { historyRefsAvailable, type HistoryRef } from './history';
import { needSourcesAvailable, type NeedSourceRef } from './memory-sources';
import { formalMediaSourceAvailable } from '../media/formal-source';
export type MediaDependency = { type: 'assistant_media'; id: string; hash: string };
export type SitePhotoDependency = { type: 'construction_site_photo'; id: string; hash: string;
  recordId: string; recordVersion: number; projectId: string; roomId: string; roomName: string; ownerId: string };
export type AgentMediaDependency = MediaDependency | SitePhotoDependency;
/** Call only after conversation authorization; this does not grant conversation access. */
export async function resolveAgentMedia(tx: PostgresTransaction, enterpriseId: string, conversationId: string, ref: MediaDependency) {
  const media = await one(tx, sql`select a.* from app.assistant_media a where a.enterprise_id=${enterpriseId}
    and a.conversation_id=${conversationId} and a.id=${ref.id} and a.source_hash=${ref.hash} and a.deleted_at is null`);
  return media && await formalMediaSourceAvailable(tx, enterpriseId, media) ? media : undefined;
}

export async function resolveAgentImage(tx: PostgresTransaction, eid: string, conversation: Row, ref: AgentMediaDependency) {
  if (ref.type === 'assistant_media') return resolveAgentMedia(tx, eid, String(conversation.id), ref);
  const entry = conversation.entry_snapshot as Row;
  if (entry?.kind !== 'lead' || entry.activePublicSite || !await one(tx, sql`select id from app.assistant_participants
    where enterprise_id=${eid} and conversation_id=${String(conversation.id)} and user_id=${ref.ownerId} and status='active'`)) return;
  try {
    const media = await customerSiteMedia(tx, { enterpriseId: eid, principal: { kind: 'user', userId: ref.ownerId },
      contextVersion: 0, capabilities: [] }, conversation, ref.recordId, ref.id, ref.recordVersion,
      { projectId: ref.projectId, roomId: ref.roomId, roomName: ref.roomName });
    if (media.hash === ref.hash && media.mime === 'image/jpeg' && Buffer.isBuffer(media.data))
      return { data: media.data, mime_type: media.mime };
  } catch (error) {
    if (!(error instanceof AssistantError) || error.status !== 404) throw error;
  }
}

export async function specialistSitePhotos(tx: PostgresTransaction, actor: ActorContext, conversation: Row, roomName: string) {
  const entry = conversation.entry_snapshot as Row;
  if (actor.principal.kind !== 'user' || entry.kind !== 'lead' || entry.activePublicSite) return [];
  const eid = actor.enterpriseId, ownerId = actor.principal.userId;
  const { data } = await constructionRead(tx, eid, ownerId, String(entry.id), { room: roomName });
  const project = data[0];
  if (!project?.roomId) return [];
  const projectId = String(project.projectId), roomId = String(project.roomId);
  const photos: Array<{ ref: SitePhotoDependency; data: Buffer }> = [];
  for (const record of project.records as Array<{ id: string; version: number }>) {
    for (const asset of await publishedSitePhotoIds(tx, eid, projectId, record.id, 2 - photos.length)) {
      const ref: SitePhotoDependency = { type: 'construction_site_photo', id: String(asset.id), hash: String(asset.source_hash),
        recordId: record.id, recordVersion: record.version, projectId, roomId, roomName, ownerId };
      const media = await resolveAgentImage(tx, eid, conversation, ref);
      if (media) photos.push({ ref, data: media.data as Buffer });
    }
    if (photos.length >= 2) break;
  }
  return photos;
}
export async function agentMessageAvailable(tx: PostgresTransaction, enterpriseId: string, conversationId: string, messageId: string, reader?:ActorContext) {
  const needs = await rows(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId}
      and s.kind in ('agent_need_context','agent_need_write') and s.status='succeeded'`);
  for (const need of needs) if (!await needSourcesAvailable(tx, enterpriseId, conversationId, need.source_refs as NeedSourceRef[])) return false;
  const longTerm = await one(tx, sql`select m.run_id::text from app.assistant_messages m join app.assistant_run_steps s
    on s.enterprise_id=m.enterprise_id and s.run_id=m.run_id and s.kind='agent_long_term_context'
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId}`);
  if (longTerm) {
    const conversation = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${conversationId}`);
    if (!conversation || !await (await import('../memory/agent')).longTermRunAvailable(tx, reader, enterpriseId, conversation, String(longTerm.run_id))) return false;
  }
  const histories = await rows(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId}
      and s.kind in ('agent_history_context','agent_summary_context') and s.status='succeeded'`);
  for (const history of histories) if (!await historyRefsAvailable(tx, enterpriseId, conversationId, history.source_refs as HistoryRef[])) return false;
  const synthesis = await one(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_messages m on m.enterprise_id=s.enterprise_id and m.run_id=s.run_id
    where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${messageId} and s.kind='agent_synthesis_context'`);
  if (synthesis) {
    const conversation = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${conversationId}`);
    const staffFollowup = conversation?.purpose === 'construction_followup' && !!await one(tx, sql`select id
      from app.construction_followup_bindings where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and admin_id is not null`);
    if(conversation?.purpose==='project_collaboration' || staffFollowup) {
      // Reuse the current reader's live membership/private-recipient guard.
      // Never manufacture admin authority from a participant or preview scope.
      const capability = conversation.purpose === 'construction_followup' ? 'assistant.followup.self' : 'assistant.project.shared';
      if(!reader||reader.enterpriseId!==enterpriseId||reader.principal.kind!=='admin'||!reader.capabilities.includes(capability))return false;
      await new AssistantRepository(tx,reader).conversation(conversationId);
      if(!await synthesisContextAvailable(tx,reader,conversation,synthesis.source_refs as SynthesisContext))return false;
    } else {
    const owner = await one(tx, sql`select user_id,admin_id from app.assistant_participants where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and status='active'
      ${conversation?.purpose === 'customer_consultation' ? sql`and user_id is not null` : sql``} order by id limit 1`);
    if (owner && !owner.user_id && !(conversation?.entry_snapshot as { preview?: unknown })?.preview) return false;
    if (!conversation || !owner || !await synthesisContextAvailable(tx, { enterpriseId, principal: owner.user_id
      ? { kind: 'user', userId: String(owner.user_id) } : { kind: 'admin', adminId: String(owner.admin_id) }, contextVersion: 0, capabilities: [] },
      conversation, synthesis.source_refs as SynthesisContext)) return false;
    }
  }
  if (!await publicMessageAvailable(tx, enterpriseId, conversationId, messageId)) return false;
  if (!await constructionNoticeAvailable(tx, enterpriseId, conversationId, messageId, false, false, reader)) return false;
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
  const refs = (step?.source_refs || []) as AgentMediaDependency[];
  for (const ref of refs) {
    if (ref.type === 'assistant_media' && !await resolveAgentMedia(tx, enterpriseId, conversationId, ref)) return false;
    if (ref.type === 'construction_site_photo') {
      const conversation = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${conversationId}`);
      if (!conversation || !await resolveAgentImage(tx, enterpriseId, conversation, ref)) return false;
    }
  }
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
    try { if (!await businessSnapshotAvailable(tx, enterpriseId, tool.private_checkpoint as BusinessSnapshot, reader)) return false; }
    catch { return false; }
  }
  return true;
}
export function withoutImageBytes(messages: ModelMessage[]): ModelMessage[] {
  return messages.map(m => m.role === 'user' || m.role === 'system' ? { ...m, content: m.content.map(p => p.type === 'image' ? { ...p, data: '' } : p) } : m);
}
export async function hydrateImages(tx: PostgresTransaction, enterpriseId: string, conversationId: string, messages: ModelMessage[],
  site?: { conversation: Row; refs: SitePhotoDependency[] }) {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'system') { result.push(message); continue; }
    const content: ModelPart[] = [];
    for (const part of message.content) {
      if (part.type !== 'image') { content.push(part); continue; }
      const siteRef = site?.refs.find(ref => 'site:' + ref.id === part.mediaId && ref.hash === part.hash);
      const media = siteRef && site ? await resolveAgentImage(tx, enterpriseId, site.conversation, siteRef)
        : await resolveAgentMedia(tx, enterpriseId, conversationId, { type: 'assistant_media', id: part.mediaId, hash: part.hash });
      if (!media) fail('context_changed');
      content.push({ ...part, data: (media.data as Buffer).toString('base64') });
    }
    result.push({ ...message, content });
  }
  return result;
}
