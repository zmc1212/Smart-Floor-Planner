import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, type ActorContext } from '../contracts';
import { customerSources } from '../requirements/service';
import { requirementItems } from '../requirements/items';
import { requirementProposalIsCurrent } from '../requirements/current';
import { reviewHistorySnapshot } from './history';
import { reviewClaims, type ReviewClaimContext } from './review-claims';

export const reviewClaimStep = 1012;

/** Reuse the requirement service's originals, item provenance and currentness
 * predicate. No keyword-based inference of a budget or customer consent. */
export async function currentReviewClaims(tx: PostgresTransaction, actor: ActorContext, conversation: Row): Promise<ReviewClaimContext> {
  const repo = new AssistantRepository(tx, actor);
  await repo.conversation(String(conversation.id));
  const settings = await repo.settings();
  const sources = await customerSources(repo, actor.enterpriseId, String(conversation.id));
  const latest = await one(tx, sql`select * from app.assistant_requirement_summaries
    where enterprise_id=${actor.enterpriseId} and conversation_id=${String(conversation.id)} order by id desc limit 1`);
  if (latest?.status === 'redacted') fail('context_changed');
  const pending = (conversation.entry_snapshot as Row)?.requirementProposal as Row | undefined;
  const sourceSeq = String(sources.messages.at(-1)?.seq || '0');
  const binding = { sourceSeq, sourceHash: sources.hash, epoch: Number(settings!.knowledge_epoch),
    latestId: latest ? String(latest.id) : null, latestVersion: latest ? Number(latest.version) : null,
    mode: String(conversation.mode), status: String(conversation.status),
    proposalHash: pending ? fingerprint(pending) : null };
  const saved = requirementItems(sources.inputs, latest?.draft_fields);
  const proposed = pending?.status === 'pending' ? requirementItems(sources.inputs, pending.fields) : [];
  const current = requirementProposalIsCurrent(pending, binding);
  const originalIds = [...saved, ...proposed].map(item => item.sourceMessageId);
  // Include this question and originals referenced by the actual proposal,
  // rather than a lexical recall which can miss the withdrawn amount.
  // Keep the recent originals even if this run's unchanged-partition tool
  // removed the expired proposal pointer. They remain speech, never state.
  originalIds.push(...sources.inputs.slice(-4).map(source => source.id));
  const originals = await reviewHistorySnapshot(tx, actor, conversation, originalIds, sourceSeq);
  return reviewClaims({ binding, originals, saved, proposed,
    proposalState: pending?.status === 'pending' ? current ? 'pending_proposal' : 'expired_proposal' : null });
}

/** The exact claim catalog survives worker restart. Reentry/commit recomputes
 * against live services, so an adoption, source loss or version change fails
 * closed without replaying a provider call or reviving the old proposal. */
export async function boundReviewClaims(tx: PostgresTransaction, actor: ActorContext, conversation: Row, runId: string): Promise<ReviewClaimContext> {
  const current = await currentReviewClaims(tx, actor, conversation);
  const saved = await one(tx, sql`select private_checkpoint from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${runId} and step_seq=${reviewClaimStep}`);
  if (saved) {
    if (fingerprint(saved.private_checkpoint) !== fingerprint(current)) fail('context_changed');
    return saved.private_checkpoint as ReviewClaimContext;
  }
  await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,status,source_refs,private_checkpoint,input_summary)
    values(${actor.enterpriseId},${runId},${reviewClaimStep},'agent_requirement_claim_context','requirements.claims.v1','succeeded',
      ${JSON.stringify(current.originals.sources.map(({ messageId, hash, memoryVersion }) => ({ messageId, hash, memoryVersion })))}::jsonb,
      ${JSON.stringify(current)}::jsonb,${JSON.stringify({ protocol: current.protocol, claimCount: current.claims.length })}::jsonb)`);
  return current;
}
