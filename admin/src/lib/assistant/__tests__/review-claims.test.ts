import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint } from '../contracts';
import { requirementItems, applyRequirementChanges, requirementSources } from '../requirements/items';
import { reviewClaims, resolveReviewClaims, assertReviewClaimSegments, reviewClaimDefinition, reviewClaimProtocol } from '../agent/review-claims';
import type { HistorySnapshot } from '../agent/history';
import { historySynthesisSources } from '../agent/history-sources';
import { nativeFinalDefinition, nativeFinalProtocol } from '../agent/native-final';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { finalTool } from '../agent/worker';
import { parseSynthesis } from '../agent/synthesis';
import { assertRecordedReply } from '../agent/memory';
import { agentConfig, agentCapabilityFingerprint } from '../agent/config';

const messages = [{ id: '1', text: '预算12万' }, { id: '2', text: '预算先改成10万吧，瓷砖和地暖照旧。' },
  { id: '3', text: '还是别用刚才那个数，预算先保持原来。量房时我要带哪些资料？' },
  { id: '4', text: '预算提高到15万，瓷砖和地暖先照旧。另外老房量房时有哪些容易漏的地方？' }];
const source = (id: string) => requirementSources(messages).find(source => source.sourceMessageId === id)!;
const initial = applyRequirementChanges(messages, null, [{ operation: 'add', field: 'budget', sourceId: source('1').id }]);
const changed = (id: string) => applyRequirementChanges(messages, initial, [{ operation: 'replace',
  targetId: requirementItems(messages, initial)[0].id, sourceId: source(id).id }]);
function context(state: 'pending_proposal' | 'expired_proposal') {
  const originals: HistorySnapshot = { query: 'existing requirement originals', beforeSeq: '4', hasMore: false, oversized: false,
    sources: messages.map((message, index) => ({ messageId: message.id, text: message.text, seq: String(index + 1), hash: fingerprint(message.text), memoryVersion: 0 })) };
  return reviewClaims({ binding: { summaryId: 'saved-12', proposal: state }, originals,
    saved: requirementItems(messages, initial), proposed: requirementItems(messages, changed(state === 'pending_proposal' ? '4' : '2')), proposalState: state });
}
const advice = { basis: 'advice', text: '老房量房可带现有户型图和物业装修规定，现场核对墙体、漏水痕迹及设备位置。', citations: [] };
test('old amount is inseparable from its actual original; withdrawal does not acquire adoption', () => {
  const catalog = context('expired_proposal'), sources = historySynthesisSources(catalog.originals);
  const old = catalog.claims.find(claim => claim.state === 'expired_proposal')!;
  assert.equal(old.segment.citations[0].sourceId, 'H2');
  assert.match(old.segment.citations[0].quote, /10万/);
  assert.match(old.segment.text, /已失效/);
  const raw = JSON.stringify({ kind: 'synthesis', segments: [{ claimId: old.claimId }, advice] });
  const answer = parseSynthesis(resolveReviewClaims(raw, catalog), sources);
  assert.doesNotThrow(() => assertRecordedReply(answer.segments.map(segment => segment.text).join('\n'), { version: 0, facts: [] }, 'run'));
  const staleFailure = { kind: 'synthesis', segments: [{ basis: 'evidence', text: '之前提到的10万不采用，仍沿用原记录中的12万。',
    citations: sources.filter(source => ['H1', 'H3'].includes(source.sourceId)).map(source => ({ sourceId: source.sourceId, quote: source.text })) }] };
  assert.throws(() => parseSynthesis(JSON.stringify(staleFailure), sources), /unsupported_model_commitment/);
});
test('pending amount cannot be realized as a completed update, and advice remains generated content', () => {
  const catalog = context('pending_proposal'), claim = catalog.claims.find(claim => claim.state === 'pending_proposal')!;
  assert.match(claim.segment.text, /待采用/); assert.match(claim.segment.text, /尚未写入草稿/);
  const raw = JSON.stringify({ kind: 'synthesis', segments: [advice, { claimId: claim.claimId }] });
  const expanded = resolveReviewClaims(raw, catalog), answer = parseSynthesis(expanded, historySynthesisSources(catalog.originals));
  assert.equal(answer.segments[0].text, advice.text);
  assert.doesNotThrow(() => assertRecordedReply(answer.segments.map(segment => segment.text).join('\n'), { version: 0, facts: [] }, 'run'));
  assert.throws(() => assertRecordedReply('整体预算意向调整为15万。', { version: 0, facts: [] }, 'run'), /unsupported_model_commitment/);
});
test('state/source/version-bound IDs reject stale, foreign, duplicate and amended claims', () => {
  const catalog = context('pending_proposal'), id = catalog.claims[0].claimId;
  for (const segments of [[{ claimId: 'foreign' }], [{ claimId: id, text: '预算已调整' }], [{ claimId: id }, { claimId: id }]])
    assert.throws(() => resolveReviewClaims(JSON.stringify({ kind: 'synthesis', segments }), catalog), /invalid_model_citation/);
  const expired = context('expired_proposal');
  assert.throws(() => resolveReviewClaims(JSON.stringify({ kind: 'synthesis', segments: [{ claimId: id }] }), expired), /invalid_model_citation/);
});
test('native schema accepts claim IDs and real explanation; free customer amounts/states cannot replace claims', async () => {
  const catalog = context('pending_proposal'), tool = reviewClaimDefinition(nativeFinalDefinition(finalTool), catalog);
  assert.doesNotMatch(JSON.stringify(tool.parameters), /"enum":\[\]/);
  const claim = catalog.claims.find(claim => claim.state === 'pending_proposal')!;
  assert.equal(await toolSchemaIssue(tool, JSON.stringify({ kind: 'synthesis', segments: [advice, { claimId: claim.claimId }] })), null);
  for (const raw of [{ kind: 'general', text: '预算已调整为15万' }, { kind: 'synthesis', segments: [{ ...advice, text: '预算调整为15万。' }] },
    { kind: 'synthesis', segments: [{ claimId: claim.claimId, state: 'saved_draft' }] }])
    assert.ok(await toolSchemaIssue(tool, JSON.stringify(raw)));
});
test('one repair and crash recovery retain exact claims; editing their adoption state stays forbidden', () => {
  const catalog = context('pending_proposal'), claim = catalog.claims.find(claim => claim.state === 'pending_proposal')!;
  const normalized = resolveReviewClaims(JSON.stringify({ kind: 'synthesis', segments: [{ claimId: claim.claimId }, advice] }), catalog);
  assert.equal(resolveReviewClaims(normalized, catalog), normalized);
  assert.doesNotThrow(() => assertReviewClaimSegments(normalized, catalog));
  const amended = JSON.parse(normalized); amended.segments[0].text = '预算调整为15万';
  assert.throws(() => assertReviewClaimSegments(JSON.stringify(amended), catalog), /invalid_model_citation/);
  const repair = nativeFinalDefinition({ name: 'final_response', description: 'one existing repair', parameters: {
    type: 'object', properties: { kind: { type: 'string', enum: ['synthesis_repair'] }, edits: { type: 'array' } }, required: ['kind', 'edits'],
  } });
  assert.deepEqual(reviewClaimDefinition(repair, catalog), repair);
});
test('actual adoption replaces pending identity with saved-draft provenance, never inherits an old ID', () => {
  const pending = context('pending_proposal');
  const saved = reviewClaims({ binding: { summaryId: 'new-15', proposal: null }, originals: pending.originals,
    saved: requirementItems(messages, changed('4')), proposed: [], proposalState: null });
  assert.equal(saved.claims.some(claim => claim.state === 'pending_proposal'), false);
  assert.match(saved.claims.find(claim => claim.state === 'saved_draft')!.segment.text, /15万/);
  assert.throws(() => resolveReviewClaims(JSON.stringify({ kind: 'synthesis', segments: [{ claimId: pending.claims[0].claimId }] }), saved), /invalid_model_citation/);
});
test('claim strategy is explicit and run-bound; old finalization config is preserved on rollout', () => {
  const value = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.8-flash', tools: true,
    imageInput: false, probeVersion: 'test', structuredFinal: nativeFinalProtocol };
  const old = agentConfig(value)!, current = agentConfig({ ...value, requirementClaims: reviewClaimProtocol })!;
  assert.equal(old.requirementClaims, undefined); assert.equal(current.requirementClaims, reviewClaimProtocol);
  assert.equal(agentCapabilityFingerprint(old), agentCapabilityFingerprint(current));
  assert.throws(() => agentConfig({ ...value, requirementClaims: 'invalid' }), /forbidden/);
  assert.throws(() => agentConfig({ ...value, structuredFinal: undefined, requirementClaims: reviewClaimProtocol }), /forbidden/);
});
