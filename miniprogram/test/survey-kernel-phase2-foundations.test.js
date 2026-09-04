const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const draftCore = require('../packages/surveying/utils/survey/core/draft.js');
const sessionCore = require('../packages/surveying/utils/survey/core/session.js');
const vector2 = require('../packages/surveying/utils/survey/geometry/vector2.js');
const segment = require('../packages/surveying/utils/survey/geometry/segment.js');
const polygon = require('../packages/surveying/utils/survey/geometry/polygon.js');
const wallDomain = require('../packages/surveying/utils/survey/domain/wall.js');
const openingDomain = require('../packages/surveying/utils/survey/domain/opening.js');
const domainValidation = require('../packages/surveying/utils/survey/domain/validation.js');
const {
  SURVEY_DOMAIN_ERROR_CODES: CODES,
  SurveyDomainError,
  createSurveyDomainError
} = require('../packages/surveying/utils/survey/domain/errors.js');
const {
  MESSAGE_FACTORIES,
  formatLegacySurveyError,
  toLegacySurveyError
} = require('../packages/surveying/utils/survey/compat/legacy-error-messages.js');
const legacyKernel = require('../packages/surveying/utils/survey/legacy-kernel.js');

const SURVEY_ROOT = path.resolve(__dirname, '../packages/surveying/utils/survey');

test('draft helpers preserve legacy clone, active-floor, and timestamp semantics', () => {
  const freshDraft = draftCore.createSurveyDraft();
  assert.equal(freshDraft.activeFloorId, 'floor-1');
  assert.deepEqual(freshDraft.floors[0].nodes, []);
  assert.deepEqual(freshDraft.floors[0].walls, []);
  assert.equal(freshDraft.floors[0].session.state, 'idle');

  const source = {
    activeFloorId: 'second',
    floors: [{ id: 'first' }, { id: 'second', nested: { value: 1 } }],
    updatedAt: 'before'
  };
  const cloned = draftCore.cloneDraft(source);
  assert.deepEqual(cloned, source);
  assert.notEqual(cloned, source);
  assert.notEqual(cloned.floors[1], source.floors[1]);
  assert.equal(draftCore.getActiveFloor(source).id, 'second');
  assert.equal(draftCore.getActiveFloor({ activeFloorId: 'missing', floors: source.floors }).id, 'first');
  assert.equal(draftCore.getActiveFloor(null), null);
  assert.equal(draftCore.getActiveFloor({ floors: [] }), null);

  Object.defineProperty(source, draftCore.TRANSACTION_DRAFT_SYMBOL, {
    value: true,
    configurable: true,
    enumerable: false
  });
  assert.equal(draftCore.cloneDraft(source), source);
  assert.notEqual(draftCore.cloneDraft(source, { force: true }), source);

  assert.equal(
    draftCore.touchDraft(source, new Date('2026-09-03T01:02:03.000Z')).updatedAt,
    '2026-09-03T01:02:03.000Z'
  );
  assert.equal(
    draftCore.touchDraft(source, '2026-09-03T04:05:06.000Z').updatedAt,
    '2026-09-03T04:05:06.000Z'
  );
});

test('session schema centralizes stable states, defaults, optional fields, and references', () => {
  const first = sessionCore.createSession();
  const second = sessionCore.createSession();
  assert.deepEqual(first, sessionCore.SESSION_DEFAULTS);
  assert.notEqual(first, second);
  assert.equal(sessionCore.createSession(275).thicknessMm, 275);
  assert.deepEqual(Object.values(sessionCore.SESSION_STATES), [
    'idle',
    'cursorPlaced',
    'wallPreview',
    'awaitingLength',
    'wallCommitted',
    'closing',
    'mergeClosing',
    'spaceClosed',
    'wallSelected',
    'wallSnapPending',
    'remeasureAwaitingInput'
  ]);
  assert.deepEqual(sessionCore.OPTIONAL_SESSION_FIELDS, [
    'bleLockedBearingDeg',
    'closedFromNodeId',
    'fixedNodeId',
    'fullValidationAfterClosedSplit'
  ]);

  const floor = {
    walls: [{ id: 'wall-1' }],
    session: {
      activeSpaceStartWallIndex: 99,
      selectedSpaceId: 'space-1',
      selectedWallId: 'wall-1',
      selectedOpeningId: 'opening-1',
      fixedNodeId: 'node-1',
      previewOuterFaceWallId: 'wall-preview'
    }
  };
  const normalized = sessionCore.ensureSessionSpaceTracking(floor);
  assert.equal(normalized.activeSpaceStartWallIndex, 1);
  assert.equal(normalized.activeSpaceStartNodeId, '');
  assert.equal(normalized.previewMeasurementStartInsetMm, 0);
  assert.equal(floor.session, normalized);

  const stableReferences = sessionCore.collectSessionReferences(normalized);
  assert.deepEqual(stableReferences.nodeIds, [{ field: 'fixedNodeId', id: 'node-1' }]);
  assert.deepEqual(stableReferences.wallIds, [{ field: 'selectedWallId', id: 'wall-1' }]);
  assert.deepEqual(stableReferences.openingIds, [{ field: 'selectedOpeningId', id: 'opening-1' }]);
  assert.deepEqual(stableReferences.spaceIds, [{ field: 'selectedSpaceId', id: 'space-1' }]);
  assert.deepEqual(
    sessionCore.collectSessionReferences(normalized, { includeTransient: true }).wallIds,
    [
      { field: 'selectedWallId', id: 'wall-1' },
      { field: 'previewOuterFaceWallId', id: 'wall-preview' }
    ]
  );
});

test('vector primitives preserve millimetre rounding and historical angle normalization', () => {
  const start = { xMm: 0, yMm: 0 };
  assert.equal(vector2.distance(start, { xMm: 3, yMm: 4 }), 5);
  assert.equal(vector2.distanceMm(start, { xMm: 1, yMm: 1 }), 1);
  assert.equal(vector2.samePoint(start, { xMm: 0.0007, yMm: 0.0007 }), true);
  assert.equal(vector2.samePoint(start, { xMm: 0.001, yMm: 0.001 }), false);
  assert.equal(vector2.angleDeg(start, { xMm: -10, yMm: 0 }), 180);
  assert.equal(vector2.normalizeSignedAngleDeg(-180), 180);
  assert.equal(vector2.normalizeAngleDeg(181.04), -179);
  assert.deepEqual(vector2.subtract({ xMm: 8, yMm: 5 }, { xMm: 3, yMm: 7 }), { x: 5, y: -2 });
  assert.equal(vector2.dot({ x: 2, y: 3 }, { x: -4, y: 5 }), 7);
  assert.equal(vector2.cross({ x: 2, y: 3 }, { x: -4, y: 5 }), 22);
  assert.equal(vector2.pointLineDistanceMm({ xMm: 5, yMm: 9 }, start, { x: 1, y: 0 }), 9);
  assert.deepEqual(vector2.addScaled({ xMm: 1, yMm: 2 }, { x: 3, y: -2 }, 4), {
    xMm: 13,
    yMm: -6
  });
});

test('segment primitives cover intersections, projections, overlaps, and endpoint policy', () => {
  const horizontalStart = { xMm: 0, yMm: 0 };
  const horizontalEnd = { xMm: 100, yMm: 0 };
  assert.deepEqual(segment.intersectLines(
    horizontalStart,
    horizontalEnd,
    { xMm: 50, yMm: -20 },
    { xMm: 50, yMm: 20 }
  ), { xMm: 50, yMm: 0 });
  assert.equal(segment.intersectLines(
    horizontalStart,
    horizontalEnd,
    { xMm: 0, yMm: 20 },
    { xMm: 100, yMm: 20 }
  ), null);
  assert.equal(segment.projectAlong(
    { start: horizontalStart, direction: { x: 1, y: 0 } },
    { xMm: 35, yMm: 9 }
  ), 35);
  assert.equal(segment.overlapLengthMm(
    horizontalStart,
    horizontalEnd,
    { xMm: 60, yMm: 0 },
    { xMm: 140, yMm: 0 },
    0
  ), 40);
  assert.equal(segment.overlapLengthMm(
    horizontalStart,
    horizontalEnd,
    { xMm: 60, yMm: 2 },
    { xMm: 140, yMm: 2 },
    1
  ), 0);
  assert.equal(segment.hasInteriorIntersection(
    horizontalStart,
    horizontalEnd,
    { xMm: 50, yMm: -50 },
    { xMm: 50, yMm: 50 },
    { overlapToleranceMm: 30 }
  ), true);
  assert.equal(segment.hasInteriorIntersection(
    horizontalStart,
    horizontalEnd,
    { xMm: 90, yMm: -50 },
    { xMm: 90, yMm: 50 },
    { overlapToleranceMm: 30 }
  ), false);
  assert.deepEqual(segment.projectPointToSegment(
    { xMm: 130, yMm: 4 },
    horizontalStart,
    horizontalEnd
  ), { point: { xMm: 100, yMm: 0 }, t: 1, distanceMm: 30 });
  assert.equal(segment.pointTouchesSegment({ xMm: 20, yMm: 1 }, horizontalStart, horizontalEnd), true);
  assert.equal(segment.pointTouchesSegment({ xMm: 20, yMm: 2 }, horizontalStart, horizontalEnd), false);
});

test('polygon primitives preserve area, winding, containment, centroid, and input immutability', () => {
  const points = [
    { xMm: 0, yMm: 0 },
    { xMm: 4000, yMm: 0 },
    { xMm: 4000, yMm: 3000 },
    { xMm: 0, yMm: 3000 }
  ];
  const before = JSON.stringify(points);
  assert.equal(polygon.signedArea(points), 12000000);
  assert.equal(polygon.area(points), 12000000);
  assert.equal(polygon.orientation(points), 'counterclockwise');
  assert.equal(polygon.orientation(points.slice().reverse()), 'clockwise');
  assert.equal(polygon.orientation(points.slice(0, 2)), 'degenerate');
  assert.equal(polygon.containsPoint({ xMm: 2000, yMm: 1500 }, points), true);
  assert.equal(polygon.containsPoint({ xMm: 5000, yMm: 1500 }, points), false);
  assert.deepEqual(polygon.centroid(points), { xMm: 2000, yMm: 1500 });
  assert.equal(polygon.hasSelfIntersection(points), false);
  assert.equal(JSON.stringify(points), before);
});

test('wall and opening domain helpers own normalization and measured-length semantics', () => {
  const floor = {
    nodes: [
      { id: 'start', xMm: 0, yMm: 0 },
      { id: 'end', xMm: 3000, yMm: 4000 }
    ]
  };
  const wall = {
    id: 'wall-1',
    startNodeId: 'start',
    endNodeId: 'end',
    lengthMm: 5000,
    measurementStartInsetMm: 100,
    measurementStartExtensionMm: 50,
    measurementEndInsetMm: 150
  };
  assert.equal(wallDomain.coordinateLengthMm(floor, wall), 5000);
  assert.deepEqual(wallDomain.measurementInsets(wall), { start: 100, end: 150 });
  assert.equal(wallDomain.measuredLengthMm(floor, wall), 4800);
  assert.equal(wallDomain.normalizeMeasurementAdjustment(-9), 0);
  assert.equal(wallDomain.normalizeMeasurementAdjustment('8.6'), 9);

  wall.rawMeasuredLengthMm = 4800;
  wall.closureAdjustmentMm = 0;
  wallDomain.syncAdjustmentAfterMetricChange(wall);
  assert.equal(wall.closureAdjustmentMm, 200);
  wallDomain.recordRawMeasurement(wall, 4950, 'orthogonal-closure-balance');
  assert.equal(wall.rawMeasuredLengthMm, 4950);
  assert.equal(wall.closureAdjustmentMm, 50);
  assert.equal(wall.adjustmentSource, 'orthogonal-closure-balance');
  wallDomain.recordRawMeasurement(wall, 5000, 'orthogonal-closure-balance');
  assert.equal(Object.prototype.hasOwnProperty.call(wall, 'adjustmentSource'), false);

  const door = { type: 'door', openDirection: 'unexpected' };
  assert.equal(openingDomain.normalizeOpeningDirection(door), door);
  assert.equal(door.openDirection, 'inside');
  openingDomain.normalizeOpeningDirection(Object.assign(door, { openDirection: 'outside' }));
  assert.equal(door.openDirection, 'outside');
});

test('domain validation emits structured codes while the compatibility boundary preserves old messages', () => {
  assert.deepEqual(
    Object.keys(MESSAGE_FACTORIES).sort(),
    Object.values(CODES).sort(),
    'every domain error code must retain an explicit legacy message mapping'
  );

  let domainError;
  try {
    domainValidation.validateLength(99);
  } catch (error) {
    domainError = error;
  }
  assert.equal(domainError instanceof SurveyDomainError, true);
  assert.equal(domainError.code, CODES.INVALID_WALL_LENGTH);
  assert.equal(domainError.message, CODES.INVALID_WALL_LENGTH);
  assert.deepEqual(domainError.details, { value: 99, minimumMm: 100 });
  assert.equal(formatLegacySurveyError(domainError), '请输入不少于 100 mm 的整数长度');
  const legacyLengthError = toLegacySurveyError(domainError);
  assert.equal(legacyLengthError.message, '请输入不少于 100 mm 的整数长度');
  assert.equal(Object.prototype.hasOwnProperty.call(legacyLengthError, 'code'), false);

  const splitError = toLegacySurveyError(createSurveyDomainError(CODES.OPENING_SPLIT_CONFLICT, {
    wallId: 'wall-1',
    openingId: 'opening-1',
    cutAlongMm: 900,
    clearanceMm: 50,
    internalOnly: true
  }));
  assert.equal(splitError.message, '分隔线压到门窗，请先调整门窗位置');
  assert.equal(splitError.code, CODES.OPENING_SPLIT_CONFLICT);
  assert.equal(splitError.wallId, 'wall-1');
  assert.equal(splitError.openingId, 'opening-1');
  assert.equal(splitError.cutAlongMm, 900);
  assert.equal(splitError.clearanceMm, 50);
  assert.equal(Object.prototype.hasOwnProperty.call(splitError, 'internalOnly'), false);
});

test('legacy kernel error boundary retains its public message and enumerable-field contract', () => {
  const draft = legacyKernel.createSurveyDraft();
  assert.throws(
    () => legacyKernel.commitPreviewLength(draft, 100),
    (error) => error.message === '请先拖出待确认墙体' && !Object.hasOwn(error, 'code')
  );
  assert.throws(
    () => legacyKernel.setThickness(draft, 49),
    (error) => error.message === '请输入不少于 50 mm 的整数墙厚' && !Object.hasOwn(error, 'code')
  );
  assert.throws(
    () => legacyKernel.addOpeningToWall(draft, 'missing-wall', 'door'),
    (error) => error.message === 'Please select a wall before adding an opening' && !Object.hasOwn(error, 'code')
  );
});

test('Phase 2 modules have one-way dependencies and legacy kernel has no duplicate foundations', () => {
  const foundationFiles = [
    'compat/legacy-error-messages.js',
    'core/draft.js',
    'core/session.js',
    'geometry/vector2.js',
    'geometry/segment.js',
    'geometry/polygon.js',
    'domain/errors.js',
    'domain/validation.js',
    'domain/wall.js',
    'domain/opening.js'
  ];
  foundationFiles.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(SURVEY_ROOT, relativePath), 'utf8');
    assert.doesNotMatch(
      source,
      /require\s*\([^)]*(?:legacy-kernel|surveyWallGraph|surveying-editor|bluetooth)/,
      relativePath
    );
    assert.doesNotMatch(source, /\bwx\s*\./, relativePath);
  });
  const validationSource = fs.readFileSync(path.join(SURVEY_ROOT, 'domain/validation.js'), 'utf8');
  assert.doesNotMatch(validationSource, /[\u3400-\u9fff]/);

  const kernelSource = fs.readFileSync(path.join(SURVEY_ROOT, 'legacy-kernel.js'), 'utf8');
  [
    'cloneDraft',
    'createSurveyDraft',
    'getActiveFloor',
    'touchDraft',
    'createSession',
    'ensureSessionSpaceTracking',
    'distanceMm',
    'angleDeg',
    'pointLineDistanceMm',
    'normalizeAngle',
    'normalizeSignedAngle',
    'addVector',
    'pointTouchesWallSegment',
    'intersectLines',
    'projectAlong',
    'projectPointToWallSegment',
    'perpendicularDistanceToLineMm',
    'isPointInsidePolygon',
    'calculatePolygonAreaMm2',
    'normalizeMeasurementInset',
    'normalizeMeasurementExtension',
    'getWallCoordinateLength',
    'getWallMeasurementInsets',
    'getMeasuredWallLength',
    'normalForMeasurementSide',
    'calculateMeasuredPreviewLength',
    'pointFromLength',
    'syncWallAdjustmentAfterMetricChange',
    'recordWallRawMeasurement',
    'normalizeOpeningDirection',
    'validateInteriorAngle',
    'validateLength',
    'validateThickness',
    'validateOpeningSize',
    'validateOpeningDepth'
  ].forEach((functionName) => {
    assert.doesNotMatch(kernelSource, new RegExp(`function\\s+${functionName}\\s*\\(`), functionName);
  });
  assert.doesNotMatch(kernelSource, /openDirection\s*===\s*'outside'\s*\?/);
  Object.values(sessionCore.SESSION_STATES).forEach((state) => {
    assert.doesNotMatch(
      kernelSource,
      new RegExp(`\\.state\\s*(?:=|===|!==)\\s*['\"]${state}['\"]`),
      state
    );
  });
});
