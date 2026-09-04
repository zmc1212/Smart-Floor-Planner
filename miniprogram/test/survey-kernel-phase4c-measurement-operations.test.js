const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const measurement = require('../packages/surveying/utils/survey/operations/measurement.js');
const { buildModuleGraph } = require('../scripts/audit-survey-kernel.js');

const clone = (value) => structuredClone(value);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function createOpenRemeasureDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, { xMm: 3000, yMm: 0 }),
    3000,
    'manual'
  );
  const floor = surveyGraph.getActiveFloor(draft);
  return surveyGraph.startRemeasure(surveyGraph.selectWall(draft, floor.walls[0].id));
}

function createClosedRemeasureDraft() {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 4000, yMm: 0 },
    { id: 'c', xMm: 4000, yMm: 3000 },
    { id: 'd', xMm: 0, yMm: 3000 }
  ];
  floor.walls = [
    ['ab', 'a', 'b', 4000, 0],
    ['bc', 'b', 'c', 3000, 90],
    ['cd', 'c', 'd', 4000, 180],
    ['da', 'd', 'a', 3000, -90]
  ].map(([id, startNodeId, endNodeId, lengthMm, angleDeg]) => ({
    id, startNodeId, endNodeId, mode: 'straight', status: 'confirmed',
    lengthMm, angleDeg, thicknessMm: 200, inputSource: 'manual'
  }));
  floor.spaces = [{ id: 'room', name: '房间', wallIds: ['ab', 'bc', 'cd', 'da'], closed: true }];
  floor.openings = [];
  floor.session.state = 'remeasureAwaitingInput';
  floor.session.selectedWallId = 'ab';
  floor.session.fixedNodeId = 'a';
  return draft;
}

test('Phase 4C measurement operations are standalone and do not load the legacy kernel', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../packages/surveying/utils/survey/operations/measurement.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/);
  assert.doesNotMatch(source, /\bwx\s*\.|\b(?:window|document|globalThis)\s*\./);
});

test('Phase 4C measurement dependency closure stays acyclic and client-free', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const graph = buildModuleGraph();
  const visited = new Set();
  const visit = (file, stack) => {
    assert.ok(!stack.includes(file), `cycle: ${[...stack, file].join(' -> ')}`);
    assert.doesNotMatch(file, /legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/);
    if (visited.has(file)) return;
    visited.add(file);
    assert.doesNotMatch(
      fs.readFileSync(path.join(repoRoot, file), 'utf8'),
      /\bwx\s*\.|\b(?:window|document|globalThis)\s*\./
    );
    graph.edges.filter((edge) => edge.from === file)
      .forEach((edge) => visit(edge.to, [...stack, file]));
  };
  visit('miniprogram/packages/surveying/utils/survey/operations/measurement.js', []);
  assert.ok([...visited].some((file) => file.endsWith('/transaction.js')));
  execFileSync(process.execPath, ['-e', `
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function(request, ...args) {
      if (/legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/.test(request)) throw Error(request);
      return original.call(this, request, ...args);
    };
    require('./miniprogram/packages/surveying/utils/survey/operations/measurement.js');
    require('./admin/src/lib/survey-runtime/survey/operations/measurement.js');
  `], { cwd: repoRoot, stdio: 'pipe' });
});

test('Phase 4C open remeasure plans are immutable, replayable and preserve audit pairs', () => {
  const draft = createOpenRemeasureDraft();
  const before = JSON.stringify(draft);
  const plan = freeze(measurement.planRemeasureSelectedWall(draft, 2800, 'ble'));
  assert.equal(JSON.stringify(draft), before);

  const first = clone(draft);
  const second = clone(draft);
  measurement.applyRemeasurePlan(first, plan);
  measurement.applyRemeasurePlan(second, plan);
  assert.deepEqual(first, second);
  const wall = surveyGraph.getActiveFloor(first).walls[0];
  assert.equal(wall.lengthMm, 2800);
  assert.equal(wall.rawMeasuredLengthMm + wall.closureAdjustmentMm, wall.lengthMm);
  assert.equal(wall.inputSource, 'ble');
});

test('Phase 4C closed orthogonal plans balance only the selected axis', () => {
  const draft = createClosedRemeasureDraft();
  const plan = freeze(measurement.planRemeasureSelectedWall(draft, 3500, 'manual'));
  assert.equal(plan.mode, 'closed-orthogonal');
  assert.equal(plan.selectedAxis, 'x');
  const floor = surveyGraph.getActiveFloor(draft);
  const directPlan = measurement.buildClosedOrthogonalRemeasurePlan(
    floor,
    floor.spaces[0],
    floor.walls[0],
    'a',
    3500,
    'manual'
  );
  assert.equal(directPlan.entries.some((entry) => Object.prototype.hasOwnProperty.call(entry, 'wall')), false);
  const output = clone(draft);
  const result = measurement.applyRemeasurePlan(output, plan);
  const outputFloor = surveyGraph.getActiveFloor(output);
  assert.equal(result.changed, true);
  assert.deepEqual(outputFloor.nodes, [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 3500, yMm: 0 },
    { id: 'c', xMm: 3500, yMm: 3000 },
    { id: 'd', xMm: 0, yMm: 3000 }
  ]);
  assert.equal(outputFloor.walls.find((wall) => wall.id === 'cd').closureAdjustmentMm, -500);
  assert.equal(outputFloor.walls.find((wall) => wall.id === 'bc').rawMeasuredLengthMm, undefined);
});

test('Phase 4C remeasure transaction rejects opening conflicts before graph mutation', () => {
  const draft = createOpenRemeasureDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.openings.push({
    id: 'window-1', type: 'window', wallId: floor.walls[0].id,
    widthMm: 1000, centerOffsetMm: 2500, heightMm: 1500, sillHeightMm: 900
  });
  const before = JSON.stringify(draft);
  assert.throws(
    () => surveyGraph.remeasureSelectedWall(draft, 2000, 'manual'),
    (error) => error && error.code === 'OPENING_REMEASURE_CONFLICT'
  );
  assert.equal(JSON.stringify(draft), before);
});

test('Phase 4C commit measurement helper keeps extension and raw reading semantics', () => {
  const draft = createOpenRemeasureDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  wall.measurementStartExtensionMm = 200;
  const anchor = surveyGraph.getNode(floor, wall.endNodeId);
  const endPoint = { xMm: 2600, yMm: 0 };
  measurement.applyExistingWallMeasurement(floor, wall, anchor, endPoint, 2800, 'manual', 'shorten');
  assert.equal(wall.lengthMm, 2800);
  assert.equal(wall.rawMeasuredLengthMm, 200);
  assert.equal(wall.closureAdjustmentMm, 2600);
});
