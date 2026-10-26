import { Command } from '@langchain/langgraph';
import type { AssistantRepository, Row } from '@/db/repositories/assistant-repository';
import { fail, key, type ActorContext } from '../contracts';
import { reviewCheckpointer, reviewGraph, setupReviewWorkflow, withReviewLock } from '../core/review-graph';
import type { RequirementProposal } from './items';
import { RequirementService } from './service';

// Official checkpoint storage contains only opaque IDs/decisions, never chat,
// requirement values, model prose, knowledge excerpts, tokens or phone numbers.
export const requirementWorkflowVersion = 'langgraph-review-1';
export const requirementCheckpointer = reviewCheckpointer;
// Explicit infrastructure setup, invoked by the approved development/test driver;
// ordinary customer requests never execute DDL or migrate production storage.
export const setupRequirementWorkflow = setupReviewWorkflow;

type SavedRequirement = Awaited<ReturnType<RequirementService['write']>>;
type WriteResult = SavedRequirement & { receipt?: { effect: string; summaryId: string; text: string } };

/** The model can propose; only this customer-authorized workflow can resume. */
export class RequirementWorkflow {
  readonly requirements: RequirementService;
  constructor(readonly actor: ActorContext, private readonly hooks: { afterWrite?: () => Promise<void> } = {}) {
    this.requirements = new RequirementService(actor);
  }
  private thread(conversationId: string, proposalId: string) {
    if (!/^[a-f0-9-]{36}$/.test(proposalId)) fail('invalid_message', 422);
    return `requirements:${this.actor.enterpriseId}:${conversationId}:${proposalId}`;
  }
  private async authorized(conversationId: string) {
    if (!await this.requirements.workflowEnabled(conversationId)) fail('context_changed');
  }
  private locked<T>(conversationId: string, work: () => Promise<T>) {
    // Serialize framework resume across processes. Business effects retain their
    // original tenant transaction/idempotency; checkpoints are not exactly-once.
    return withReviewLock(this.actor, conversationId, work);
  }
  private graph(conversationId: string) {
    const req = this.requirements;
    return reviewGraph({ kind: 'requirement_proposal', authorize: () => this.authorized(conversationId),
      apply: async (proposalId, digest, d) => {
        const saved = await req.write(conversationId, d.requestKey, { action: 'apply_proposal', proposalId,
          digest, consent: true, restoreConsent: d.restoreConsent });
        return saved.id;
      }, afterWrite: this.hooks.afterWrite });
  }
  private async prepare(conversationId: string, proposalId: string, digest: string) {
    await this.authorized(conversationId);
    const config = { configurable: { thread_id: this.thread(conversationId, proposalId) } };
    const graph = this.graph(conversationId);
    let snapshot = await graph.getState(config);
    if (!snapshot.values?.proposalId) {
      const current = await this.requirements.read(conversationId);
      if (current.proposal?.id !== proposalId || current.proposal.digest !== digest) fail('requirement_target_changed');
      await graph.invoke({ proposalId, digest, decision: null, summaryId: null, status: 'pending' }, config);
      snapshot = await graph.getState(config);
    }
    if (snapshot.values.proposalId !== proposalId || snapshot.values.digest !== digest) fail('requirement_target_changed');
    return { graph, config, snapshot };
  }
  async read(conversationId: string) {
    const current = await this.requirements.read(conversationId);
    if (current.proposal && await this.requirements.workflowEnabled(conversationId)) {
      await this.locked(conversationId, () => this.prepare(conversationId, String(current.proposal!.id), String(current.proposal!.digest)));
    }
    return current;
  }
  async propose(conversationId: string, requestKey: string, input: Extract<RequirementProposal, { changes: unknown }>, guard?: (repo: AssistantRepository,c:Row)=>Promise<void>) {
    const result = await this.requirements.propose(conversationId, requestKey, input, guard);
    if (result.kind === 'proposal') await this.read(conversationId);
    return result;
  }
  async write(conversationId: string, requestKey: string, input: Record<string, unknown>): Promise<WriteResult> {
    if (input.action !== 'apply_proposal' || !await this.requirements.workflowEnabled(conversationId)) {
      return this.requirements.write(conversationId, requestKey, input);
    }
    if (Object.keys(input).some(k => !['action','proposalId','digest','consent','restoreConsent'].includes(k))
      || input.consent !== true || typeof input.proposalId !== 'string' || typeof input.digest !== 'string'
      || (input.restoreConsent !== undefined && typeof input.restoreConsent !== 'boolean')) fail('invalid_message', 422);
    key(requestKey);
    return this.locked(conversationId, async () => {
      const { graph, config, snapshot } = await this.prepare(conversationId, String(input.proposalId), String(input.digest));
      if (snapshot.values.status === 'rejected') fail('requirement_target_changed');
      if (snapshot.next.length) {
        if (!snapshot.values.decision) {
          const current = await this.requirements.read(conversationId);
          const pending = current.proposal;
          if (!pending || pending.id !== input.proposalId || pending.digest !== input.digest) fail('requirement_target_changed');
          if (pending.requiresRestoreConsent && input.restoreConsent !== true) fail('requirements_restore_confirmation_required', 409);
        }
        await graph.invoke(snapshot.values.decision ? null : new Command({ resume: {
          approve: true, requestKey, restoreConsent: input.restoreConsent === true,
        } }), config);
      }
      const completed = await graph.getState(config);
      if (completed.next.length || completed.values.status !== 'applied') fail('context_changed');
      // Project the real currently authorized business row. Repeated keys and
      // different-key retries retain the original business idempotency contract.
      const saved = await this.requirements.write(conversationId, requestKey, {
        ...input, restoreConsent: input.restoreConsent === true,
      });
      if (saved.id !== completed.values.summaryId) fail('context_changed');
      const current = saved.status === 'confirmed'
        ? { effect: 'requirements_confirmed', text: '这份需求已正式确认。' }
        : saved.status === 'redacted' ? { effect: 'requirements_redacted', text: '这份需求已按保留规则清理。' }
          : { effect: 'draft_saved', text: '需求草稿已保存，尚未正式确认。' };
      return { ...saved, receipt: { ...current, summaryId: saved.id } };
    });
  }
  async reject(conversationId: string, proposalId: string, digest: string, requestKey: string) {
    return this.locked(conversationId, async () => {
      const { graph, config, snapshot } = await this.prepare(conversationId, proposalId, digest);
      if (snapshot.values.status !== 'pending') fail('requirement_target_changed');
      await graph.invoke(new Command({ resume: { approve: false, requestKey, restoreConsent: false } }), config);
      return { status: 'rejected' as const, writesBusinessState: false };
    });
  }
  async forget(conversationId: string, proposalId: string) {
    await this.requirements.read(conversationId); // same participant/tenant boundary
    await requirementCheckpointer().deleteThread(this.thread(conversationId, proposalId));
  }
}
