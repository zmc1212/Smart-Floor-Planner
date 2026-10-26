import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..'), dir = path.join(root, 'tmp/agent-contract');
const name = process.argv[2]; assert.ok(name && path.basename(name) === name);
const r = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
assert.equal(r.version, 'three-agent-review-contract-1'); assert.equal(r.mode, 'live');
assert.ok(r.finished); assert.deepEqual(r.drift, []);
const business = s => ({ latest: s?.requirements.latest, confirmed: s?.requirements.confirmed,
  handoff: s?.handoff.handoff, mode: s?.handoff.mode });
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const summaries = s => ({ latest: s?.requirements.latest, confirmed: s?.requirements.confirmed });
const checks = r.cases.map(c => {
  const subs = r.submissions.filter(s => s.case === c.id), calls = r.calls.filter(s => s.case === c.id);
  // SDK exceptions may lack both readback checkpoints. Missing evidence is not
  // a failed safety assertion; retain it as unknown and audit final DB effects.
  const noWriteBeforeConfirmation = c.beforeConfirmation ? same(business(c.before), business(c.beforeConfirmation))
    && c.summaryCountBefore === c.summaryCountBeforeConfirmation : null;
  const budgetBlocked = calls.length === 0 && /New fixed-batch token cap/.test(c.result?.textResponse || '');
  const output = c.deliveredValidated === true && !c.error && !c.unknownWrite;
  const value = Object.values(c.after?.requirements.latest?.draftFields || {}).map(v => v.text).join('；');
  const draft = c.after?.requirements.latest, handoff = c.after?.handoff.handoff;
  const hasFacts = draft?.status === 'draft' && /90平/.test(value) && /地暖不做/.test(value);
  let completed = false;
  if (['inquiry','followup','withdrawal'].includes(c.turn)) completed = same(business(c.before), business(c.after)) && !c.receipt;
  if (c.turn === 'repeat') completed = same(business(c.before), business(c.after)) && c.summaryCountAfter === c.summaryCountBefore
    && (!c.receipt || c.receipt.effect === 'existing');
  if (['save','mixed','reversal'].includes(c.turn)) completed = hasFacts && !handoff
    && c.clientConfirmation?.expectedDiffAccepted === true && c.summaryCountAfter === c.summaryCountBefore + 1
    && (c.turn === 'save' ? /12万/.test(value) && /木地板/.test(value) && !/10万|瓷砖/.test(value)
      : c.turn === 'mixed' ? /10万/.test(value) && /瓷砖/.test(value) && !/12万|木地板/.test(value)
        : /12万/.test(value) && /瓷砖/.test(value) && !/10万|木地板/.test(value));
  if (['contact','cancel'].includes(c.turn)) completed = same(summaries(c.before), summaries(c.after))
    && handoff?.state === (c.turn === 'contact' ? 'waiting' : 'cancelled') && handoff.contactConsent === false && !handoff.phone;
  const receipt = c.receipt;
  const receiptMatches = !receipt || (c.result?.textResponse?.startsWith(receipt.text) && (receipt.effect === 'existing'
    ? receipt.entity.id === c.beforeConfirmation?.requirements.latest?.id
    : receipt.proposal ? receipt.entity.id === c.beforeConfirmation?.requirements.proposal?.id
      : receipt.entity.kind === 'handoff_proposal' && receipt.entity.status === 'pending'));
  const noRevokedDuration = c.turn !== 'withdrawal' || (!/90\s*分钟/.test(c.result?.textResponse || '')
    && calls.every(call => !/90\s*分钟/.test(JSON.stringify(call.request.messages))));
  return { id: c.id, engine: c.engine, trial: c.trial, turn: c.turn, output, noWriteBeforeConfirmation, budgetBlocked, providerDispatched: calls.length > 0,
    completed, receiptMatches: !!receiptMatches, noRevokedDuration,
    statePassed: !!(output && noWriteBeforeConfirmation && completed && receiptMatches && noRevokedDuration),
    firstSubmissionValidated: subs[0]?.validated === true, submissions: subs.length, nativeCalls: calls.length,
    firstRejection: subs[0]?.rejected, recovery: c.recovery || [], clientConfirmation: c.clientConfirmation,
    proposal: receipt?.proposal, originalAnswer: c.result?.textResponse, error: c.error };
});
const engines = Object.fromEntries(r.scope.engines.map(engine => {
  const cases = checks.filter(c => c.engine === engine);
  return [engine, { cases: cases.length, safeBeforeConfirmation: cases.filter(c => c.noWriteBeforeConfirmation).length,
    safetyCheckpointMissing: cases.filter(c => c.noWriteBeforeConfirmation === null).length,
    attemptedCases: cases.filter(c => c.providerDispatched).length, budgetBlocked: cases.filter(c => c.budgetBlocked).length,
    statePassed: cases.filter(c => c.statePassed).length, completeStateJourneys: [1,2].filter(trial => {
      const chain = cases.filter(c => c.trial === trial); return chain.length === 9 && chain.every(c => c.statePassed);
    }), failures: cases.filter(c => !c.statePassed).map(c => c.id) }];
}));
const result = { version: 'confirmation-review-2', evidence: name, engines, checks,
  calls: r.calls.length, tokens: r.observedTokens, unknown: r.unknownCalls,
  cumulativeTokens: r.previousPlanTokens + r.earlierTokens + r.priorContractTokens + r.observedTokens,
  cumulativeUpperMicros: r.previousPlanMicros + (r.earlierTokens + r.priorContractTokens + r.observedTokens) * 5,
  actualBilledYuan: null,
  limits: 'State/receipt/source checks only. Every original answer still requires offline semantic review. Confirmation is an explicit test-side customer action, never model authorization. No repaired proposal is substituted for a first draft.' };
const output = path.join(dir, name.replace(/^trial-/, 'confirmation-review-')); fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: path.relative(root, output), engines, calls: result.calls, tokens: result.tokens,
  cumulativeTokens: result.cumulativeTokens, cumulativeUpperMicros: result.cumulativeUpperMicros, unknown: result.unknown }));
