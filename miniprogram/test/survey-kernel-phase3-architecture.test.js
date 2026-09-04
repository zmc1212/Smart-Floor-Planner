const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildModuleGraph, buildFacadeAudit, parseFacadeBindings } = require('../scripts/audit-survey-kernel.js');

const repoRoot = path.resolve(__dirname, '../..');
const surveyRoot = 'miniprogram/packages/surveying/utils/survey/';

test('Phase 3 read-model dependency closure is acyclic and excludes legacy, interaction and write operations', () => {
  const graph = buildModuleGraph();
  const checked = new Set();
  const visit = (file, stack) => {
    assert.ok(!stack.includes(file), `Cyclic read-model dependency: ${[...stack, file].join(' -> ')}`);
    assert.doesNotMatch(file, /legacy-kernel|surveyWallGraph|\/operations\/|\/snap\/|\/compat\/|surveying-editor|bluetooth/);
    if (checked.has(file)) return;
    checked.add(file);
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(source, /\bwx\s*\.|\b(?:window|document|globalThis)\s*\./, file);
    graph.edges.filter((edge) => edge.from === file).forEach((edge) => visit(edge.to, [...stack, file]));
  };
  const roots = graph.nodes.filter((node) => node.file.includes('/read-model/'));
  assert.equal(roots.length, 4);
  roots.forEach((node) => visit(node.file, []));
  assert.ok(checked.has(surveyRoot + 'core/graph-query.js'));
  assert.ok(checked.has(surveyRoot + 'topology/closed-boundary.js'));
});

test('Phase 3 standalone modules load in a fresh process with kernel and operations unavailable', () => {
  const script = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, ...args) {
      if (/legacy-kernel|surveyWallGraph|operations|surveying-editor|bluetooth/.test(request)) {
        throw new Error('Forbidden read-model dependency: ' + request);
      }
      return originalLoad.call(this, request, ...args);
    };
    for (const root of ['miniprogram/packages/surveying/utils/survey', 'admin/src/lib/survey-runtime/survey']) {
      for (const name of ['wall-geometry', 'wall-faces', 'space-boundary', 'space-dimensions']) {
        const api = require('./' + root + '/read-model/' + name + '.js');
        if (!Object.values(api).every(value => typeof value === 'function')) throw new Error('Unexpected read-model export');
        if (Object.keys(api).some(key => /^create.*ReadModel$/.test(key))) throw new Error('Factory proxy remains');
      }
    }
  `;
  execFileSync(process.execPath, ['-e', script], { cwd: repoRoot, stdio: 'pipe' });
});

test('Phase 3 facade binds every export explicitly and rejects duplicates or order-based selection', () => {
  const audit = buildFacadeAudit();
  assert.equal(audit.selection, 'explicit-property-bindings');
  assert.equal(audit.facadeExportCount, 69);
  assert.equal(audit.legacyExportCount, 64);
  assert.equal(audit.overrides.length, 17);
  const original = 'module.exports = {\n  first: a.first,\n  second: b.second\n};';
  const reordered = 'module.exports = {\n  second: b.second,\n  first: a.first\n};';
  assert.deepEqual(parseFacadeBindings(original), parseFacadeBindings(reordered));
  assert.throws(() => parseFacadeBindings('module.exports = Object.assign({}, a, b);'), /explicit/);
  assert.throws(() => parseFacadeBindings('module.exports = {\n  first: a.first,\n  first: b.first\n};'), /Duplicate/);
  assert.throws(() => parseFacadeBindings('module.exports = {\n  ...a\n};'), /Implicit/);
  audit.exports.filter((entry) => entry.actualSource.includes('/read-model/')).forEach((entry) => {
    const facade = require('../packages/surveying/utils/surveyWallGraph.js');
    const owner = require(path.join(repoRoot, entry.actualSource));
    assert.equal(facade[entry.name], owner[entry.name], entry.name);
  });
});

test('Phase 3 moved formulas have no duplicate implementation left in the kernel', () => {
  const source = fs.readFileSync(path.join(repoRoot, surveyRoot, 'legacy-kernel.js'), 'utf8');
  const reference = require('./fixtures/survey-kernel-phase3/read-model-reference.js');
  Object.keys(reference).forEach((name) => {
    assert.doesNotMatch(source, new RegExp(`^function ${name}\\(`, 'm'), name);
  });
});
