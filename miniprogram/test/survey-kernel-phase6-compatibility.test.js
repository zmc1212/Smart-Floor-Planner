const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const api = require('../packages/surveying/utils/surveyWallGraph.js');
const legacy = require('../packages/surveying/utils/survey/legacy-kernel.js');
const admin = require('../../admin/src/lib/survey-runtime/surveyWallGraph.js');
const adminLegacy = require('../../admin/src/lib/survey-runtime/survey/legacy-kernel.js');
// Reuse the frozen Phase 4D oracle. Do not copy another kernel or test helper.
const frozen = require('./fixtures/survey-kernel-phase5/interaction-reference.js');
const { REPRESENTATIVE_FIXTURES, buildSingleWall } = require('./fixtures/survey-kernel-baseline/representative-fixtures.js');
const { captureReadModels } = require('./fixtures/survey-kernel-baseline/capture.js');
const { assertSurveyKernelDifferential } = require('./helpers/survey-kernel-differential-harness.js');
const { buildFacadeAudit, buildModuleGraph, propertyUses } = require('../scripts/audit-survey-kernel.js');
const { planMeasurementSide } = require('../packages/surveying/utils/survey/interaction/measurement-side.js');
const properties = require('../packages/surveying/utils/survey/operations/wall-properties.js');
const spaces = require('../packages/surveying/utils/survey/operations/space-properties.js');
const clone = api.cloneDraft;
const floorOf = api.getActiveFloor;
const side = implementation => ({ implementation, validateSurveyDraft: api.validateSurveyDraft, captureReadModels });

const commands = {
  setThickness: floor => [[50], [300, floor.walls[0]?.id], ['240'], [49], [50.5], ['bad'], [200, 'missing']],
  setMeasurementSide: floor => [['left'], ['right', floor.walls[0]?.id], ['invalid', 'missing']],
  renameClosedSpace: floor => [[floor.spaces[0]?.id, ' 客厅 '], [null, '卧室'], ['missing', '房间'],
    [floor.spaces[0]?.id, ''], [floor.spaces[0]?.id, 'x'.repeat(20)], [floor.spaces[0]?.id, 'x'.repeat(21)]],
  repairCollinearDegree2Walls: () => [[]]
};
for (const [client, candidate] of Object.entries({ mini: api, legacy, admin, adminLegacy })) {
  for (const [operationName, makeArgs] of Object.entries(commands)) {
    test(`Phase 6 ${client}/${operationName}: frozen behavior, repeated input/output, undo/redo and read models`, () => {
      for (const fixture of REPRESENTATIVE_FIXTURES) {
        const input = fixture.build();
        const floor = floorOf(input);
        floor.session.selectedWallId = floor.walls[0]?.id || '';
        floor.session.selectedSpaceId = floor.spaces[0]?.id || '';
        for (const args of makeArgs(floor)) {
          assertSurveyKernelDifferential({ caseId: `${client}/${fixture.id}`, operationName,
            input, args, legacy: side(frozen), candidate: side(candidate) });
        }
      }
    });
  }
}

test('Phase 6 measurement-side eligibility preserves all states, free/shared boundaries and body-side inheritance', () => {
  const states = require('../packages/surveying/utils/survey/core/session.js').SESSION_STATES;
  for (const fixture of REPRESENTATIVE_FIXTURES) for (const state of Object.values(states)) {
    for (const activeCount of [0, 1, 2]) for (const preview of [null, { xMm: 800, yMm: 600 }]) {
      const input = fixture.build(), floor = floorOf(input);
      const firstClosed = floor.spaces.find(space => space.closed);
      floor.session.state = state;
      floor.session.activeSpaceStartWallIndex = Math.max(0, floor.walls.length - activeCount);
      floor.session.activeSpaceSharedWallId = firstClosed?.wallIds[0] || '';
      floor.session.previewPoint = preview;
      for (const wallId of [undefined, floor.walls.at(-1)?.id, 'missing']) {
        assert.equal(api.canSetInitialMeasurementSide(floor, floor.session, wallId),
          frozen.canSetInitialMeasurementSide(floor, floor.session, wallId));
        for (const sideValue of ['left', 'right']) {
          const expected = frozen.setMeasurementSide(input, sideValue, wallId);
          const actual = legacy.setMeasurementSide(input, sideValue, wallId);
          // Only the clock is volatile; every graph/session field stays exact.
          actual.updatedAt = expected.updatedAt;
          assert.deepEqual(actual, expected);
        }
      }
    }
  }
});

test('Phase 6 property plans are clock-free values and never alias their input or applied graph', () => {
  const draft = buildSingleWall(), before = clone(draft), floor = floorOf(draft);
  const RealDate = global.Date;
  let plans;
  global.Date = class { constructor() { throw Error('Planner read the clock'); } static now() { throw Error('Planner read the clock'); } };
  try {
    plans = [properties.planThickness(draft, 300), planMeasurementSide(floor, 'left')];
  } finally { global.Date = RealDate; }
  assert.deepEqual(draft, before);
  for (const plan of plans) {
    const saved = clone(plan);
    const output = properties.applyWallPropertyPlan(draft, plan);
    floorOf(output).session.measurementSide = 'changed';
    assert.deepEqual(plan, saved);
    assert.deepEqual(draft, before);
  }
  const room = REPRESENTATIVE_FIXTURES.find(f => f.id === 'closed-rectangle').build();
  const savedRoom = clone(room);
  const plan = spaces.planRenameClosedSpace(room, floorOf(room).spaces[0].id, ' 房间 ');
  assert.deepEqual(room, savedRoom);
  assert.deepEqual(Object.keys(plan).sort(), ['name', 'spaceId']);
});

test('Phase 6 ineligible measurement-side no-op preserves the timestamp and returns a separate draft', () => {
  const input = api.createSurveyDraft();
  input.updatedAt = '2000-01-01T00:00:00.000Z';
  const output = api.setMeasurementSide(input, 'left');
  assert.notEqual(output, input);
  assert.deepEqual(output, input);
});

test('Phase 6 property writes and repair reject late invariant failures without changing input or history', () => {
  for (const [operationName, makeArgs] of Object.entries(commands)) {
    const input = operationName === 'renameClosedSpace'
      ? REPRESENTATIVE_FIXTURES.find(f => f.id === 'closed-rectangle').build() : buildSingleWall();
    const floor = floorOf(input);
    // Unrelated orphan opening survives each planned edit and must fail the
    // unchanged validator after application, not leave a partially edited graph.
    floor.openings.push({ id: 'orphan', wallId: 'missing', widthMm: 500, offsetMm: 600, type: 'door' });
    const history = [clone(input)], before = clone(input);
    assert.throws(() => api[operationName](input, ...makeArgs(floor)[0]), error => error.name === 'SurveyInvariantError');
    assert.deepEqual(input, before);
    assert.deepEqual(history, [before]);
  }
});

test('Phase 6 production facade loads and operates with legacy kernel physically unavailable', () => {
  execFileSync(process.execPath, ['-e', `
    const Module = require('node:module'), load = Module._load;
    Module._load = function(request, ...args) {
      if (/legacy-kernel|surveying-editor|bluetooth/.test(request)) throw Error(request);
      return load.call(this, request, ...args);
    };
    for (const root of ['miniprogram/packages/surveying/utils', 'admin/src/lib/survey-runtime']) {
      const api = require('./' + root + '/surveyWallGraph.js');
      let draft = api.placeCursor(api.createSurveyDraft(), { xMm: 0, yMm: 0 });
      draft = api.commitPreviewLength(api.startPreview(draft, { xMm: 4000, yMm: 0 }), 4000);
      draft = api.setMeasurementSide(api.setThickness(draft, 250), 'left');
      draft = api.repairCollinearDegree2Walls(draft);
      if (!api.validateSurveyDraft(draft, { mode: 'full' }).valid) throw Error('Invalid graph');
    }
  `], { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
  const graph = buildModuleGraph();
  assert.equal(graph.edges.filter(edge => edge.to.endsWith('/legacy-kernel.js')).length, 0);
  const source = fs.readFileSync(path.resolve(__dirname, '../packages/surveying/utils/survey/legacy-kernel.js'), 'utf8');
  assert.doesNotMatch(source, /\bfunction\b|=>|\b(?:if|for|while)\s*\(/);
  assert.deepEqual(graph.nodes.filter(node => !node.facadeReachable).map(node => node.classification), ['test-only']);
});

test('Phase 6 caller audit recognizes computed access and whole-object dispatch without reading string filenames as properties', () => {
  assert.deepEqual(propertyUses("const kernel = require('./legacy-kernel.js'); kernel.setThickness(draft, 200)", ['kernel']), ['setThickness']);
  assert.ok(propertyUses('kernel[operation](draft)', ['kernel']).includes('*'));
  assert.ok(propertyUses('for (const api of [kernel, facade]) api[name](draft)', ['kernel']).includes('*'));
  assert.deepEqual(propertyUses("kernel['setThickness'](draft)", ['kernel']), ['setThickness']);
});

test('Phase 6 audit gives every legacy export an explicit migration status', () => {
  const audit = buildFacadeAudit();
  const counts = audit.exports.reduce((result, entry) => {
    result[entry.legacyStatus] = (result[entry.legacyStatus] || 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, { migrated: 51, 'compatibility-proxy': 13, 'facade-only': 5 });
  assert.ok(audit.exports.every(entry => ['migrated', 'compatibility-proxy', 'facade-only'].includes(entry.legacyStatus)));
});
