import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDataset, prepareReview, evaluate, digest, main } from '../assistant-a10.mjs';
import { main as merge } from '../assistant-a10-merge.mjs';

const dataset = JSON.parse(await readFile(new URL('../../../docs/xiaok-assistant-a10-cases.zh-CN.json', import.meta.url), 'utf8'));
function fixture() {
  const d = structuredClone(dataset);
  const conversations = new Map();
  const evidence = { schemaVersion: 1, enterpriseId: d.enterpriseId, results: d.cases.map((c, i) => {
    const conversationId = c.previousCaseId ? conversations.get(c.previousCaseId) : String(i + 1);
    conversations.set(c.id, conversationId);
    return { caseId: c.id, question: c.question, conversationId, messageId: String(i + 100), runId: String(i + 200),
      status: 'succeeded', answerKind: c.expectedKind, answer: 'Synthetic test only', capturedAt: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
      scenarioEvidence: 'Synthetic setup audit', citations: c.expectedKind === 'grounded' ? [{ id: String(i + 300), available: true, version: '2', quote: 'Synthetic evidence' }] : [] };
  }) };
  const review = prepareReview(d, evidence);
  review.reviewedAt = '2025-01-02T00:00:00.000Z'; review.businessDatasetApproved = true;
  for (const r of review.cases) Object.assign(r, { semanticCorrect: true, citationsCorrect: true, scenarioVerified: true, unauthorizedDisclosure: false, fabricatedCommitment: false, notes: 'Synthetic test attestation' });
  return { d, evidence, review };
}
test('candidate contains 60 distinct questions and all seven required categories', () => {
  assert.equal(validateDataset(dataset).cases.length, 60);
  assert.equal(new Set(dataset.cases.map(c => c.category)).size, 7);
});
test('complete synthetic evidence and attestation can pass, without authenticating the reviewer', () => {
  const { d, evidence, review } = fixture();
  const result = evaluate(d, evidence, review);
  assert.equal(result.passed, true); assert.equal(result.groundedCorrectRate, 1);
  assert.match(result.scope, /no identity authentication/);
});
test('preparation never approves or invents answers', () => {
  const review = prepareReview(dataset, { schemaVersion: 1, enterpriseId: dataset.enterpriseId, results: [] });
  assert.equal(review.reviewedAt, null); assert.equal(review.businessDatasetApproved, null);
  assert.ok(review.cases.every(r => r.semanticCorrect === null));
  const report = evaluate(dataset, { schemaVersion: 1, enterpriseId: dataset.enterpriseId, results: [] }, review);
  assert.equal(report.passed, false); assert.equal(report.answered, 0);
});
test('missing single result cannot pass even if success rate exceeds 90 percent', () => {
  const { d, evidence, review } = fixture(); evidence.results.shift(); review.evidenceHash = digest(evidence);
  assert.equal(evaluate(d, evidence, review).passed, false);
});
test('changed answers, citations and expectations invalidate prior approval', () => {
  for (const change of [f => { f.evidence.results[0].answer += 'changed'; }, f => { f.evidence.results[0].citations[0].quote += 'changed'; }, f => { f.d.cases[0].expectedAnswer += 'changed'; }]) {
    const f = fixture(); change(f);
    assert.ok(evaluate(f.d, f.evidence, f.review).blockers.includes('review_missing_or_stale'));
  }
});
test('reviewer mismatch and partial human review are blocked', () => {
  const { d, evidence, review } = fixture(); review.reviewer = 'different';
  assert.equal(evaluate(d, evidence, review).passed, false);
  review.reviewer = d.reviewer; review.cases[0].citationsCorrect = null;
  assert.equal(evaluate(d, evidence, review).passed, false);
});
test('critical disclosure or fabricated commitments block even one otherwise-correct answer', () => {
  for (const key of ['unauthorizedDisclosure', 'fabricatedCommitment']) {
    const { d, evidence, review } = fixture(); review.cases[0][key] = true;
    assert.equal(evaluate(d, evidence, review).passed, false);
  }
});
test('less than 90 percent grounded semantic correctness fails and 90 percent boundary is not rounded', () => {
  const { d, evidence, review } = fixture();
  const supported = d.cases.filter(c => c.expectedKind === 'grounded');
  for (const c of supported.slice(0, Math.floor(supported.length * 0.1))) review.cases.find(r => r.caseId === c.id).semanticCorrect = false;
  assert.equal(evaluate(d, evidence, review).passed, true);
  review.cases.find(r => r.caseId === supported[Math.floor(supported.length * 0.1)].id).semanticCorrect = false;
  assert.equal(evaluate(d, evidence, review).passed, false);
});
test('unsupported errors and unverified scenarios are zero tolerance', () => {
  const { d, evidence, review } = fixture();
  review.cases.find(r => r.caseId === 'A10-25').semanticCorrect = false;
  assert.equal(evaluate(d, evidence, review).passed, false);
  review.cases.find(r => r.caseId === 'A10-25').semanticCorrect = true; review.cases[0].scenarioVerified = false;
  assert.equal(evaluate(d, evidence, review).passed, false);
});
test('wrong enterprise, duplicate answers, wrong questions and duplicate review IDs fail closed', () => {
  for (const change of [f => { f.evidence.enterpriseId = 'other'; }, f => { Object.assign(f.evidence.results[1], { conversationId: f.evidence.results[0].conversationId, messageId: f.evidence.results[0].messageId }); }, f => { f.evidence.results[0].question = 'other'; }]) {
    const f = fixture(); change(f); assert.throws(() => evaluate(f.d, f.evidence, f.review));
  }
  const f = fixture(); f.review.cases.push(f.review.cases[0]);
  assert.equal(evaluate(f.d, f.evidence, f.review).passed, false);
});
test('revoked citations and failed runs cannot pass', () => {
  for (const change of [f => { f.evidence.results[0].citations[0].available = false; }, f => { f.evidence.results[0].status = 'failed'; }]) {
    const f = fixture(); change(f); f.review.evidenceHash = digest(f.evidence);
    assert.equal(evaluate(f.d, f.evidence, f.review).passed, false);
  }
});
test('multi-turn needs same conversation and update/conflict requires setup evidence', () => {
  for (const change of [f => { f.evidence.results.find(r => r.caseId === 'A10-39').conversationId = 'other'; }, f => { f.evidence.results.find(r => r.caseId === 'A10-45').scenarioEvidence = ''; }]) {
    const f = fixture(); change(f); f.review.evidenceHash = digest(f.evidence);
    assert.equal(evaluate(f.d, f.evidence, f.review).passed, false);
  }
});

test('multi-turn cannot cross execution enterprises even with matching conversation IDs', () => {
  const f = fixture();
  f.evidence.executionEnterpriseId = '100';
  f.evidence.results.find(r => r.caseId === 'A10-39').executionEnterpriseId = '101';
  f.review.evidenceHash = digest(f.evidence);
  const report = evaluate(f.d, f.evidence, f.review);
  assert.equal(report.passed, false);
  assert.ok(report.cases.find(c => c.caseId === 'A10-39').errors.includes('conversation_execution_enterprise_mismatch'));
});

test('empty execution enterprise identifiers fail closed', () => {
  for (const value of ['', ' ', null, 12]) {
    const f = fixture(); f.evidence.executionEnterpriseId = value;
    assert.throws(() => prepareReview(f.d, f.evidence), /execution enterprise/);
    delete f.evidence.executionEnterpriseId; f.evidence.results[0].executionEnterpriseId = value;
    assert.throws(() => prepareReview(f.d, f.evidence), /execution enterprise/);
  }
});

async function mergeFixture(change, verify) {
  const folder = await mkdtemp(join(tmpdir(), 'assistant-a10-merge-'));
  try {
    const f = fixture();
    const snapshot = { enterpriseId: f.d.enterpriseId, documents: [{ text: 'Synthetic source' }] };
    snapshot.hash = digest(snapshot.documents);
    const base = structuredClone(f.evidence), retest = structuredClone(f.evidence);
    base.sourceSnapshotHash = retest.sourceSnapshotHash = snapshot.hash;
    base.executionEnterpriseId = '100'; retest.executionEnterpriseId = '101';
    const retestSnapshot = structuredClone(snapshot);
    change({ base, retest, snapshot, retestSnapshot });
    const baseDir = join(folder, 'base'), retestDir = join(folder, 'retest'), out = join(folder, 'out');
    for (const [dir, evidence, source] of [[baseDir, base, snapshot], [retestDir, retest, retestSnapshot]]) {
      await mkdir(dir);
      for (const [file, value] of Object.entries({ 'dataset.json': f.d, 'evidence.json': evidence, 'source-snapshot.json': source })) {
        await writeFile(join(dir, file), JSON.stringify(value));
      }
    }
    await verify(() => merge([baseDir, out, retestDir]), out);
  } finally { await rm(folder, { recursive: true, force: true }); }
}

test('merge fills missing cases, preserves run tenancy and keeps review blank', async () => {
  await mergeFixture(({ base, retest }) => {
    base.results = base.results.filter(r => r.caseId !== 'A10-28');
    retest.results = retest.results.filter(r => r.caseId === 'A10-28');
  }, async (run, out) => {
    await run();
    const evidence = JSON.parse(await readFile(join(out, 'evidence.json'), 'utf8'));
    assert.equal(evidence.results.length, 60);
    assert.equal(evidence.results.find(r => r.caseId === 'A10-28').executionEnterpriseId, '101');
    assert.equal(evidence.results[0].executionEnterpriseId, '100');
    const review = JSON.parse(await readFile(join(out, 'review.json'), 'utf8'));
    assert.equal(review.businessDatasetApproved, null);
    assert.ok(review.cases.every(c => c.semanticCorrect === null));
    await assert.rejects(run(), /EEXIST/);
  });
});

test('merge recomputes source hashes and rejects missing or mismatched provenance before output', async () => {
  for (const change of [
    ({ retestSnapshot }) => { retestSnapshot.documents[0].text = 'Changed'; },
    ({ snapshot }) => { snapshot.documents[0].text = 'Changed base'; },
    ({ base, retest }) => { delete base.sourceSnapshotHash; delete retest.sourceSnapshotHash; },
    ({ retestSnapshot }) => { retestSnapshot.enterpriseId = 'other'; },
    ({ retest }) => { retest.sourceSnapshotHash = 'wrong'; },
  ]) await mergeFixture(change, async (run, out) => {
    await assert.rejects(run(), /hash differs|enterprise differs/);
    await assert.rejects(access(out), /ENOENT/);
  });
});

test('merge retains failed attempts and replaces required preceding turns together', async () => {
  await mergeFixture(({ base, retest }) => {
    const failed = base.results.find(r => r.caseId === 'A10-43');
    failed.status = 'indeterminate'; failed.errorCode = 'PROVIDER_TIMEOUT';
    const previous = dataset.cases.find(c => c.id === failed.caseId).previousCaseId;
    retest.results = retest.results.filter(r => [failed.caseId, previous].includes(r.caseId));
    for (const r of retest.results) {
      r.conversationId = 'new-conversation'; r.runId += '-retest'; r.messageId += '-retest';
    }
  }, async (run, out) => {
    await run();
    const { results } = JSON.parse(await readFile(join(out, 'evidence.json'), 'utf8'));
    const repaired = results.find(r => r.caseId === 'A10-43');
    assert.equal(repaired.conversationId, 'new-conversation');
    assert.equal(repaired.previousAttempts[0].status, 'indeterminate');
    assert.equal(repaired.previousAttempts[0].errorCode, 'PROVIDER_TIMEOUT');
    assert.equal(repaired.previousAttempts[0].executionEnterpriseId, '100');
    const previous = results.find(r => r.caseId === dataset.cases.find(c => c.id === repaired.caseId).previousCaseId);
    assert.equal(previous.executionEnterpriseId, repaired.executionEnterpriseId);
    assert.equal(previous.conversationId, repaired.conversationId);
  });
});

test('merge rejects an unrepaired missing result and mixed tenant conversation context', async () => {
  for (const change of [
    ({ base, retest }) => { base.results = base.results.filter(r => r.caseId !== 'A10-28'); retest.results = []; },
    ({ base, retest }) => {
      base.results.find(r => r.caseId === 'A10-39').status = 'failed';
      // The retest claims the preceding turn came from a different enterprise.
      retest.results.find(r => r.caseId === dataset.cases.find(c => c.id === 'A10-39').previousCaseId).executionEnterpriseId = '102';
    },
  ]) await mergeFixture(change, async (run, out) => {
    await assert.rejects(run(), /Missing required retest|inconsistent/);
    await assert.rejects(access(out), /ENOENT/);
  });
});
test('incomplete categories, duplicate normalized questions and unknown sources are rejected', () => {
  for (const change of [d => { d.cases[0].sourceIds = ['unknown']; }, d => { d.cases[1].question = d.cases[0].question + ' ?'; }, d => { d.cases = d.cases.filter(c => c.category !== 'conflict'); }]) {
    const d = structuredClone(dataset); change(d); assert.throws(() => validateDataset(d));
  }
});
test('review must happen after evidence and not in the future', () => {
  const f = fixture();
  for (const date of ['bad', '2024-01-01', '2999-01-01']) {
    f.review.reviewedAt = date; assert.equal(evaluate(f.d, f.evidence, f.review).passed, false);
  }
});
test('CLI writes readable questions and rejects overwrite/input collisions', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'assistant-a10-'));
  try {
    const input = join(folder, 'cases.json'), output = join(folder, 'questions.md');
    await writeFile(input, JSON.stringify(dataset));
    assert.equal(await main(['questions', '--dataset', input, '--out', output]), 0);
    assert.match(await readFile(output, 'utf8'), /A10-60/);
    await assert.rejects(main(['questions', '--dataset', input, '--out', output]), /EEXIST/);
    await assert.rejects(main(['questions', '--dataset', input, '--out', input]), /replace an input/);
    await assert.rejects(main(['questions', '--dataset', input, '--out', output, '--out', output]), /duplicate/);
    const evidencePath = join(folder, 'evidence.json'), reviewPath = join(folder, 'review.json'), reportPath = join(folder, 'report.json');
    await writeFile(evidencePath, JSON.stringify({ schemaVersion: 1, enterpriseId: dataset.enterpriseId, results: [] }));
    assert.equal(await main(['prepare', '--dataset', input, '--evidence', evidencePath, '--out', reviewPath]), 0);
    assert.equal(await main(['check', '--dataset', input, '--evidence', evidencePath, '--review', reviewPath, '--out', reportPath]), 1);
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).passed, false);
    const actual = fixture();
    await writeFile(evidencePath, JSON.stringify(actual.evidence));
    const bundle = join(folder, 'review-bundle.md');
    assert.equal(await main(['bundle', '--dataset', input, '--evidence', evidencePath, '--out', bundle]), 0);
    const rendered = await readFile(bundle, 'utf8');
    assert.match(rendered, /Synthetic test only/); assert.match(rendered, /Synthetic evidence/);
    assert.match(rendered, /Synthetic setup audit/); assert.match(rendered, /待业务负责人审核/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
