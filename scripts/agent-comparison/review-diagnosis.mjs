import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '../..'), directory = path.join(root, 'tmp/agent-diagnosis');
// This audits named first-draft evidence; it is not a scorer for future samples.
const input = process.argv[2] || 'trial-2026-10-25T01-28-29-319Z.json';
assert.ok(input && path.basename(input) === input);
const report = JSON.parse(fs.readFileSync(path.join(directory, input), 'utf8'));
assert.ok(report.finished && report.mode === 'live'); assert.deepEqual(report.drift, []);
const cases = report.cases.filter(c => c.result), receipts = cases.filter(c => c.receipt);
const fields = c => JSON.stringify(c.after?.requirements.latest?.draftFields || {});
const state = c => c.after?.requirements.latest?.id || null;
const finalMatchesReceipt = c => {
  const { entity, action } = c.receipt.receipt;
  if (c.result.textResponse !== c.receipt.text) return false;
  if (action === 'save_requirements') return entity.id === state(c) && entity.version === c.after.requirements.latest.version;
  if (action === 'request_designer' || action === 'cancel_designer') return entity.status === c.after.handoff.handoff?.state;
  return true;
};
const variants = Object.fromEntries(['baseline', 'split'].map(variant => {
  const completed = cases.filter(c => c.variant === variant), calls = report.calls.filter(c => c.variant === variant);
  return [variant, { completed: completed.length, calls: calls.length, tokens: calls.reduce((n, c) => n + c.usage.total_tokens, 0),
    corrections: completed.filter(c => c.id.endsWith('.mixed')).map(c => ({ id: c.id,
      realWrite: state(c) !== c.before.requirements.latest?.id, heatingRetained: /地暖不做/.test(fields(c)),
      budget10AndTile: /10万/.test(fields(c)) && /瓷砖/.test(fields(c)), answer: c.result.textResponse })) }];
}));
const claimCases = [
  { id: 'pydanticai.baseline.2.followup', claim: '当前需求记录（待审核草稿）', actual: 'No saved draft exists.' },
  { id: 'pydanticai.split.1.followup', claim: '已为您取消设计师接待请求', actual: 'No handoff exists; no cancellation tool call.' },
  { id: 'pydanticai.split.2.followup', claim: '已为您取消设计师接待请求', actual: 'No handoff exists; no cancellation tool call.' },
  { id: 'pydanticai.split.2.mixed', claim: '已为您更新需求', actual: 'Draft ID unchanged; budget remains12万 and wood flooring.' },
].map(item => {
  const row = cases.find(c => c.id === item.id); assert.ok(row && row.result.textResponse.includes(item.claim));
  if (item.id === 'pydanticai.baseline.2.followup') assert.equal(row.after.requirements.latest, null);
  else if (item.id.endsWith('.followup')) assert.equal(row.after.handoff.handoff, null);
  else {
    assert.equal(row.before.requirements.latest.id, row.after.requirements.latest.id);
    assert.match(fields(row), /12万/); assert.match(fields(row), /木地板/);
  }
  const raw = report.calls.find(c => c.case === item.id).response.choices[0].message;
  assert.equal(raw.tool_calls?.length || 0, 0, 'Original provider prose, not lost framework tool calls');
  return { ...item, providerToolCalls: 0, before: row.before, after: row.after, originalAnswer: raw.content };
});
const observed = report.calls.reduce((n, c) => n + c.usage.total_tokens, 0), prior = report.authorization;
const result = { evidence: input, version: report.version, originalProviderOutcomes: report.calls.length,
  unknown: report.unknownCalls, stableBindings: Object.keys(report.bindingBefore).length, variants,
  receipts: { delivered: receipts.length, matched: receipts.filter(finalMatchesReceipt).length },
  withdrawals: { inputsExcludeRetiredDuration: report.calls.filter(c => ['withdrawal', 'reversal', 'contact', 'cancel'].some(t => c.case.endsWith('.' + t)))
    .every(c => !/90\s*分钟/.test(JSON.stringify(c.request.messages))),
    customerAnswersRemainIncomplete: ['pydanticai.baseline.1.withdrawal', 'pydanticai.baseline.2.withdrawal'] },
  firstDraftFalseClaims: claimCases,
  stop: { reason: 'Inherited comparison cap: next full reservation rejected locally, before provider dispatch.',
    blockedBeforeDispatch: 'pydanticai.baseline.2.reversal', unexecuted: ['baseline.2.reversal', 'baseline.2.contact', 'baseline.2.cancel'],
    baselineJourney: 'First complete eight-turn journey fails; second has five evaluated turns and three unverified turns. Do not report0/2 completed journeys.',
    splitFourTurnJourneys: { completed: 2, passed: 0 } },
  budget: { observedNewTokens: observed, conservativeNewMicros: observed * 5, cumulativeTokens: prior.previousPlanTokens + prior.previousPilotTokens + prior.previousComparisonTokens + observed,
    cumulativeMicros: prior.previousPlanMicros + (prior.previousPilotTokens + prior.previousComparisonTokens + observed) * 5,
    comparisonTokens: prior.previousComparisonTokens + observed, comparisonRemaining: 140000 - prior.previousComparisonTokens - observed, actualBilledYuan: null },
  limits: 'Same configured model only; no cross-model attribution, original-product benchmark, Mini Program migration or native acceptance.' };
const output = path.join(directory, input.replace(/^trial-/, 'review-'));
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: path.relative(root, output), receipts: result.receipts, variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { completed: v.completed, calls: v.calls, tokens: v.tokens, corrections: v.corrections.map(c => ({ ...c, answer: undefined })) }])), budget: result.budget, falseClaims: claimCases.map(c => c.id), unexecuted: result.stop.unexecuted }));
