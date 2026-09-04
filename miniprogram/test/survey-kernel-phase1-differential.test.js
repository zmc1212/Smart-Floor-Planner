const test = require('node:test');
const assert = require('node:assert/strict');
const miniSurveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const legacyKernel = require('../packages/surveying/utils/survey/legacy-kernel.js');
const adminSurveyGraph = require('../../admin/src/lib/survey-runtime/surveyWallGraph.js');
const {
  buildSingleWall,
  buildWallWithOpenings,
  createOperationCases
} = require('./fixtures/survey-kernel-baseline/representative-fixtures.js');
const {
  assertSurveyKernelDifferential,
  formatDifferentialReport,
  runSurveyKernelDifferential
} = require('./helpers/survey-kernel-differential-harness.js');
const {
  canonicalizeSurveyValue,
  compareSurveyDrafts,
  compareSurveyValues,
  formatSurveyDifferences,
  inspectSurveyReferences
} = require('./helpers/survey-kernel-semantics.js');

const LEGACY_KERNEL_EXPORTS = [
  'CLOSE_TOLERANCE_MM',
  'DEFAULT_SCALE',
  'DEFAULT_THICKNESS_MM',
  'MIN_THICKNESS_MM',
  'MIN_WALL_LENGTH_MM',
  'VERTEX_AXIS_SNAP_TOLERANCE_MM',
  'addOpeningToWall',
  'angleDeg',
  'applyPreviewInteriorAngle',
  'buildSpaceBoundaryPoints',
  'buildSpaceDimensionPlan',
  'buildSpaceInnerBoundaryPoints',
  'buildSpaceRenderBoundaryPoints',
  'buildWallJoinRenderGeometries',
  'buildWallRenderGeometry',
  'buildWallSnapGeometry',
  'calculateSpaceAreaMm2',
  'canSetInitialMeasurementSide',
  'cancelPending',
  'clearBleLockedBearing',
  'cloneDraft',
  'commitPreviewLength',
  'confirmClosure',
  'createSurveyDraft',
  'deleteClosedSpace',
  'deleteOpening',
  'deleteWall',
  'distanceMm',
  'getActiveFloor',
  'getClosurePath',
  'getCursorDisplayPoint',
  'getCursorPlacementTarget',
  'getMinimumActiveCloseWallCount',
  'getMinimumClosureSuggestionWallCount',
  'getMinimumDirectBoundaryCloseWallCount',
  'getNode',
  'getOpening',
  'getWall',
  'getWallSnapPoint',
  'holdPreviewForInput',
  'isDirectClosureHit',
  'lockPreviewBearing',
  'materializeLockedPreview',
  'placeCursor',
  'placeNewWallChainCursor',
  'remeasureSelectedWall',
  'renameClosedSpace',
  'reopenLastDiagonalWallForAngle',
  'repairCollinearDegree2Walls',
  'resetCursor',
  'selectOpening',
  'selectSpace',
  'selectWall',
  'setFixedNode',
  'setMeasurementSide',
  'setMode',
  'setThickness',
  'snapCursorToWall',
  'startPreview',
  'startPreviewFromBearing',
  'startRemeasure',
  'startWallSnap',
  'updateOpening',
  'updateViewport'
].sort();

const FACADE_ONLY_EXPORTS = [
  'measuredReadingMm',
  'projectWallFaces',
  'projectWorkingFace',
  'resolveBodyNormal',
  'validateSurveyDraft'
].sort();

const OVERRIDDEN_FACADE_EXPORTS = [
  'addOpeningToWall',
  'buildSpaceBoundaryPoints',
  'buildSpaceDimensionPlan',
  'buildSpaceInnerBoundaryPoints',
  'buildSpaceRenderBoundaryPoints',
  'buildWallJoinRenderGeometries',
  'buildWallRenderGeometry',
  'buildWallSnapGeometry',
  'calculateSpaceAreaMm2',
  'commitPreviewLength',
  'confirmClosure',
  'deleteClosedSpace',
  'deleteOpening',
  'deleteWall',
  'remeasureSelectedWall',
  'snapCursorToWall',
  'updateOpening'
].sort();

const TRANSACTIONAL_FACADE_EXPORTS = [
  'addOpeningToWall',
  'commitPreviewLength',
  'confirmClosure',
  'deleteClosedSpace',
  'deleteOpening',
  'deleteWall',
  'remeasureSelectedWall',
  'snapCursorToWall',
  'updateOpening'
].sort();

const LEGACY_CORE_TRANSIENT_FIELDS = [
  'floors.*.session.fullValidationAfterClosedSplit'
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureReadModels(api, draft) {
  const floor = api.getActiveFloor(draft);
  return {
    walls: floor.walls.map((wall) => {
      const start = api.getNode(floor, wall.startNodeId);
      const end = api.getNode(floor, wall.endNodeId);
      const topologyLengthMm = start && end ? api.distanceMm(start, end) : 0;
      return {
        id: wall.id,
        measuredReadingMm: api.measuredReadingMm(topologyLengthMm, wall),
        projectedFaces: api.projectWallFaces(wall, start, end, wall.thicknessMm, null),
        snapGeometry: api.buildWallSnapGeometry(floor, wall),
        renderGeometry: api.buildWallRenderGeometry(floor, wall),
        workingFace: api.projectWorkingFace(wall, start, end)
      };
    }),
    spaces: floor.spaces.filter((space) => space && space.closed).map((space) => ({
      id: space.id,
      topologyBoundary: api.buildSpaceBoundaryPoints(floor, space.wallIds),
      innerBoundary: api.buildSpaceInnerBoundaryPoints(floor, space),
      renderBoundary: api.buildSpaceRenderBoundaryPoints(floor, space),
      dimensionPlan: api.buildSpaceDimensionPlan(floor, space),
      areaMm2: api.calculateSpaceAreaMm2(draft, space.id)
    }))
  };
}

function renameEntityIds(draft, prefix) {
  const renamed = clone(draft);
  const idMap = new Map();
  renamed.floors.forEach((floor) => {
    idMap.set(floor.id, `${prefix}-${floor.id}`);
    ['nodes', 'walls', 'openings', 'spaces'].forEach((collection) => {
      floor[collection].forEach((entity) => idMap.set(entity.id, `${prefix}-${entity.id}`));
    });
  });
  const replace = (value) => {
    if (typeof value === 'string') return idMap.get(value) || value;
    if (Array.isArray(value)) return value.map(replace);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      idMap.get(key) || key,
      replace(entry)
    ]));
  };
  return replace(renamed);
}

function createSide(label, implementation, readModelApi) {
  return {
    label,
    implementation,
    validateSurveyDraft: readModelApi.validateSurveyDraft,
    captureReadModels: (draft) => captureReadModels(readModelApi, draft)
  };
}

test('Phase 1 freezes both the 64-export legacy kernel and 69-export CommonJS facade', () => {
  assert.deepEqual(Object.keys(legacyKernel).sort(), LEGACY_KERNEL_EXPORTS);
  assert.deepEqual(
    Object.keys(miniSurveyGraph).sort(),
    [...LEGACY_KERNEL_EXPORTS, ...FACADE_ONLY_EXPORTS].sort()
  );
  assert.deepEqual(Object.keys(adminSurveyGraph).sort(), Object.keys(miniSurveyGraph).sort());
  OVERRIDDEN_FACADE_EXPORTS.forEach((name) => {
    if (TRANSACTIONAL_FACADE_EXPORTS.includes(name)) {
      assert.notEqual(miniSurveyGraph[name], legacyKernel[name], `${name} must keep its transaction wrapper`);
    } else {
      assert.equal(miniSurveyGraph[name], legacyKernel[name], `${name} must share its authoritative read model`);
    }
  });
});

test('graph semantic normalization remaps runtime IDs, timestamps, nodes, and openings without hiding domain fields', () => {
  const expected = buildWallWithOpenings();
  const sourceWallId = expected.floors[0].walls[0].id;
  expected.floors[0].spaces[0].wallFaceOverrides = { [sourceWallId]: 'left' };
  const actual = renameEntityIds(expected, 'candidate');
  actual.updatedAt = '2099-01-01T00:00:00.000Z';
  actual.floors[0].nodes.reverse();
  actual.floors[0].openings.reverse();
  const comparison = compareSurveyDrafts(expected, actual);
  assert.equal(comparison.equal, true, formatSurveyDifferences(comparison.differences));

  actual.floors[0].walls[0].lengthMm += 1;
  const drift = compareSurveyDrafts(expected, actual);
  assert.equal(drift.equal, false);
  assert.equal(drift.differences.length, 1);
  assert.match(drift.differences[0].path, /^floors\[floor-1\]\.walls\[wall-1-\d+\]\.lengthMm$/);
  assert.equal(drift.differences[0].expected, expected.floors[0].walls[0].lengthMm);
  assert.equal(drift.differences[0].actual, actual.floors[0].walls[0].lengthMm);
});

test('semantic comparison keeps persisted millimetres exact and applies tolerance only when requested', () => {
  assert.equal(compareSurveyValues({ xMm: 10 }, { xMm: 10.0000004 }).equal, false);
  assert.equal(compareSurveyValues(
    { projected: 10 },
    { projected: 10.0000004 },
    { numericTolerance: 1e-6 }
  ).equal, true);
  const outsideTolerance = compareSurveyValues(
    { projected: 10 },
    { projected: 10.000002 },
    { numericTolerance: 1e-6 }
  );
  assert.equal(outsideTolerance.equal, false);
  assert.match(formatSurveyDifferences(outsideTolerance.differences), /projected/);
});

test('semantic difference formatting handles missing and unexpected fields', () => {
  const missing = compareSurveyValues({ required: true }, {});
  const unexpected = compareSurveyValues({}, { extra: true });
  assert.match(formatSurveyDifferences(missing.differences), /required: missing/);
  assert.match(formatSurveyDifferences(unexpected.differences), /extra: unexpected/);
});

test('semantic comparison reports session drift and reference guard reports duplicates and dangling IDs', () => {
  const expected = buildSingleWall();
  const actual = clone(expected);
  actual.floors[0].session.state = 'corrupted-state';
  const comparison = compareSurveyDrafts(expected, actual);
  assert.equal(comparison.equal, false);
  assert.equal(comparison.differences[0].path, 'floors[floor-1].session.state');

  actual.floors[0].nodes.push(clone(actual.floors[0].nodes[0]));
  actual.floors[0].walls[0].endNodeId = 'missing-node';
  actual.floors[0].session.previewOuterFaceWallId = 'missing-wall';
  actual.floors[0].session.partitionSourceSpaceId = 'missing-space';
  const issues = inspectSurveyReferences(actual);
  assert.ok(issues.some((issue) => issue.code === 'DUPLICATE_ID'));
  assert.ok(issues.some((issue) => issue.code === 'MISSING_WALL_NODE'));
  assert.ok(issues.some((issue) => issue.path.endsWith('.session.previewOuterFaceWallId')));
  assert.ok(issues.some((issue) => issue.path.endsWith('.session.partitionSourceSpaceId')));
});

test('semantic diagnostics address node, wall, opening, space, and session fields', () => {
  const expected = buildWallWithOpenings();
  const mutations = [
    ['nodes', (draft) => { draft.floors[0].nodes[0].xMm += 3; }],
    ['walls', (draft) => { draft.floors[0].walls[0].thicknessMm += 20; }],
    ['openings', (draft) => { draft.floors[0].openings[0].heightMm += 50; }],
    ['spaces', (draft) => { draft.floors[0].spaces[0].name = '语义差异'; }],
    ['session', (draft) => { draft.floors[0].session.state = 'semantic-drift'; }]
  ];
  mutations.forEach(([scope, mutate]) => {
    const actual = clone(expected);
    mutate(actual);
    const comparison = compareSurveyDrafts(expected, actual);
    assert.equal(comparison.equal, false, scope);
    assert.ok(
      comparison.differences.some((difference) => difference.path.includes(`.${scope}`)),
      `${scope}: ${formatSurveyDifferences(comparison.differences)}`
    );
  });
});

createOperationCases().forEach((operationCase) => {
  test(`legacy core and transactional facade stay equivalent: ${operationCase.id}`, () => {
    const prepared = operationCase.prepare();
    const operationName = operationCase.publicOperation || operationCase.riskOperation;
    const report = assertSurveyKernelDifferential({
      caseId: operationCase.id,
      operationName,
      input: prepared.input,
      args: prepared.args,
      expectedOutcome: operationCase.expectedOutcome,
      legacy: createSide('legacy core', legacyKernel, miniSurveyGraph),
      candidate: createSide('transactional facade', miniSurveyGraph, miniSurveyGraph),
      ignoredPaths: LEGACY_CORE_TRANSIENT_FIELDS,
      derivedTolerance: 1e-6
    });
    assert.equal(report.runs.legacy.first.inputUnchanged, true);
    assert.equal(report.runs.candidate.first.inputUnchanged, true);
  });

  test(`Mini Program and Admin runtime mirrors stay equivalent: ${operationCase.id}`, () => {
    const prepared = operationCase.prepare();
    const operationName = operationCase.publicOperation || operationCase.riskOperation;
    assertSurveyKernelDifferential({
      caseId: `admin-mirror:${operationCase.id}`,
      operationName,
      input: prepared.input,
      args: prepared.args,
      expectedOutcome: operationCase.expectedOutcome,
      legacy: createSide('Mini Program', miniSurveyGraph, miniSurveyGraph),
      candidate: createSide('Admin mirror', adminSurveyGraph, adminSurveyGraph),
      derivedTolerance: 1e-6
    });
  });
});

test('differential diagnostics identify the changed wall or session field', () => {
  const input = buildSingleWall();
  const wallId = miniSurveyGraph.getActiveFloor(input).walls[0].id;
  const driftingCandidate = {
    deleteWall(draft) {
      const output = clone(draft);
      const floor = miniSurveyGraph.getActiveFloor(output);
      floor.walls[0].lengthMm += 1;
      floor.session.selectedWallId = wallId;
      return output;
    }
  };
  const identityLegacy = { deleteWall: (draft) => clone(draft) };
  const report = runSurveyKernelDifferential({
    caseId: 'diagnostic-wall-drift',
    operationName: 'deleteWall',
    input,
    args: [wallId],
    legacy: createSide('legacy diagnostic', identityLegacy, miniSurveyGraph),
    candidate: createSide('candidate diagnostic', driftingCandidate, miniSurveyGraph)
  });
  assert.equal(report.equivalent, false);
  const message = formatDifferentialReport(report);
  assert.match(message, /walls\[wall-1-\d+\]\.lengthMm/);
  assert.match(message, /session\.selectedWallId/);
});

test('differential guards expose input mutation on a rejected operation', () => {
  const input = buildSingleWall();
  const mutatingFailure = {
    updateOpening(draft) {
      draft.floors[0].session.state = 'partially-mutated';
      throw new Error('rejected');
    }
  };
  const report = runSurveyKernelDifferential({
    caseId: 'diagnostic-failure-atomicity',
    operationName: 'updateOpening',
    input,
    legacy: createSide('legacy diagnostic', mutatingFailure, miniSurveyGraph),
    candidate: createSide('candidate diagnostic', mutatingFailure, miniSurveyGraph),
    expectedOutcome: 'error'
  });
  assert.equal(report.equivalent, false);
  assert.ok(report.differences.some((difference) => (
    difference.scope === 'immutability' && difference.path === 'input'
  )));
});

test('canonical error comparison retains code, message, validation, and input entity references', () => {
  const input = buildSingleWall();
  const wallId = miniSurveyGraph.getActiveFloor(input).walls[0].id;
  const normalized = canonicalizeSurveyValue({
    code: 'EXAMPLE',
    message: `wall ${wallId} failed`,
    validation: { errors: [{ path: `walls.${wallId}.lengthMm` }] }
  }, input);
  assert.equal(normalized.message, 'wall wall-1-1 failed');
  assert.equal(normalized.validation.errors[0].path, 'walls.wall-1-1.lengthMm');
});
