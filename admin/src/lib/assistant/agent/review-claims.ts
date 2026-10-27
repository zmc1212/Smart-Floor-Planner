import type { ModelTool } from '../contracts/model';
import { fail, fingerprint } from '../contracts';
import type { RequirementItem } from '../requirements/items';
import type { HistorySnapshot } from './history';
import { historySynthesisSources } from './history-sources';
import { sourceCitationCatalog } from './citation-catalog';
import type { SynthesisSegment } from './synthesis';

export const reviewClaimProtocol = 'requirement-claims-v1';
export type ReviewClaim = {
  claimId: string;
  state: 'saved_draft' | 'pending_proposal' | 'expired_proposal' | 'customer_original';
  field: string | null;
  segment: SynthesisSegment;
};
export type ReviewClaimContext = {
  protocol: typeof reviewClaimProtocol;
  binding: Record<string, unknown>;
  originals: HistorySnapshot;
  claims: ReviewClaim[];
};

/** Values and adoption state are server-owned. The model selects a complete
 * claim, never writes its amount, quotation, state or saved receipt. This is a
 * read model of the existing requirement service, not another facts store. */
export function reviewClaims(input: {
  binding: Record<string, unknown>;
  originals: HistorySnapshot;
  saved: RequirementItem[];
  proposed: RequirementItem[];
  proposalState: 'pending_proposal' | 'expired_proposal' | null;
}): ReviewClaimContext {
  const claims: ReviewClaim[] = [], sources = historySynthesisSources(input.originals);
  const add = (state: ReviewClaim['state'], field: string | null, text: string, messageId: string, quote: string) => {
    const source = sources.find(source => source.history?.messageId === messageId);
    if (!source || !source.text.includes(quote)) fail('context_changed');
    // A claim always owns its exact supporting original, including older
    // unadopted amounts. Adjacent/current citations cannot authorize it.
    const citation = sourceCitationCatalog(source).find(c => c.quote.includes(quote));
    if (!citation) fail('agent_input_limit', 422);
    const segment: SynthesisSegment = { basis: 'evidence', text, citations: [{ sourceId: source.sourceId, quote: citation.quote }] };
    const claimId = 'R' + fingerprint({ binding: input.binding, state, field, segment }).slice(0, 20);
    if (!claims.some(claim => claim.claimId === claimId)) claims.push({ claimId, state, field, segment });
  };
  for (const item of input.saved)
    add('saved_draft', item.field, `当前需求草稿沿用：「${item.text}」。`, item.sourceMessageId, item.text);
  for (const item of input.proposed.filter(item => !input.saved.some(old => old.id === item.id))) {
    if (!input.proposalState) fail('context_changed');
    const text = input.proposalState === 'pending_proposal'
      ? `待采用的需求提案：「${item.text}」；尚未写入草稿，默认保留原需求。`
      : `此前需求提案：「${item.text}」；该提案已失效，不能继续采用，当前草稿保持不变。`;
    add(input.proposalState, item.field, text, item.sourceMessageId, item.text);
  }
  // Complete original speech can explain a referent; it never acquires the
  // authority of the saved draft or a current proposal.
  for (const source of sources) {
    if (source.text.length > 350) continue;
    add('customer_original', null, `客户原话（不代表已采用的需求）：「${source.text}」。`, source.history!.messageId, source.text);
  }
  return { protocol: reviewClaimProtocol, binding: input.binding, originals: input.originals, claims };
}

export function reviewClaimDefinition(tool: ModelTool, context: ReviewClaimContext): ModelTool {
  const branches = tool.parameters.anyOf as Array<Record<string, unknown>>;
  if (!Array.isArray(branches)) fail('invalid_agent_tools', 500);
  if (branches.every(branch => (branch.properties as Record<string, { const?: string }>).kind.const === 'synthesis_repair')) return tool;
  const synthesis = branches.find(branch => (branch.properties as Record<string, { const?: string }>).kind.const === 'synthesis');
  // Native synthesis has the same citation contract as the other final kinds.
  const template = synthesis || branches.find(branch => (branch.properties as Record<string, { const?: string }>).kind.const === 'general');
  if (!template) return tool;
  const sourceIds = new Set(historySynthesisSources(context.originals).flatMap(source => sourceCitationCatalog(source).map(c => c.citationId)));
  const oldProperties = (synthesis?.properties || {}) as Record<string, Record<string, unknown>>;
  const oldSegments = oldProperties.segments;
  const segmentBranches = structuredClone((oldSegments?.items as { anyOf?: Record<string, unknown>[] })?.anyOf || []);
  // Customer values only enter through a state-bound claim. Free explanation
  // keeps genuine knowledge/project citations and the original semantic guards.
  for (const branch of segmentBranches) {
    const properties = branch.properties as Record<string, Record<string, unknown>>;
    const citation = ((properties.citations.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>).citationId;
    citation.enum = ((citation.enum as string[] | undefined) || []).filter(id => !sourceIds.has(id));
    if (!(citation.enum as string[]).length) {
      delete citation.enum; // An empty enum is not a valid provider schema; maxItems=0 closes this path.
      properties.citations.maxItems = 0;
      properties.citations.minItems = 0;
      properties.basis.enum = (properties.basis.enum as string[]).filter(basis => basis !== 'evidence');
      properties.text.pattern = '^[^0-9]*$';
    }
  }
  if (!segmentBranches.length) segmentBranches.push({ type: 'object', properties: {
    basis: { type: 'string', enum: ['advice', 'uncertainty'] }, text: { type: 'string', minLength: 1, maxLength: 1200, pattern: '^[^0-9]*$' },
    citations: { type: 'array', maxItems: 0, items: { type: 'object', properties: { citationId: { type: 'string' } }, required: ['citationId'], additionalProperties: false } },
  }, required: ['basis', 'text', 'citations'], additionalProperties: false });
  if (context.claims.length) segmentBranches.unshift({ type: 'object', properties: {
    claimId: { type: 'string', enum: context.claims.map(claim => claim.claimId) },
  }, required: ['claimId'], additionalProperties: false });
  const other = branches.filter(branch => !['general', 'synthesis', 'vision', 'unavailable'].includes(String((branch.properties as Record<string, { const?: string }>).kind.const)));
  return { ...tool, description: tool.description + ' 客户需求与提案事实只选requirementClaims中的claimId，服务端按原文和真实采用状态生成；自由段回答问题，不改写客户金额或采用状态。', parameters: {
    type: 'object', anyOf: [{ type: 'object', properties: { kind: { type: 'string', const: 'synthesis' },
      segments: { type: 'array', minItems: 1, maxItems: 6, items: { anyOf: segmentBranches } },
    }, required: ['kind', 'segments'], additionalProperties: false }, ...other],
  } };
}

/** Called before the unchanged citation, receipt and response-scope validators.
 * Unknown/stale IDs and model-supplied state/text are errors, never repaired. */
export function resolveReviewClaims(raw: string, context: ReviewClaimContext): string {
  let value: { kind?: string; segments?: Array<Record<string, unknown>> };
  try { value = JSON.parse(raw); } catch { return fail('invalid_model_answer', 502); }
  if (value?.kind !== 'synthesis') return raw;
  if (!Array.isArray(value.segments) || !value.segments.length || value.segments.length > 6) fail('invalid_model_answer', 502);
  const seen = new Set<string>();
  value.segments = value.segments.map(segment => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) fail('invalid_model_answer', 502);
    if (!Object.hasOwn(segment, 'claimId')) return segment;
    if (Object.keys(segment).length !== 1 || typeof segment.claimId !== 'string' || seen.has(segment.claimId)) fail('invalid_model_citation', 502);
    const claim = context.claims.find(claim => claim.claimId === segment.claimId);
    if (!claim) fail('invalid_model_citation', 502);
    seen.add(segment.claimId);
    return structuredClone(claim.segment) as unknown as Record<string, unknown>;
  });
  return JSON.stringify(value);
}

/** The original single repair may edit explanation, never turn a historical
 * customer citation into an invented current value/state. Claim realizations
 * remain exact across repair, checkpoint recovery and final persistence. */
export function assertReviewClaimSegments(raw: string, context: ReviewClaimContext) {
  let value: { kind?: string; segments?: Array<Record<string, unknown>> };
  try { value = JSON.parse(raw); } catch { return fail('invalid_model_answer', 502); }
  if (value?.kind !== 'synthesis' || !Array.isArray(value.segments)) return;
  for (const segment of value.segments) {
    const citations = segment.citations;
    if (!Array.isArray(citations) || !citations.some(citation => typeof citation?.sourceId === 'string' && citation.sourceId.startsWith('H'))) continue;
    if (!context.claims.some(claim => fingerprint(claim.segment) === fingerprint(segment))) fail('invalid_model_citation', 502);
  }
}
