const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  assertSurveyKernelGovernance,
  buildExplicitExportContract,
  buildMirrorAudit,
  buildModuleGraph,
  buildPureBoundaryAudit,
  createSurveyKernelAudit,
  findDependencyCycles,
  parseExplicitExportNames,
  parseFacadeBindings
} = require('../scripts/audit-survey-kernel.js');

const repoRoot = path.resolve(__dirname, '../..');
const facadePath = 'miniprogram/packages/surveying/utils/surveyWallGraph.js';
const legacyPath = 'miniprogram/packages/surveying/utils/survey/legacy-kernel.js';

test('Phase 7 pure geometry and read-model dependency closures stay one-way and host-free', () => {
  const graph = buildModuleGraph();
  const boundaries = buildPureBoundaryAudit(graph);
  assert.ok(boundaries.geometryRoots.length > 0);
  assert.ok(boundaries.readModelRoots.length > 0);
  assert.deepEqual(boundaries.dependencyViolations, []);
  assert.deepEqual(boundaries.environmentViolations, []);

  const regressedGraph = {
    nodes: graph.nodes,
    edges: graph.edges.concat([
      { from: boundaries.geometryRoots[0], to: 'miniprogram/packages/surveying/utils/survey/operations/transaction.js' },
      { from: boundaries.readModelRoots[0], to: legacyPath }
    ])
  };
  const regressed = buildPureBoundaryAudit(regressedGraph).dependencyViolations;
  assert.ok(regressed.some(({ rule }) => rule === 'geometry-only'));
  assert.ok(regressed.some(({ rule }) => rule === 'read-model-no-upward-dependency'));
});

test('Phase 7 survey module graph is acyclic and the cycle detector rejects regressions', () => {
  assert.deepEqual(findDependencyCycles(buildModuleGraph()), []);
  const cyclic = {
    nodes: [{ file: 'a.js' }, { file: 'b.js' }, { file: 'c.js' }],
    edges: [
      { from: 'a.js', to: 'b.js' },
      { from: 'b.js', to: 'a.js' },
      { from: 'b.js', to: 'c.js' }
    ]
  };
  assert.deepEqual(findDependencyCycles(cyclic), [['a.js', 'b.js']]);
});

test('Phase 7 facade and compatibility exports are explicit, unique and runtime-complete', () => {
  const contracts = [facadePath, legacyPath].map(buildExplicitExportContract);
  assert.deepEqual(contracts.map((contract) => contract.sourceExportCount), [69, 64]);
  contracts.forEach((contract) => {
    assert.equal(contract.sourceExportCount, contract.runtimeExportCount, contract.file);
    assert.deepEqual(contract.missingAtRuntime, [], contract.file);
    assert.deepEqual(contract.implicitAtRuntime, [], contract.file);
  });

  for (const relativePath of [facadePath, legacyPath]) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /\b(?:module\.)?exports\s*\[/, relativePath);
    assert.doesNotMatch(source, /^exports\.[A-Za-z_$][\w$]*\s*=/m, relativePath);
  }
  assert.throws(
    () => parseFacadeBindings('module.exports = {\n  value: first.value,\n  value: second.value\n};'),
    /Duplicate facade export: value/
  );
  assert.throws(
    () => parseFacadeBindings('module.exports = {\n  value: first.value\n};\nmodule.exports = second;'),
    /exactly one/
  );
  assert.throws(
    () => parseExplicitExportNames('module.exports = {\n  value: first.deep.value,\n  value: second.deep.value\n};'),
    /Duplicate module export: value/
  );
});

test('Phase 7 Mini Program authority and Admin generated mirror cannot drift', () => {
  const mirror = buildMirrorAudit();
  assert.equal(mirror.length, 79);
  assert.deepEqual(mirror.filter(({ targetExists, contentMatches }) => (
    !targetExists || !contentMatches
  )), []);
  execFileSync(process.execPath, ['admin/scripts/sync-survey-dimension-plan.mjs', '--check'], {
    cwd: repoRoot,
    stdio: 'pipe'
  });
});

test('Phase 7 governance gate passes the current audited architecture', () => {
  const audit = createSurveyKernelAudit();
  assert.equal(audit.schemaVersion, 2);
  assert.doesNotThrow(() => assertSurveyKernelGovernance(audit));
  assert.deepEqual(audit.governance.legacyKernelInboundDependencies, []);
  assert.equal(audit.governance.mirrorManifest.manifestEntryCount, 79);
  assert.deepEqual(audit.governance.mirrorManifest.errors, []);
  assert.deepEqual(audit.governance.mirrorMismatches, []);
});
