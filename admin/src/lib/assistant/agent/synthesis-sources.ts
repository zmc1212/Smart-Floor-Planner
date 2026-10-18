import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, type ActorContext, type Evidence } from '../contracts';
import { resolveEvidence } from '../knowledge/sources';
import { businessSnapshotAvailable, type BusinessSnapshot } from './business-tools';
import { businessSynthesisSources, knowledgeSynthesisSources, type SynthesisContext } from './synthesis';

/** Read only durable, authorized results of this run; never accept client/model source packets. */
export async function currentSynthesisContext(tx: PostgresTransaction, actor: ActorContext, conversation: Row, runId: string): Promise<SynthesisContext> {
  const steps = await rows(tx, sql`select step_seq,capability_name,private_checkpoint from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${runId} and status='succeeded'
      and capability_name in ('knowledge.search.v1','query_business','query_materials','query_followups','synthesis.bound_materials.v1','synthesis.bound_construction.v1') order by step_seq`);
  const context: SynthesisContext = { version: 1, knowledge: [], snapshots: [], sources: [] };
  for (const step of steps) {
    if (step.capability_name === 'knowledge.search.v1') {
      for (const e of step.private_checkpoint as Evidence[]) {
        const source = await resolveEvidence(tx, actor, conversation, e);
        if (!source || !String(source.text).includes(e.text)) fail('context_changed');
        if (!context.knowledge.some(old => old.ref.id === e.ref.id)) {
          context.knowledge.push(e);
          context.sources.push(...knowledgeSynthesisSources([e], { [e.ref.id]: String(source.title) }));
        }
      }
    } else {
      const bound = ['synthesis.bound_materials.v1','synthesis.bound_construction.v1'].includes(String(step.capability_name))
        ? step.private_checkpoint as { resultKey: string; snapshot: BusinessSnapshot } : null;
      const snapshot = bound ? bound.snapshot : step.private_checkpoint as BusinessSnapshot;
      if (!await businessSnapshotAvailable(tx, actor.enterpriseId, snapshot)) fail('context_changed');
      context.snapshots.push(snapshot);
      const seq = Number(step.step_seq) - 1200;
      context.sources.push(...businessSynthesisSources(bound?.resultKey || `${runId}:${Math.floor(seq / 10)}:${seq % 10}`, snapshot));
    }
  }
  return context;
}

/** All consulted evidence is retained, including conflicting/uncited candidates. Replacement invalidates synthesis. */
export async function synthesisContextAvailable(tx: PostgresTransaction, actor: ActorContext, conversation: Row, context: SynthesisContext) {
  if (context.version !== 1) return false;
  for (const e of context.knowledge) if (!await resolveEvidence(tx, actor, conversation, e)) return false;
  for (const snapshot of context.snapshots) {
    try { if (!await businessSnapshotAvailable(tx, actor.enterpriseId, snapshot)) return false; } catch { return false; }
  }
  return true;
}
