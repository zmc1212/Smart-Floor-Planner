const kernel = require('./survey/legacy-kernel.js');
const validator = require('./survey/invariants/floor-plan-validator.js');
const { createWallOperations } = require('./survey/operations/wall-operations.js');
const { createOpeningOperations } = require('./survey/operations/opening-operations.js');
const wallGeometry = require('./survey/read-model/wall-geometry.js');
const wallFaces = require('./survey/read-model/wall-faces.js');
const spaceBoundary = require('./survey/read-model/space-boundary.js');
const spaceDimensions = require('./survey/read-model/space-dimensions.js');

const transactionalWalls = createWallOperations(kernel);
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
  getWallSnapPoint: kernel.getWallSnapPoint,
  getCursorPlacementTarget: kernel.getCursorPlacementTarget,
  getCursorDisplayPoint: kernel.getCursorDisplayPoint,
  isDirectClosureHit: kernel.isDirectClosureHit,
  distanceMm: kernel.distanceMm,
  angleDeg: kernel.angleDeg,
  buildWallSnapGeometry: wallGeometry.buildWallSnapGeometry,
  buildWallRenderGeometry: wallGeometry.buildWallRenderGeometry,
  buildWallJoinRenderGeometries: wallGeometry.buildWallJoinRenderGeometries,
  buildSpaceBoundaryPoints: spaceBoundary.buildSpaceBoundaryPoints,
  buildSpaceInnerBoundaryPoints: spaceBoundary.buildSpaceInnerBoundaryPoints,
  buildSpaceRenderBoundaryPoints: spaceBoundary.buildSpaceRenderBoundaryPoints,
  buildSpaceDimensionPlan: spaceDimensions.buildSpaceDimensionPlan,
  getClosurePath: kernel.getClosurePath,
  getMinimumClosureSuggestionWallCount: kernel.getMinimumClosureSuggestionWallCount,
  getMinimumDirectBoundaryCloseWallCount: kernel.getMinimumDirectBoundaryCloseWallCount,
  getMinimumActiveCloseWallCount: kernel.getMinimumActiveCloseWallCount,
  calculateSpaceAreaMm2: spaceDimensions.calculateSpaceAreaMm2,
  setMode: kernel.setMode,
  placeCursor: kernel.placeCursor,
  placeNewWallChainCursor: kernel.placeNewWallChainCursor,
  startPreview: kernel.startPreview,
  startPreviewFromBearing: kernel.startPreviewFromBearing,
  lockPreviewBearing: kernel.lockPreviewBearing,
  clearBleLockedBearing: kernel.clearBleLockedBearing,
  materializeLockedPreview: kernel.materializeLockedPreview,
  holdPreviewForInput: kernel.holdPreviewForInput,
  applyPreviewInteriorAngle: kernel.applyPreviewInteriorAngle,
  reopenLastDiagonalWallForAngle: kernel.reopenLastDiagonalWallForAngle,
  cancelPending: kernel.cancelPending,
  commitPreviewLength: transactionalWalls.commitPreviewLength,
  confirmClosure: transactionalWalls.confirmClosure,
  repairCollinearDegree2Walls: kernel.repairCollinearDegree2Walls,
  selectWall: kernel.selectWall,
  selectOpening: kernel.selectOpening,
  selectSpace: kernel.selectSpace,
  renameClosedSpace: kernel.renameClosedSpace,
  deleteClosedSpace: transactionalWalls.deleteClosedSpace,
  addOpeningToWall: transactionalOpenings.addOpeningToWall,
  updateOpening: transactionalOpenings.updateOpening,
  deleteOpening: transactionalOpenings.deleteOpening,
  deleteWall: transactionalWalls.deleteWall,
  startWallSnap: kernel.startWallSnap,
  snapCursorToWall: transactionalWalls.snapCursorToWall,
  startRemeasure: kernel.startRemeasure,
  remeasureSelectedWall: transactionalWalls.remeasureSelectedWall,
  setFixedNode: kernel.setFixedNode,
  setMeasurementSide: kernel.setMeasurementSide,
  canSetInitialMeasurementSide: kernel.canSetInitialMeasurementSide,
  setThickness: kernel.setThickness,
  resetCursor: kernel.resetCursor,
  updateViewport: kernel.updateViewport,
  projectWallFaces: wallFaces.projectWallFaces,
  projectWorkingFace: wallFaces.projectWorkingFace,
  measuredReadingMm: wallFaces.measuredReadingMm,
  resolveBodyNormal: wallFaces.resolveBodyNormal,
  validateSurveyDraft: validator.validateSurveyDraft
};
