import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '../..'), directory = path.join(root, 'tmp/agent-contract');
const file = process.argv[2]; assert.ok(file && path.basename(file) === file);
const report = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
assert.equal(report.mode, 'live'); assert.ok(report.finished); assert.deepEqual(report.drift, []);
const text = c => Object.values(c.after?.requirements.latest?.draftFields || {}).map(v => v.text).join('；');
const sameRequirements = c => JSON.stringify(c.before.requirements) === JSON.stringify(c.after?.requirements);
// Appending the current customer message legitimately increments the outer
// conversation version. Compare handoff business state, not that metadata.
const sameHandoff = c => c.before.handoff.mode === c.after?.handoff.mode
  && JSON.stringify(c.before.handoff.handoff) === JSON.stringify(c.after?.handoff.handoff);
const turns = ['inquiry', 'followup', 'save', 'mixed', 'withdrawal', 'reversal', 'contact', 'cancel'];
const checks = report.cases.map(c => {
  const submissions = report.submissions.filter(s => s.case === c.id), calls = report.calls.filter(s => s.case === c.id);
  const after = c.after, summary = after?.requirements.latest, handoff = after?.handoff.handoff;
  const structured = c.deliveredValidated === true && !c.error && !c.unknownWrite;
  const facts = !!summary && summary.status === 'draft' && /90平/.test(text(c)) && /地暖不做/.test(text(c));
  const singleWrite = c.summaryCountAfter === c.summaryCountBefore + 1;
  let businessState = false;
  if (structured && ['inquiry', 'followup', 'withdrawal'].includes(c.turn)) businessState = sameRequirements(c)
    && sameHandoff(c) && c.summaryCountBefore === c.summaryCountAfter;
  if (structured && ['save', 'mixed', 'reversal'].includes(c.turn)) businessState = facts && singleWrite && !handoff
    && (c.turn === 'save' ? /12万/.test(text(c)) && /木地板/.test(text(c))
      : c.turn === 'mixed' ? /10万/.test(text(c)) && !/12万|木地板/.test(text(c)) && /瓷砖/.test(text(c))
        : /12万/.test(text(c)) && !/10万|木地板/.test(text(c)) && /瓷砖/.test(text(c)));
  if (structured && c.turn === 'contact') businessState = sameRequirements(c) && handoff?.state === 'waiting'
    && handoff.contactConsent === false && !handoff.phone;
  if (structured && c.turn === 'cancel') businessState = sameRequirements(c) && handoff?.state === 'cancelled'
    && handoff.contactConsent === false && !handoff.phone;
  const noRetiredInput = c.turn !== 'withdrawal' || calls.every(a => !/90\s*分钟/.test(JSON.stringify(a.request.messages)));
  const noRetiredAnswer = c.turn !== 'withdrawal' || !/90\s*分钟/.test(c.result?.textResponse || '');
  const receipt = c.receipt;
  const receiptMatches = !receipt ? !['save', 'mixed', 'reversal', 'contact', 'cancel'].includes(c.turn)
    : c.result?.textResponse?.startsWith(receipt.text) && (receipt.action === 'save_requirements'
      ? receipt.entity.id === summary?.id && receipt.entity.version === summary?.version
      : receipt.entity.status === handoff?.state);
  const first = submissions[0];
  return { id: c.id, engine: c.engine, trial: c.trial, turn: c.turn, structured, businessState,
    noRetiredInput, noRetiredAnswer, receiptMatches: !!receiptMatches,
    passed: structured && businessState && noRetiredInput && noRetiredAnswer && !!receiptMatches,
    firstSubmissionValidated: first?.validated === true, firstDraftRejection: first?.rejected,
    firstVerdict: first?.verdict, submissions: submissions.length, knownRecovery: c.recovery?.length || 0,
    error: c.error, answer: c.result?.textResponse };
});
const engines = Object.fromEntries(report.scope.engines.map(engine => {
  const rows = checks.filter(c => c.engine === engine);
  return [engine, { evaluated: rows.length, statePassed: rows.filter(c => c.passed).length,
    firstSubmissionValidated: rows.filter(c => c.firstSubmissionValidated).length,
    completeJourneys: [1, 2].map(trial => { const cases = rows.filter(c => c.trial === trial);
      return { trial, complete: turns.every(turn => cases.some(c => c.turn === turn)), passed: cases.length === 8 && cases.every(c => c.passed) }; }),
    unresolved: rows.filter(c => !c.passed).map(c => c.id) }];
}));
const usage = Object.fromEntries(['native_agent', 'semantic_boundary'].map(kind => {
  const calls = report.calls.filter(c => c.kind === kind); return [kind, { calls: calls.length, tokens: calls.reduce((n,c) => n+(c.usage?.total_tokens || 0),0) }];
}));
const review = { version: 'native-contract-review-2', evidence: file, sourceBindings: Object.keys(report.bindingBefore).length, drift: report.drift,
  engines, checks, usage, unknown: report.unknownCalls, actualBilledYuan: null,
  cumulativeTokens: report.previousPlanTokens + report.earlierTokens + report.priorContractTokens + report.observedTokens,
  cumulativeUpperMicros: report.previousPlanMicros + (report.earlierTokens + report.priorContractTokens + report.observedTokens) * 5,
  transcriptReview: 'Deterministic state/receipt/withdrawal checks only. Read every original answer separately for semantic completeness; do not treat the same-model boundary verdict as independent acceptance.',
  validationMeaning: 'Submission validation is deterministic protocol/service checking, not a semantic pass or necessarily the first raw model output. Judge is null in the native-only batch. Review-v1 incorrectly compared outer conversation version, which changes on each user append; its file remains separate.',
};
const output = path.join(directory, file.replace(/^trial-/, 'review-').replace(/\.json$/, '-v2.json')); fs.writeFileSync(output, JSON.stringify(review, null, 2));
console.log(JSON.stringify({ output: path.relative(root, output), engines, usage, unknown: review.unknown,
  cumulativeTokens: review.cumulativeTokens, cumulativeUpperMicros: review.cumulativeUpperMicros }));
