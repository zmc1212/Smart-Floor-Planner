const test = require('node:test');
const assert = require('node:assert/strict');
const expectedAudit = require('./fixtures/survey-kernel-baseline/expected-audit.json');
const expectedBehavior = require('./fixtures/survey-kernel-baseline/expected-behavior.json');
const performanceBaseline = require('./fixtures/survey-kernel-baseline/performance-baseline.json');
const {
  captureReadModels,
  captureSurveyKernelBaseline
} = require('./fixtures/survey-kernel-baseline/capture.js');
const {
  REPRESENTATIVE_FIXTURES,
  createLargeGridDraft,
  surveyGraph
} = require('./fixtures/survey-kernel-baseline/representative-fixtures.js');
const { createSurveyKernelAudit } = require('../scripts/audit-survey-kernel.js');

const EXPECTED_FIXTURES = [
  'empty-graph',
  'single-wall',
  'continuous-walls',
  'closed-rectangle',
  'l-shaped-space',
  'shared-wall',
  'diagonal-wall',
  'wall-with-openings',
  'split-wall',
  'multiple-spaces',
  'remeasured-wall'
];

test('Phase 0 representative fixture catalog covers every planned graph shape', () => {
  assert.deepEqual(REPRESENTATIVE_FIXTURES.map((fixture) => fixture.id), EXPECTED_FIXTURES);
  REPRESENTATIVE_FIXTURES.forEach((fixture) => {
    const draft = fixture.build();
    const validation = surveyGraph.validateSurveyDraft(draft, { mode: fixture.validationMode });
    assert.equal(validation.valid, true, `${fixture.id}: ${validation.errors[0] && validation.errors[0].code}`);
  });
});

test('Phase 0 read-model fixtures never mutate their graph input', () => {
  REPRESENTATIVE_FIXTURES.forEach((fixture) => {
    const draft = fixture.build();
    const before = JSON.stringify(draft);
    captureReadModels(draft);
    assert.equal(JSON.stringify(draft), before, fixture.id);
  });
});

test('legacy operation outputs, sessions, errors, and read models match the frozen baseline', () => {
  assert.deepEqual(captureSurveyKernelBaseline(), expectedBehavior);
});

test('every high-risk operation has a success and rejection or explicit no-op boundary', () => {
  const byOperation = new Map();
  Object.values(expectedBehavior.operations).forEach((entry) => {
    assert.equal(entry.inputUnchanged, true, entry.operation);
    assert.equal(entry.outcome.kind, entry.expectedOutcome, entry.operation);
    const outcomes = byOperation.get(entry.operation) || new Set();
    outcomes.add(entry.outcome.kind);
    byOperation.set(entry.operation, outcomes);
  });
  [
    'commitPreviewLength',
    'confirmClosure',
    'splitWallAtNodes',
    'deleteWall',
    'deleteClosedSpace',
    'remeasureSelectedWall',
    'addOpeningToWall',
    'updateOpening',
    'deleteOpening'
  ].forEach((operation) => {
    const outcomes = byOperation.get(operation) || new Set();
    assert.equal(outcomes.has('success'), true, `${operation} is missing a success baseline`);
    assert.equal(
      outcomes.has('error') || outcomes.has('noop'),
      true,
      `${operation} is missing a rejection/no-op baseline`
    );
  });
  assert.equal(
    expectedBehavior.operations['split-wall-opening-conflict-error'].outcome.error.code,
    'OPENING_SPLIT_CONFLICT'
  );
});

test('facade exports, winning sources, callers, and module dependencies match the Phase 0 audit', () => {
  assert.deepEqual(createSurveyKernelAudit(), expectedAudit);
  assert.equal(expectedAudit.facade.legacyExportCount, 64);
  assert.equal(expectedAudit.facade.facadeExportCount, 69);
  assert.equal(expectedAudit.facade.overrides.length, 17);
});

test('dependency audit separates facade reachability, editor direct code, and suspected dead modules', () => {
  const classifications = expectedAudit.moduleGraph.nodes.reduce((groups, entry) => {
    if (!groups[entry.classification]) groups[entry.classification] = [];
    groups[entry.classification].push(entry);
    return groups;
  }, {});
  assert.deepEqual(
    (classifications['editor-direct'] || []).map((entry) => entry.file),
    ['miniprogram/packages/surveying/utils/survey/snap/snap-engine.js']
  );
  assert.deepEqual(
    (classifications['suspected-dead'] || []).map((entry) => entry.file),
    [
      'miniprogram/packages/surveying/utils/survey/geometry/intersection.js',
      'miniprogram/packages/surveying/utils/survey/topology/space-topology.js',
      'miniprogram/packages/surveying/utils/survey/topology/wall-split.js'
    ]
  );
});

test('Admin runtime mirror matches every authoritative Mini Program source or approved require rewrite', () => {
  assert.equal(expectedAudit.adminMirror.length, 43);
  expectedAudit.adminMirror.forEach((entry) => {
    assert.equal(entry.targetExists, true, entry.target);
    assert.equal(entry.contentMatches, true, entry.target);
  });
});

test('large-grid performance baseline records measured thresholds for the reproducible scenario', () => {
  const draft = createLargeGridDraft(
    performanceBaseline.scenario.columns,
    performanceBaseline.scenario.rows
  );
  const floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.nodes.length, performanceBaseline.scenario.nodes);
  assert.equal(floor.walls.length, performanceBaseline.scenario.walls);
  assert.equal(floor.spaces.length, performanceBaseline.scenario.spaces);
  assert.equal(surveyGraph.validateSurveyDraft(draft, { mode: 'full' }).valid, true);
  performanceBaseline.metrics.forEach((metric) => {
    assert.ok(performanceBaseline.thresholds.metricsMs[metric.name] >= metric.p95Ms);
  });
  assert.ok(
    performanceBaseline.thresholds.retainedHeapDeltaBytes >=
      performanceBaseline.memory.retainedHeapDeltaBytes
  );
});
