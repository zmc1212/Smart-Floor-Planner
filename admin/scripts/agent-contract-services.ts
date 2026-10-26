import assert from 'node:assert/strict';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import { requirementItems, requirementSources } from '@/lib/assistant/requirements/items';
import { requirementReview } from '@/lib/assistant/requirements/review';
import { anythingLlmRequirementText } from '@/lib/assistant/integrations/anythingllm';
import { ComparisonServices, type ComparisonContext } from './agent-comparison-services';

// Experimental host binding around the existing business services, not another Agent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export type Verdict = { authorized: boolean; changesFaithful: boolean; answerTruthful: boolean; questionAnswered: boolean; problems: string[] };
export type Submission = { action: 'none' | 'propose_requirements' | 'request_designer' | 'cancel_designer'; changes: unknown[]; answer: string; evidenceIds: string[] };
export type Prepared = { digest: string; submission: Submission; context: ComparisonContext; projected: Row | null; evidence: ReturnType<typeof knowledgeSentences> };

export function knowledgeSentences(context: ComparisonContext) {
  return context.knowledge.flatMap(e => (e.text.match(/[^。！？\n]+[。！？]?/gu) || []).map(text => text.trim()).filter(Boolean)
    .map((text, index) => ({ id: `k${e.ref.id}.${index}`, refId: e.ref.id, text })));
}
export function contractContext(context: ComparisonContext, dialogue: Row[] = []) {
  const latest = context.requirements.latest;
  const fields = latest?.draftFields as Record<string, { text: string }> | undefined;
  const confirmed = latest?.status === 'confirmed' ? latest.confirmedFields as Record<string, string> : null;
  return { customerClauses: requirementSources(context.customerMessages),
    savedItems: requirementItems(context.customerMessages, fields).filter(item => !confirmed || confirmed[item.field] === fields?.[item.field]?.text),
    savedFields: confirmed || Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, value.text])),
    draftStatus: context.requirements.latest?.status || 'absent', pendingProposal: context.requirements.proposal
      ? { status: 'pending', diff: context.requirements.proposal.diff, requiresRestoreConsent: context.requirements.proposal.requiresRestoreConsent } : null,
    handoff: context.handoff.handoff?.state || 'none',
    knowledgeSentences: knowledgeSentences(context),
    safeDialogue: dialogue.slice(-2).map(entry => entry.epoch === context.epoch ? { user: entry.user, answer: entry.answer }
      : { user: entry.user, sourceStatus: entry.evidenceIds.length ? 'previous_company_answer_source_revoked; cannot_reuse_old_policy_values' : 'no_company_source',
        action: entry.action, note: 'Previous conversation occurred; current business facts are savedItems/handoff.' }) };
}

export class ContractServices {
  readonly base: ComparisonServices;
  constructor(readonly actor: ActorContext, readonly conversationId: string) { this.base = new ComparisonServices(actor, conversationId); }
  context() { return this.base.context(); }
  async prepare(context: ComparisonContext, raw: Row, verify: ((input: Row) => Promise<Verdict>) | 'measure_native_proposals') {
    await this.base.fresh(context);
    try {
      if (Object.keys(raw).some(k => !['action', 'changes', 'answer', 'evidenceIds'].includes(k))
        || !['none', 'propose_requirements', 'request_designer', 'cancel_designer'].includes(raw.action)
        || !Array.isArray(raw.changes) || !Array.isArray(raw.evidenceIds) || raw.evidenceIds.length > 4
        || typeof raw.answer !== 'string' || raw.answer.length > 1800
        || raw.evidenceIds.some((id: unknown) => typeof id !== 'string')) throw Error('invalid_submission');
      const submission = raw as Submission;
      if (submission.action !== 'propose_requirements' && submission.changes.length) throw Error('unexpected_requirement_changes');
      if (context.mode !== 'ai' && !['none', 'cancel_designer'].includes(submission.action)) throw Error('handoff_active');
      const sentences = knowledgeSentences(context), evidence = submission.evidenceIds.map(id => {
        const sentence = sentences.find(s => s.id === id); if (!sentence) throw Error('source_not_authorized'); return sentence;
      });
      const previous = context.requirements.latest;
      const review = submission.action === 'propose_requirements' ? requirementReview(context.customerMessages, previous?.draftFields, submission.changes) : null;
      const projected = review ? { status: 'proposal', draftFields: review.fields, unchanged: review.unchanged } : previous;
      if (review?.unchanged && !previous) throw Error('requirements_empty');
      const plannedReceipt = review ? (review.unchanged ? '已有相同需求，无需重复保存。' : '需求变更提案已备好，尚未写入需求草稿，请打开需求摘要核对后保存。')
        : submission.action === 'request_designer' ? '接待请求已提交，等待企业接待；未接通、未预约、未共享手机号。'
          : submission.action === 'cancel_designer' ? '已有接待请求已取消。' : '';
      if (submission.action === 'cancel_designer' && !['waiting', 'active'].includes(context.handoff.handoff?.state || '')) throw Error('no_active_handoff');
      // The isolated native-framework comparison measures semantic mistakes as
      // failures; it must not label an absent model judgment as a passing one.
      const verdict = verify === 'measure_native_proposals' ? null : await verify({ currentUser: context.customerMessages.at(-1)!.text, historicalCustomerClauses: requirementSources(context.customerMessages),
        state: { draftStatus: previous?.status || 'absent', savedItems: requirementItems(context.customerMessages, previous?.draftFields), handoff: context.handoff.handoff?.state || 'none' },
        proposedAction: submission.action, changes: submission.changes, proposedState: { status: projected?.status || 'absent',
          items: projected ? requirementItems(context.customerMessages, projected.draftFields) : [], requiresCustomerReview: projected?.status === 'draft' },
        selectedEvidence: evidence, currentCompanyEvidenceAvailable: context.knowledge.length > 0,
        answer: submission.answer, plannedReceipt });
      await this.base.fresh(context);
      if (verdict && (!verdict.authorized || !verdict.changesFaithful || !verdict.answerTruthful || !verdict.questionAnswered)) {
        return { ok: false as const, terminal: false, code: 'semantic_rejected', problems: verdict.problems, verdict };
      }
      return { ok: true as const, prepared: { digest: fingerprint(raw), submission, context, projected, evidence } satisfies Prepared, verdict };
    } catch (e) {
      if (String((e as Error).message).startsWith('boundary_validator_unavailable')) throw e;
      return { ok: false as const, terminal: false, code: String((e as Error).message), problems: ['Known rejection; nothing executed. Refresh references or correct the submission.'] };
    }
  }
  async execute(prepared: Prepared, key: string, raw: Row) {
    // Retain the adapter invocation identity for audit; no model call writes business state.
    assert.ok(key);
    assert.equal(fingerprint(raw), prepared.digest, 'prepared_payload_changed');
    const { context, submission } = prepared;
    await this.base.fresh(context);
    let receipt: Row | undefined;
    if (submission.action === 'propose_requirements') {
      const result = await this.base.requirements.propose(this.conversationId, key, {
        sourceSeq: context.sourceSeq, baseSummaryId: context.requirements.latest?.id || null, changes: submission.changes,
      }, (repo, c) => this.base.guard(context, repo, c));
      if (result.kind === 'existing') receipt = { action: submission.action, effect: 'existing',
        entity: { id: result.summary.id, version: result.summary.version, status: result.summary.status },
        text: '已有相同需求，无需重复保存。\n' + anythingLlmRequirementText(result.summary) };
      else if (result.kind === 'superseded') receipt = { action: submission.action, effect: 'superseded', entity: { id: result.proposalId, status: 'superseded' },
        text: '上次提案已失效或已处理，请重新打开需求摘要查看当前内容；本次没有写入需求。' };
      else receipt = { action: submission.action, effect: 'proposal', entity: { id: result.proposal.id, status: 'pending' },
        proposal: result.proposal, text: '需求变更提案已备好，尚未写入需求草稿。请打开需求摘要核对后保存；保存草稿不代表正式确认。'
          + '\n' + result.proposal.diff.map((d: Row) => `${d.before || '尚未保存'} → ${d.after || '删除此项'}`).join('\n')
          + (result.proposal.requiresRestoreConsent ? '\n本次引用了较早的原话，恢复历史值前需要再次确认。' : '') };
    } else if (submission.action !== 'none') {
      receipt = { action: submission.action, effect: 'proposal', entity: { kind: 'handoff_proposal', status: 'pending' },
        text: submission.action === 'request_designer'
          ? '请在接待页确认提交设计师接待请求。当前尚未提交、接通或预约，也没有分享手机号。'
          : '请在接待页确认取消接待请求。当前接待状态尚未改变，需求保持原样。' };
    }
    // Readback of an acknowledged mutation must not depend on an embedding call.
    const now = await this.base.context(false);
    assert.equal(now.epoch, context.epoch); assert.equal(now.sourceSeq, context.sourceSeq);
    return { ok: true, terminal: true, text: [receipt?.text, submission.answer,
      ...prepared.evidence.map(e => `企业资料依据：${e.text}`)].filter(Boolean).join('\n\n'), receipt,
      evidence: prepared.evidence, resultingContext: now };
  }
}
