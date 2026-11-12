import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, type ActorContext } from '../contracts';
import { querySiteMaterials, resolveSiteQuery, type SiteQuery } from '@/lib/construction/site-queries';
import { knowledgeContext } from '../knowledge/applicability-context';
import { readStageSettings } from '@/lib/construction/stages-store';
import { knowledgeTextAllowed } from '../knowledge/provenance';
import type { MaterialSource } from './materials';

export type SharedSiteProgressSnapshot = {
  query: { domain: 'construction'; leadId: string }; leadIds: string[];
  contextConversationId: string; sharedSite: { projectId: string; room: SiteQuery };
  version: string; queriedAt: string; displayText: string;
  data: Array<{ stageKey?: string; records: MaterialSource[] }>;
};

/** Use the shared chat's live member gate and published-record reader. The
 * original question can select a room but cannot select another project. */
export async function sharedSiteProgress(tx: PostgresTransaction, actor: ActorContext, conversationId: string,
  scope: string | SiteQuery): Promise<SharedSiteProgressSnapshot> {
  if (actor.principal.kind !== 'admin' || !actor.capabilities.includes('assistant.project.shared')) fail('assistant_capability_forbidden', 403);
  const repo = new AssistantRepository(tx, actor);
  await repo.identity();
  const conversation = await repo.conversation(conversationId), context = await knowledgeContext(tx, actor, conversation);
  const { projectId, leadId, stage } = context;
  if (!projectId || !leadId) fail('assistant_resource_not_found', 404);
  const room = typeof scope === 'string' ? await resolveSiteQuery(tx, actor.enterpriseId, projectId, scope) : scope;
  const project = await one(tx, sql`select progress_note, status from app.construction_projects
    where enterprise_id=${actor.enterpriseId} and id=${projectId} for share`);
  if (project?.status !== 'active') fail('context_changed');
  const stageName = (await readStageSettings(tx, actor.enterpriseId)).stages.find(item => item.key === stage)?.name;
  const published = await querySiteMaterials(tx, actor.enterpriseId, projectId, room, true);
  const records = published.sources.filter(source => knowledgeTextAllowed(source.text, source.roomName)).map((source): MaterialSource => {
    const ref = source.ref as { id: string; version: number };
    return { ref: { type: 'site_record', id: ref.id, version: String(ref.version) }, hash: String(source.hash),
      leadId, projectId, roomId: source.roomId ? String(source.roomId) : null, roomName: String(source.roomName),
      sourceMessageId: String(source.sourceMessageId), mediaIds: source.mediaIds as string[],
      audience: 'project_members', basis: 'published_project_record', status: 'current', text: String(source.text),
      ...(typeof source.siteCompleted === 'string' ? { siteCompleted: source.siteCompleted } : {}) };
  });
  const note = typeof project.progress_note === 'string' && knowledgeTextAllowed(project.progress_note) ? project.progress_note : '';
  const displayText = [stageName && knowledgeTextAllowed(stageName) ? '团队标记的当前施工节点：' + stageName + '。' : '本次未核实当前施工节点。',
    note ? '项目进展说明：' + note : '', records.length ? '' : '本次未取得所查范围的已发布现场记录。'].filter(Boolean).join('\n');
  return { query: { domain: 'construction', leadId }, leadIds: [leadId], contextConversationId: conversationId,
    sharedSite: { projectId, room }, version: fingerprint({ context, room, displayText, published: published.version }),
    displayText, data: [{ stageKey: stage, records }], queriedAt: new Date().toISOString() };
}
