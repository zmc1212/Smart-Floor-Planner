import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, type ActorContext } from '../contracts';
import { queryMaterials, type MaterialSnapshot } from './materials';
import { businessSnapshotAvailable, queryBusiness, type BusinessSnapshot } from './business-tools';
import { queryNeedIssues } from '@/lib/construction/need-issues';

type BoundSnapshot<T extends BusinessSnapshot> = { resultKey: string; snapshot: T };

/** Same adapters, run and transaction as explicit tools. No model-selected home,
 * second fact store, model call, or external retry. Resume validates the old
 * snapshot instead of silently replacing evidence already sent to a model. */
export async function boundKnowledgeContext(tx: PostgresTransaction, actor: ActorContext, conversation: Row,
  runId: string, turn: number, index: number, resultKey: string) {
  const entry = conversation.entry_snapshot as Row;
  if (actor.principal.kind !== 'user' || entry.kind !== 'lead') return null;
  const leadId = String(entry.id), conversationId = String(conversation.id);
  async function snapshot<T extends BusinessSnapshot>(sequence: number, capability: string, key: string, read: () => Promise<T>) {
    const prior = await one(tx, sql`select private_checkpoint from app.assistant_run_steps
      where enterprise_id=${actor.enterpriseId} and run_id=${runId} and step_seq=${sequence}`);
    const bound = prior ? prior.private_checkpoint as BoundSnapshot<T> : { resultKey: key, snapshot: await read() };
    if (!await businessSnapshotAvailable(tx, actor.enterpriseId, bound.snapshot)) fail('context_changed');
    const refs = bound.snapshot.query.domain === 'materials' ? (bound.snapshot as MaterialSnapshot).data.sources.map(s=>({ref:s.ref,hash:s.hash})) : [];
    if (!prior) await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,private_checkpoint,source_refs,input_summary)
      values(${actor.enterpriseId},${runId},${sequence},'agent_source',${capability},1,'succeeded',${JSON.stringify(bound)}::jsonb,${JSON.stringify(refs)}::jsonb,
        '{"initiatedBy":"search_knowledge","scope":"conversation_bound_home"}'::jsonb)`);
    return bound;
  }
  const materials = await snapshot(1400 + turn * 10 + index, 'synthesis.bound_materials.v1', 'bound:' + resultKey,
    () => queryMaterials(tx, actor, conversationId, { leadId, room: '' }));
  const construction = await snapshot(1500 + turn * 10 + index, 'synthesis.bound_construction.v1', 'stage:' + resultKey,
    () => queryBusiness(tx, actor, { domain: 'construction', leadId }));
  const followups = await snapshot(1600 + turn * 10 + index, 'synthesis.bound_followups.v1', 'followups:' + resultKey,
    () => queryNeedIssues(tx, actor, conversationId));
  for (const project of construction.snapshot.data as Row[]) await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id)
    values(${actor.enterpriseId},${String(project.projectId)},${conversationId}) on conflict do nothing`);
  return { materials: materials as BoundSnapshot<MaterialSnapshot>, construction, followups };
}
