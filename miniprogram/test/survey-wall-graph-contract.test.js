const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');

const LEGACY_EXPORTS = [
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
  'cloneDraft',
  'commitPreviewLength',
  'confirmClosure',
  'createSurveyDraft',
  'deleteOpening',
  'deleteWall',
  'distanceMm',
  'getActiveFloor',
  'getClosurePath',
  'getCursorDisplayPoint',
  'getCursorPlacementTarget',
  'getMinimumClosureSuggestionWallCount',
  'getNode',
  'getOpening',
  'getWall',
  'getWallSnapPoint',
  'holdPreviewForInput',
  'isDirectClosureHit',
  'measuredReadingMm',
  'placeCursor',
  'placeNewWallChainCursor',
  'projectWallFaces',
  'projectWorkingFace',
  'remeasureSelectedWall',
  'repairCollinearDegree2Walls',
  'reopenLastDiagonalWallForAngle',
  'resetCursor',
  'resolveBodyNormal',
  'selectOpening',
  'selectWall',
  'setFixedNode',
  'setMeasurementSide',
  'setMode',
  'setThickness',
  'snapCursorToWall',
  'startPreview',
  'startRemeasure',
  'startWallSnap',
  'updateOpening',
  'updateViewport'
].sort();

test('survey wall graph facade preserves the legacy CommonJS contract', () => {
  assert.deepEqual(
    Object.keys(surveyGraph).filter((name) => name !== 'validateSurveyDraft').sort(),
    LEGACY_EXPORTS
  );
  assert.equal(typeof surveyGraph.validateSurveyDraft, 'function');
});

test('facade operations preserve immutable input semantics', () => {
  const source = surveyGraph.createSurveyDraft();
  const before = JSON.stringify(source);
  const next = surveyGraph.placeCursor(source, { xMm: 10, yMm: 20 });
  assert.equal(JSON.stringify(source), before);
  assert.notEqual(next, source);
});
