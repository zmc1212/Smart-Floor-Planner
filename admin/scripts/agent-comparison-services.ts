import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { fail, type ActorContext } from '@/lib/assistant/contracts';
import { RequirementService } from '@/lib/assistant/requirements/service';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { conversationKnowledgeRetriever } from '@/lib/assistant/knowledge/retriever';
import { anythingLlmRequirementText, knowledgeQuery } from '@/lib/assistant/integrations/anythingllm';

/** Experiment-only service seam. No production caller imports this file.
 * Intent is chosen by each candidate, then assessed independently. A matching
 * quote is provenance, NOT proof of semantic consent. Real customer use still
 * requires a separate authorization design; existing production guards remain.
 */
export class ComparisonServices {
  readonly requirements: RequirementService;
  readonly handoff: HandoffService;
  constructor(readonly actor: ActorContext, readonly conversationId: string) {
    assert.equal(process.env.SFP_COMPARISON_ISOLATED, '1');
    const db = new URL(process.env.DATABASE_URL!);
    assert.ok(['localhost', '127.0.0.1'].includes(db.hostname) && db.port === '55432' && db.pathname === '/xiaok_embedding_eval');
    this.requirements = new RequirementService(actor);
    this.handoff = new HandoffService(actor);
  }
  private async state() {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor);
      const settings = await repo.settings(true);
      const c = await repo.conversation(this.conversationId);
      const tenant = await one(tx, sql`select code from app.enterprises where id=${this.actor.enterpriseId}`);
      assert.ok(String(tenant?.code).startsWith('synthetic-agent-comparison-'), 'Only this experiment synthetic identities may use the comparison seam');
      const entry = c.entry_snapshot as Row;
      if (c.status !== 'open' || entry.retentionRedacted || c.mode === 'human') fail('context_changed');
      const latest = await one(tx, sql`select coalesce(max(seq),0)::text seq from app.assistant_messages where enterprise_id=${this.actor.enterpriseId} and conversation_id=${this.conversationId} and author_kind='user'`);
      return { epoch: Number(settings!.knowledge_epoch), version: Number(c.version), sourceSeq: String(latest!.seq), mode: String(c.mode) };
    });
  }
  async fresh(context: Pick<ComparisonContext, 'epoch' | 'sourceSeq' | 'version'>) {
    const now = await this.state();
    if (now.epoch !== context.epoch || now.sourceSeq !== context.sourceSeq || now.version !== context.version) fail('context_changed');
  }
  async context() {
    const state = await this.state();
    const customer = await this.requirements.customerEvidence(this.conversationId);
    if (!customer.messages.length || customer.sourceSeq !== state.sourceSeq) fail('context_changed');
    const requirements = await this.requirements.read(this.conversationId);
    const handoff = await this.handoff.customerRead(this.conversationId);
    const knowledge = state.mode === 'ai' ? await conversationKnowledgeRetriever(this.conversationId).retrieve(this.actor, knowledgeQuery(customer.messages), state.epoch) : [];
    await this.fresh(state);
    return { ...state, customerMessages: customer.messages, requirements, handoff, knowledge };
  }
  private async guard(context: ComparisonContext, repo: AssistantRepository, c: Row) {
    const settings = await repo.settings(true);
    const latest = await one(repo.tx, sql`select coalesce(max(seq),0)::text seq from app.assistant_messages where enterprise_id=${this.actor.enterpriseId} and conversation_id=${this.conversationId} and author_kind='user'`);
    if (Number(settings!.knowledge_epoch) !== context.epoch || Number(c.version) !== context.version
      || String(latest!.seq) !== context.sourceSeq || c.status !== 'open'
      || (c.entry_snapshot as Row).retentionRedacted) fail('context_changed');
  }
  async execute(context: ComparisonContext, key: string, name: string, args: Row) {
    await this.fresh(context);
    if (name === 'sfp-comparison-search') {
      if (context.mode !== 'ai' || typeof args.query !== 'string' || !args.query.trim() || args.query.length > 1000) fail('tool_rejected');
      const evidence = await conversationKnowledgeRetriever(this.conversationId).retrieve(this.actor, args.query, context.epoch);
      await this.fresh(context);
      return { text: JSON.stringify(evidence), evidence };
    }
    if (name !== 'sfp-comparison-business') fail('tool_rejected');
    const action = String(args.action);
    if (!['save_requirements', 'request_designer', 'cancel_designer', 'read_status'].includes(action)) fail('tool_rejected');
    if (context.mode !== 'ai' && !['cancel_designer', 'read_status'].includes(action)) fail('handoff_active');
    if (action !== 'read_status' && args.quote !== context.customerMessages.at(-1)?.text) fail('current_quote_required');
    const fragments: string[] = [];
    if (args.answerEvidence !== undefined) {
      if (!Array.isArray(args.answerEvidence) || args.answerEvidence.length > 3) fail('invalid_answer_evidence');
      for (const item of args.answerEvidence) {
        const source = context.knowledge.find(e => e.ref.id === item.refId);
        if (!source || typeof item.quote !== 'string' || !item.quote.trim()) fail('invalid_answer_evidence');
        const start = source.text.indexOf(item.quote), end = start + item.quote.length;
        // Whole sentences preserve qualifications/negation; substring presence
        // alone would allow extracting an affirmative fragment from a prohibition.
        if (start < 0 || (start > 0 && !/[。！？\n】]/.test(source.text[start - 1]))
          || (end < source.text.length && !/[。！？\n]$/.test(item.quote))) fail('invalid_answer_evidence');
        fragments.push(`企业资料原文：${item.quote}`);
      }
    }
    let entity: Row, text: string;
    if (action === 'save_requirements') {
      if (args.sourceSeq !== context.sourceSeq || !Array.isArray(args.fields)) fail('requirements_stale');
      const written = await this.requirements.write(this.conversationId, key, { action: 'draft' },
        { sourceSeq: args.sourceSeq, fields: args.fields }, (repo, c) => this.guard(context, repo, c));
      const latest = (await this.requirements.read(this.conversationId)).latest;
      if (!latest || latest.id !== written.id || latest.version !== written.version || latest.status !== 'draft') fail('receipt_state_changed');
      entity = { kind: 'requirement', id: latest.id, version: latest.version, status: latest.status };
      text = anythingLlmRequirementText(latest, true);
    } else if (action === 'request_designer' || action === 'cancel_designer') {
      const requested = action === 'request_designer';
      await this.handoff.customerWrite(this.conversationId, key,
        requested ? { action: 'request', consent: true, contactConsent: false } : { action: 'cancel' },
        (repo, c) => this.guard(context, repo, c));
      const value = await this.handoff.customerRead(this.conversationId);
      if (value.handoff?.state !== (requested ? 'waiting' : 'cancelled') || value.handoff.contactConsent || value.handoff.phone) fail('receipt_state_changed');
      entity = { kind: 'handoff', id: value.handoff.requestId, status: value.handoff.state, version: value.version };
      text = requested ? '已提交设计师接待请求，正在等待企业接待；尚未接通，没有安排电话或量房预约，也没有分享手机号。'
        : '设计师接待请求已取消，小K已恢复回复。';
    } else {
      const value = await this.handoff.customerRead(this.conversationId);
      entity = { kind: 'business_status', status: String(value.handoff?.state || 'none'), version: value.version };
      const states: Record<string, string> = { waiting: '等待企业接待', active: '正在人工接待', cancelled: '接待请求已取消', ended: '人工接待已结束' };
      text = anythingLlmRequirementText((await this.requirements.read(this.conversationId)).latest)
        + '\n\n' + (states[value.handoff?.state || ''] || '当前没有设计师接待请求。');
    }
    const after = await this.state();
    if (after.epoch !== context.epoch || after.sourceSeq !== context.sourceSeq) fail('context_changed');
    return { text: [text, ...fragments].join('\n\n'), receipt: { protocol: 'sfp-comparison-receipt-v1', action, requestKey: key, entity }, evidence: args.answerEvidence || [] };
  }
}
export type ComparisonContext = Awaited<ReturnType<ComparisonServices['context']>>;

export function comparisonContextData(context: ComparisonContext) {
  const latest = context.requirements.latest;
  return { epoch: context.epoch, sourceSeq: context.sourceSeq, mode: context.mode,
    customerMessages: context.customerMessages,
    requirements: latest ? { id: latest.id, status: latest.status, fields: latest.draftFields } : null,
    handoff: context.handoff.handoff ? { state: context.handoff.handoff.state, contactConsent: context.handoff.handoff.contactConsent } : null,
    knowledge: context.knowledge.map(e => ({ refId: e.ref.id, text: e.text })) };
}
