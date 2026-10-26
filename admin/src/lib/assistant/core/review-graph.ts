import { Annotation, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { getPostgresPool } from '@/lib/postgresql';
import { AssistantError, fail, key, type ActorContext } from '../contracts';

// Keep the original schema/channel names so existing checkpoints remain usable.
const schema = 'assistant_requirement_workflow';
export const reviewCheckpointer = () => new PostgresSaver(getPostgresPool(), undefined, { schema });
export const setupReviewWorkflow = (pool: Pool) => new PostgresSaver(pool, undefined, { schema }).setup();
export type ReviewDecision = { approve: boolean; requestKey: string; restoreConsent: boolean; inputHash?: string };
const State = Annotation.Root({
  proposalId: Annotation<string>(), digest: Annotation<string>(),
  decision: Annotation<ReviewDecision | null>(), summaryId: Annotation<string | null>(),
  status: Annotation<'pending' | 'approved' | 'applied' | 'rejected'>(),
});
function decision(value: unknown): ReviewDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_message', 422);
  const d = value as Record<string, unknown>;
  if (Object.keys(d).some(k => !['approve','requestKey','restoreConsent','inputHash'].includes(k))
    || typeof d.approve !== 'boolean' || typeof d.restoreConsent !== 'boolean'
    || (d.inputHash !== undefined && (typeof d.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(d.inputHash)))) fail('invalid_message', 422);
  key(d.requestKey); return d as ReviewDecision;
}
export function reviewGraph(ports: {
  kind: string; authorize(): Promise<void>;
  apply(proposalId: string, digest: string, decision: ReviewDecision): Promise<string>;
  afterWrite?: () => Promise<void>; errorCode?: string;
}) {
  return new StateGraph(State)
    .addNode('approval', async state => {
      await ports.authorize();
      const approved = decision(interrupt({ kind: ports.kind, proposalId: state.proposalId, digest: state.digest }));
      return { decision: approved, status: approved.approve ? 'approved' as const : 'rejected' as const };
    })
    .addNode('apply', async state => {
      await ports.authorize();
      let summaryId: string;
      try { summaryId = await ports.apply(state.proposalId, state.digest, state.decision!); }
      catch (error) {
        if (error instanceof AssistantError) throw new AssistantError(error.code, error.status);
        throw new AssistantError(ports.errorCode || 'requirements_write_indeterminate', 503);
      }
      if (ports.afterWrite) await ports.afterWrite();
      return { summaryId, status: 'applied' as const };
    })
    .addEdge(START, 'approval')
    .addConditionalEdges('approval', s => s.status === 'approved' ? 'apply' : END)
    .addEdge('apply', END).compile({ checkpointer: reviewCheckpointer() });
}
export function withReviewLock<T>(actor: ActorContext, conversationId: string, work: () => Promise<T>) {
  return withTenantTransaction(actor.enterpriseId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`requirement-workflow:${actor.enterpriseId}:${conversationId}`},0))`);
    return work();
  });
}
