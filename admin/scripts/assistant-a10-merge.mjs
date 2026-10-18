import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, prepareReview, evaluate, main as render } from './assistant-a10.mjs';

// Merge only repaired cases and their required preceding turns. Other successful
// reruns stay as regression evidence, so unrelated conversation chains retain
// the original, actually observed context.
export async function main(argv) {
  const [basePath, outputPath, ...retestPaths] = argv;
  assert.ok(basePath && outputPath && retestPaths.length, 'usage: node assistant-a10-merge.mjs BASE OUTPUT RETEST...');
  const read = async (dir, name) => JSON.parse(await readFile(path.join(dir, name), 'utf8'));
  const dataset = await read(basePath, 'dataset.json');
  const base = await read(basePath, 'evidence.json');
  prepareReview(dataset, base);
  const validateSnapshot = async (dir, evidence) => {
    const snapshot = await read(dir, 'source-snapshot.json');
    assert.equal(snapshot.enterpriseId, dataset.enterpriseId, 'Snapshot enterprise differs');
    assert.ok(Array.isArray(snapshot.documents) && snapshot.documents.length, 'Missing source documents');
    const hash = digest(snapshot.documents);
    assert.equal(snapshot.hash, hash, 'Snapshot content hash differs');
    assert.equal(evidence.sourceSnapshotHash, hash, 'Evidence source hash differs');
    return snapshot;
  };
  const snapshot = await validateSnapshot(basePath, base);
  const runs = [];
  for (const dir of retestPaths) {
    assert.equal(digest(await read(dir, 'dataset.json')), digest(dataset), 'Dataset changed across runs');
    const e = await read(dir, 'evidence.json');
    prepareReview(dataset, e);
    await validateSnapshot(dir, e);
    assert.equal(e.enterpriseId, base.enterpriseId); assert.equal(e.sourceSnapshotHash, base.sourceSnapshotHash, 'Source knowledge changed across runs');
    runs.push({ directory: path.resolve(dir), evidence: e });
  }
  const cases = new Map(dataset.cases.map(c => [c.id, c]));
  const originals = new Map(base.results.map(r => [r.caseId, r]));
  const replace = new Set(dataset.cases.filter(c => {
    const r = originals.get(c.id);
    return !r || r.status !== 'succeeded' || r.answerKind !== c.expectedKind;
  }).map(c => c.id));
  for (const id of replace) { const previous = cases.get(id).previousCaseId; if (previous) replace.add(previous); }
  const evidence = { ...base, scope: (base.scope || '') + ' Repaired cases include separately recorded live reruns; all original attempts are retained.',
    results: dataset.cases.map(c => {
      const r = originals.get(c.id);
      // Materialize per-run tenancy before combining evidence with different defaults.
      const qualify = (row, source) => ({ ...row, executionEnterpriseId: row.executionEnterpriseId ?? source.executionEnterpriseId ?? source.enterpriseId });
      if (!replace.has(c.id)) return qualify(r, base);
      const retests = runs.flatMap(run => run.evidence.results.filter(row => row.caseId === c.id).map(row => qualify(row, run.evidence)));
      assert.ok(retests.length, 'Missing required retest');
      const attempts = [...(r ? [qualify(r, base)] : []), ...retests];
      const latest = attempts.at(-1);
      assert.equal(latest.status, 'succeeded', 'Retest still failed'); assert.equal(latest.answerKind, c.expectedKind, 'Retest answer kind still differs');
      return { ...latest, previousAttempts: attempts.slice(0, -1) };
    }),
    regressionRuns: runs.map(run => ({ directory: run.directory, evidenceHash: digest(run.evidence), cases: run.evidence.results.map(r => ({ caseId: r.caseId, status: r.status, kind: r.answerKind, expected: cases.get(r.caseId).expectedKind })) })),
    businessReview: 'pending',
  };
  const review = prepareReview(dataset, evidence);
  const report = evaluate(dataset, evidence, review);
  const technicalErrors = report.cases.flatMap(r => r.errors.filter(e => e !== 'manual_review_pending').map(error => ({ caseId: r.caseId, error })));
  assert.deepEqual(technicalErrors, [], 'Merged conversation context or technical evidence is inconsistent');
  await mkdir(outputPath, { recursive: false });
  for (const [name, content] of Object.entries({ 'dataset.json': dataset, 'source-snapshot.json': snapshot, 'evidence.json': evidence, 'review.json': review, 'report.json': report })) {
    await writeFile(path.join(outputPath, name), JSON.stringify(content, null, 2), { flag: 'wx', mode: 0o600 });
  }
  await render(['bundle', '--dataset', path.join(outputPath, 'dataset.json'), '--evidence', path.join(outputPath, 'evidence.json'), '--out', path.join(outputPath, '审核问答与引用.md')]);
  console.log(JSON.stringify({ output: path.resolve(outputPath), total: evidence.results.length, repairedAndContextCases: [...replace], technicalErrors, businessReview: 'pending' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.code === 'EEXIST' ? 'Output exists; choose a new output path.' : error.message);
    process.exitCode = 1;
  });
}
