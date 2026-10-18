import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from '../../../../scripts/fixtures/assistant-knowledge-semantic-counterexamples.json';
import { checkJointPremiseAttribution, checkKnowledgeSourceCoverage, checkOversizeDispatchRejection,
  type KnowledgeSourceSnapshot, type DispatchObservation } from '../../../../scripts/assistant-knowledge-semantic-rules';
import { fingerprint } from '../contracts';
import { focusedSynthesisMessages } from '../agent/synthesis';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { agentModelLimits, type ModelMessage } from '../contracts/model';

const four = fixture.fourSource, budget = fixture.budget;
const sources = four.selectedSources as KnowledgeSourceSnapshot[];
const prepare = (messages: ModelMessage[]) => agentChatBody({ model: 'synthetic-offline', messages, tools: [], maxTokens: 2048 }, 'https://api.deepseek.com');
const system = () => ({ role: 'system' as const, content: [{ type: 'text' as const, text: 'x'.repeat(budget.focusedLedger[0].bytes) }] });
function messages(tool: unknown = four.toolPayload): ModelMessage[] {
  return [system(), structuredClone(four.currentUserMessage) as ModelMessage, structuredClone(four.searchCallMessage) as ModelMessage,
    { role: 'tool', callId: four.toolCallId, content: JSON.stringify(tool) }];
}
function historicalBudgetMessages(): ModelMessage[] {
  // Byte-equivalent opaque reconstruction, independent of future formatter fixes.
  return budget.focusedLedger.map(entry => {
    const text = 'x'.repeat(entry.bytes);
    if (entry.role === 'system' || entry.role === 'user') return { role: entry.role, content: [{ type: 'text', text }] };
    if (entry.role === 'assistant') return structuredClone(four.searchCallMessage) as ModelMessage;
    if (entry.role === 'tool') return { role: 'tool', callId: four.toolCallId, content: text };
    throw Error('Unknown historical message role');
  });
}
function included(tool: { synthesisSources: Array<{ sourceId: string; kind: string; text: string; professional?: unknown; applicability?: unknown; context?: unknown }> }) {
  return tool.synthesisSources.filter(s => s.kind === 'knowledge').map(s => {
    const expected = sources.find(e => e.sourceId === s.sourceId)!;
    // Original server identity stays outside the model envelope; only a known source ID can join it.
    return { ...structuredClone(expected), text: s.text, model: { professional: s.professional, applicability: s.applicability, context: s.context } };
  });
}

for (const captured of fixture.attribution) {
  test(`run ${captured.runId}: exact quotes and globally cited sides do not certify paragraph attribution`, () => {
    const original = JSON.stringify(captured);
    for (const segment of captured.segments) for (const citation of segment.citations) {
      assert.ok(captured.sources.find(s => s.sourceId === citation.sourceId)?.text.includes(citation.quote));
    }
    assert.equal(new Set(captured.segments.flatMap(s => s.citations.map(c => c.sourceId))).size, 2);
    const check = checkJointPremiseAttribution(captured.segments, captured.sources, captured.expectation);
    assert.equal(check.passed, false); assert.deepEqual(check.violations, ['missing_same_paragraph_support:K1002']);
    assert.equal(check.semanticCorrectness, 'requires_review'); assert.equal(JSON.stringify(captured), original);
  });
  test(`run ${captured.runId}: an offline corrected specimen cites the complete premise from both original versions`, () => {
    const segments = structuredClone(captured.segments), second = captured.expectation.support[1];
    segments[captured.expectation.segmentIndex].citations.push({ sourceId: second.sourceId, quote: second.quote });
    assert.equal(checkJointPremiseAttribution(segments, captured.sources, captured.expectation).passed, true);
    assert.equal(captured.segments[captured.expectation.segmentIndex].citations.length, 2, 'The real failed answer is not overwritten');
  });
}
test('a complete quote in another paragraph cannot support the declared shared claim', () => {
  const c = fixture.attribution[0], segments = structuredClone(c.segments), second = c.expectation.support[1];
  segments[2].citations.push({ sourceId: second.sourceId, quote: second.quote });
  assert.equal(checkJointPremiseAttribution(segments, c.sources, c.expectation).passed, false);
});
test('two copies from one side cannot substitute for both distinct documents', () => {
  const c = fixture.attribution[0], segments = structuredClone(c.segments), first = c.expectation.support[0];
  segments[3].citations.push({ sourceId: first.sourceId, quote: first.quote });
  assert.equal(checkJointPremiseAttribution(segments, c.sources, c.expectation).passed, false);
});
test('a truncated condition remains an exact substring but fails complete-premise support', () => {
  const c = fixture.attribution[0], segments = structuredClone(c.segments), second = c.expectation.support[1];
  segments[3].citations.push({ sourceId: second.sourceId, quote: second.quote.slice(0, 12) });
  assert.equal(checkJointPremiseAttribution(segments, c.sources, c.expectation).passed, false);
});
for (const field of ['documentId', 'version', 'hash']) test(`joint premise refuses a stale or substituted ${field}`, () => {
  const c = structuredClone(fixture.attribution[0]), second = c.expectation.support[1];
  c.segments[3].citations.push({ sourceId: second.sourceId, quote: second.quote });
  if (field === 'version') c.sources[1].ref.version = 'different'; else c.sources[1][field as 'documentId' | 'hash'] = 'different';
  assert.equal(checkJointPremiseAttribution(c.segments, c.sources, c.expectation).passed, false);
});
test('empty, one-sided or same-document expectations cannot vacuously pass a joint claim', () => {
  const c = fixture.attribution[0];
  for (const support of [[], c.expectation.support.slice(0, 1), [c.expectation.support[0], { ...c.expectation.support[1], documentId: c.expectation.support[0].documentId }]]) {
    assert.equal(checkJointPremiseAttribution(c.segments, c.sources, { ...c.expectation, support }).passed, false);
  }
});

test('all five selected canonical chunks across four fixed documents survive the existing projection intact', () => {
  assert.equal(new Set(sources.map(s => s.documentId)).size, 4); assert.equal(sources.length, 5);
  const original = JSON.stringify(four.toolPayload), before = messages();
  const focused = focusedSynthesisMessages(before, four.triggerMessageId);
  const tool = JSON.parse((focused.find(m => m.role === 'tool') as { content: string }).content);
  assert.equal(checkKnowledgeSourceCoverage(four.requiredDocumentIds, sources, included(tool)).passed, true);
  assert.equal(JSON.stringify(four.toolPayload), original); assert.equal(JSON.stringify(before), JSON.stringify(messages()));
});
test('losing a fourth document fails coverage even when repeated leading chunks still fill five slots', () => {
  const missing = sources.filter(s => s.documentId !== four.requiredDocumentIds[3]);
  missing.push(structuredClone(sources[0]));
  const check = checkKnowledgeSourceCoverage(four.requiredDocumentIds, sources, missing);
  assert.equal(check.passed, false); assert.ok(check.violations.includes('missing_source:K989'));
});
test('dropping a useful repeated chunk fails complete consulted-source coverage despite retaining four documents', () => {
  const shortened = sources.slice(0, -1); assert.equal(new Set(shortened.map(s => s.documentId)).size, 4);
  assert.equal(checkKnowledgeSourceCoverage(four.requiredDocumentIds, sources, shortened).passed, false);
});
for (const field of ['text', 'version', 'origin', 'applicability', 'context']) test(`source coverage refuses altered ${field}`, () => {
  const changed = structuredClone(sources);
  if (field === 'text') { changed[0].text = changed[0].text.slice(0, 100); changed[0].hash = fingerprint(changed[0].text); }
  else if (field === 'version') changed[0].ref.version = 'different';
  else if (field === 'origin') (changed[0].model.professional as { origin: { locator: string } }).origin.locator = 'different';
  else if (field === 'applicability') changed[0].model.applicability = { status: 'unknown' };
  else changed[0].model.context = { stage: 'different' };
  assert.equal(checkKnowledgeSourceCoverage(four.requiredDocumentIds, sources, changed).passed, false);
});
test('unexpected sources and empty required-source declarations cannot pass coverage', () => {
  assert.equal(checkKnowledgeSourceCoverage([], sources, sources).passed, false);
  assert.equal(checkKnowledgeSourceCoverage(four.requiredDocumentIds, [], []).passed, false);
  assert.equal(checkKnowledgeSourceCoverage(four.requiredDocumentIds, sources, [...sources, { ...sources[0], sourceId: 'foreign' }]).passed, false);
});

test('the historical 48,553-byte request is rejected independently of subsequent formatter repairs', () => {
  const focused = historicalBudgetMessages();
  const measured = focused.reduce((n, m) => n + Buffer.byteLength(typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('\n')), 0);
  assert.equal(budget.focusedTextBytes, 48553); assert.equal(measured, 48553);
  assert.equal(budget.limit, 48000); assert.equal(agentModelLimits.maxTextBytes, 48000);
  assert.throws(() => prepare(focused), /agent_input_limit/);
  const check = checkOversizeDispatchRejection(measured, budget.limit, budget.observed);
  assert.equal(check.passed, false); assert.ok(check.violations.includes('provider_started_before_rejection'));
  assert.ok(check.violations.includes('not_known_failed')); assert.ok(check.violations.includes('turn_attempt_not_known_unaccepted'));
  assert.ok(!check.violations.includes('prior_cost_reconciliation_lost'), 'Earlier real calls still require their cost reservation');
});
const localRejection = (priorBillableUnsettled = false): DispatchObservation => ({ events: [{ kind: 'attempt_created' }, { kind: 'preparation_rejected', code: 'agent_input_limit' }],
  httpCalls: 0, terminalStatus: 'failed', reservationStatus: priorBillableUnsettled ? 'reconciling' : 'released', priorBillableUnsettled,
  providerAttempts: [{ status: 'failed', accepted: false }] });
test('an offline positive port rejects oversized input before dispatch and releases a reservation with no prior billable I/O', () => {
  assert.equal(checkOversizeDispatchRejection(48553, 48000, localRejection()).passed, true);
});
test('known local rejection preserves reconciliation of earlier real calls and cannot release their unknown cost', () => {
  const trace = localRejection(true);
  assert.equal(checkOversizeDispatchRejection(48553, 48000, trace).passed, true);
  trace.reservationStatus = 'released';
  assert.ok(checkOversizeDispatchRejection(48553, 48000, trace).violations.includes('prior_cost_reconciliation_lost'));
});
test('a created target attempt must finish as known unaccepted, independently of the run status', () => {
  for (const attempt of [{ status: 'unknown', accepted: true }, { status: 'failed', accepted: true }, { status: 'created', accepted: false }]) {
    const trace = localRejection(); trace.providerAttempts = [attempt];
    assert.ok(checkOversizeDispatchRejection(48553, 48000, trace).violations.includes('turn_attempt_not_known_unaccepted'));
  }
});
for (const defect of ['late_marker', 'http', 'unknown', 'reservation', 'no_preparation']) test(`oversize rejection refuses ${defect}`, () => {
  const trace = localRejection();
  if (defect === 'late_marker') trace.events.push({ kind: 'provider_started' });
  else if (defect === 'http') { trace.httpCalls = 1; trace.events.push({ kind: 'http_dispatched' }); }
  else if (defect === 'unknown') trace.terminalStatus = 'indeterminate';
  else if (defect === 'reservation') trace.reservationStatus = 'reconciling';
  else trace.events = [];
  assert.equal(checkOversizeDispatchRejection(48553, 48000, trace).passed, false);
});
test('raising the limit cannot relabel the captured oversized dispatch as accepted', () => {
  assert.equal(checkOversizeDispatchRejection(48553, 50000, localRejection()).passed, false);
});
test('preparation enforces UTF-8 bytes at the boundary, including supplementary Unicode', () => {
  const text = '😀'.repeat(12000); assert.equal(Buffer.byteLength(text), 48000); assert.equal(text.length, 24000);
  assert.doesNotThrow(() => prepare([{ role: 'system', content: [{ type: 'text', text }] }]));
  assert.throws(() => prepare([{ role: 'system', content: [{ type: 'text', text: text + '中' }] }]), /agent_input_limit/);
});
test('a test-only fitting specimen removes redundant hints while preserving all canonical sources; cutting a source cannot pass', () => {
  const compact = structuredClone(four.toolPayload) as Record<string, unknown> & { synthesisSources: Array<Record<string, unknown>> };
  delete compact.evidence; for (const s of compact.synthesisSources) delete s.citationQuotes;
  assert.doesNotThrow(() => prepare(messages(compact)));
  assert.equal(checkKnowledgeSourceCoverage(four.requiredDocumentIds, sources, included(compact as unknown as Parameters<typeof included>[0])).passed, true);
  compact.synthesisSources = compact.synthesisSources.filter(s => s.sourceId !== 'K989');
  assert.doesNotThrow(() => prepare(messages(compact)));
  assert.equal(checkKnowledgeSourceCoverage(four.requiredDocumentIds, sources, included(compact as unknown as Parameters<typeof included>[0])).passed, false);
});
