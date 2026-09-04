const interactions = require('./survey/operations/interaction-operations.js');
const snapEngine = require('./survey/snap/snap-engine.js');
const cursorReadModel = require('./survey/read-model/cursor.js');
const closureInteraction = require('./survey/interaction/closure-projection.js');
const previewCommit = require('./survey/operations/commit-preview.js');
const kernel = require('./survey/legacy-kernel.js');
const validator = require('./survey/invariants/floor-plan-validator.js');
const { createWallOperations } = require('./survey/operations/wall-operations.js');
const { createMeasurementOperations } = require('./survey/operations/measurement.js');
const { createClosureOperations } = require('./survey/operations/closure.js');
const { createOpeningOperations } = require('./survey/operations/opening-operations.js');
const wallGeometry = require('./survey/read-model/wall-geometry.js');
const wallFaces = require('./survey/read-model/wall-faces.js');
const spaceBoundary = require('./survey/read-model/space-boundary.js');
const spaceDimensions = require('./survey/read-model/space-dimensions.js');

const transactionalWalls = createWallOperations();
const transactionalMeasurements = createMeasurementOperations();
const transactionalClosures = createClosureOperations(previewCommit.commitPreviewLength);
const transactionalOpenings = createOpeningOperations();

// Each compatibility export has one explicit owner. Read models are standalone;
// write operations keep their existing transaction and legacy-error boundaries.
module.exports = {
  DEFAULT_THICKNESS_MM: kernel.DEFAULT_THICKNESS_MM,
  DEFAULT_SCALE: kernel.DEFAULT_SCALE,
  CLOSE_TOLERANCE_MM: kernel.CLOSE_TOLERANCE_MM,
  VERTEX_AXIS_SNAP_TOLERANCE_MM: kernel.VERTEX_AXIS_SNAP_TOLERANCE_MM,
  MIN_WALL_LENGTH_MM: kernel.MIN_WALL_LENGTH_MM,
  MIN_THICKNESS_MM: kernel.MIN_THICKNESS_MM,
  createSurveyDraft: kernel.createSurveyDraft,
  cloneDraft: kernel.cloneDraft,
  getActiveFloor: kernel.getActiveFloor,
  getNode: kernel.getNode,
  getWall: kernel.getWall,
  getOpening: kernel.getOpening,
  getWallSnapPoint: snapEngine.getWallSnapPoint,
  getCursorPlacementTarget: snapEngine.getCursorPlacementTarget,
  getCursorDisplayPoint: cursorReadModel.getCursorDisplayPoint,
  isDirectClosureHit: closureInteraction.isDirectClosureHit,
  distanceMm: kernel.distanceMm,
  angleDeg: kernel.angleDeg,
  buildWallSnapGeometry: wallGeometry.buildWallSnapGeometry,
  buildWallRenderGeometry: wallGeometry.buildWallRenderGeometry,
  buildWallJoinRenderGeometries: wallGeometry.buildWallJoinRenderGeometries,
  buildSpaceBoundaryPoints: spaceBoundary.buildSpaceBoundaryPoints,
  buildSpaceInnerBoundaryPoints: spaceBoundary.buildSpaceInnerBoundaryPoints,
  buildSpaceRenderBoundaryPoints: spaceBoundary.buildSpaceRenderBoundaryPoints,
  buildSpaceDimensionPlan: spaceDimensions.buildSpaceDimensionPlan,
  getClosurePath: cursorReadModel.getClosurePath,
  getMinimumClosureSuggestionWallCount: kernel.getMinimumClosureSuggestionWallCount,
  getMinimumDirectBoundaryCloseWallCount: kernel.getMinimumDirectBoundaryCloseWallCount,
  getMinimumActiveCloseWallCount: kernel.getMinimumActiveCloseWallCount,
  calculateSpaceAreaMm2: spaceDimensions.calculateSpaceAreaMm2,
  setMode: interactions.setMode,
  placeCursor: interactions.placeCursor,
  placeNewWallChainCursor: interactions.placeNewWallChainCursor,
  startPreview: interactions.startPreview,
  startPreviewFromBearing: interactions.startPreviewFromBearing,
  lockPreviewBearing: interactions.lockPreviewBearing,
  clearBleLockedBearing: interactions.clearBleLockedBearing,
  materializeLockedPreview: interactions.materializeLockedPreview,
  holdPreviewForInput: interactions.holdPreviewForInput,
  applyPreviewInteriorAngle: interactions.applyPreviewInteriorAngle,
  reopenLastDiagonalWallForAngle: interactions.reopenLastDiagonalWallForAngle,
  cancelPending: interactions.cancelPending,
  commitPreviewLength: transactionalWalls.commitPreviewLength,
  confirmClosure: transactionalClosures.confirmClosure,
  repairCollinearDegree2Walls: kernel.repairCollinearDegree2Walls,
  selectWall: interactions.selectWall,
  selectOpening: interactions.selectOpening,
  selectSpace: interactions.selectSpace,
  renameClosedSpace: kernel.renameClosedSpace,
  deleteClosedSpace: transactionalWalls.deleteClosedSpace,
  addOpeningToWall: transactionalOpenings.addOpeningToWall,
  updateOpening: transactionalOpenings.updateOpening,
  deleteOpening: transactionalOpenings.deleteOpening,
  deleteWall: transactionalWalls.deleteWall,
  startWallSnap: interactions.startWallSnap,
  snapCursorToWall: transactionalWalls.snapCursorToWall,
  startRemeasure: interactions.startRemeasure,
  remeasureSelectedWall: transactionalMeasurements.remeasureSelectedWall,
  setFixedNode: interactions.setFixedNode,
  setMeasurementSide: kernel.setMeasurementSide,
  canSetInitialMeasurementSide: kernel.canSetInitialMeasurementSide,
  setThickness: kernel.setThickness,
  resetCursor: interactions.resetCursor,
  updateViewport: interactions.updateViewport,
  projectWallFaces: wallFaces.projectWallFaces,
  projectWorkingFace: wallFaces.projectWorkingFace,
  measuredReadingMm: wallFaces.measuredReadingMm,
  resolveBodyNormal: wallFaces.resolveBodyNormal,
  validateSurveyDraft: validator.validateSurveyDraft
};
