// Compatibility entry only. Production consumers use surveyWallGraph.js;
// historical direct callers retain the unwrapped operation/error contract.
const constants = require('./core/constants.js');
const draftCore = require('./core/draft.js');
const queries = require('./core/graph-query.js');
const legacyQueries = require('./compat/legacy-queries.js');
const geometry = require('./geometry/vector2.js');
const closureQueries = require('./topology/closure-queries.js');
const wallHelpers = require('./operations/wall-mutation-helpers.js');
const wallProperties = require('./operations/wall-properties.js');
const spaceProperties = require('./operations/space-properties.js');
const wallRepair = require('./operations/wall-repair.js');
const measurementSide = require('./interaction/measurement-side.js');
const interactions = require('./operations/interaction-operations.js');
const snapEngine = require('./snap/snap-engine.js');
const cursorReadModel = require('./read-model/cursor.js');
const closureInteraction = require('./interaction/closure-projection.js');
const wallGeometry = require('./read-model/wall-geometry.js');
const spaceBoundary = require('./read-model/space-boundary.js');
const spaceDimensions = require('./read-model/space-dimensions.js');
const previewCommit = require('./operations/commit-preview.js');
const cursor = require('./operations/cursor.js');
const deletions = require('./operations/wall-deletion.js');
const openings = require('./operations/opening-operations.js');
const measurements = require('./operations/measurement.js');
const closures = require('./operations/closure.js');
const { adaptLegacySurveyOperation } = require('./compat/legacy-error-messages.js');
const legacyCommit = { commitPreviewLength: adaptLegacySurveyOperation(previewCommit.commitPreviewLength) };
const legacyCursor = { snapCursorToWall: adaptLegacySurveyOperation(cursor.snapCursorToWall) };
const legacyClosure = { confirmClosure: closures.createLegacyConfirmClosure(previewCommit.commitPreviewLength) };

module.exports = {
  DEFAULT_THICKNESS_MM: constants.DEFAULT_THICKNESS_MM,
  DEFAULT_SCALE: constants.DEFAULT_SCALE,
  CLOSE_TOLERANCE_MM: constants.CLOSE_TOLERANCE_MM,
  VERTEX_AXIS_SNAP_TOLERANCE_MM: constants.VERTEX_AXIS_SNAP_TOLERANCE_MM,
  MIN_WALL_LENGTH_MM: constants.MIN_WALL_LENGTH_MM,
  MIN_THICKNESS_MM: constants.MIN_THICKNESS_MM,
  createSurveyDraft: draftCore.createSurveyDraft,
  cloneDraft: draftCore.cloneDraft,
  getActiveFloor: legacyQueries.getActiveFloor,
  getNode: queries.getNode,
  getWall: queries.getWall,
  getOpening: wallHelpers.getOpening,
  getWallSnapPoint: snapEngine.getWallSnapPoint,
  getCursorPlacementTarget: snapEngine.getCursorPlacementTarget,
  getCursorDisplayPoint: cursorReadModel.getCursorDisplayPoint,
  isDirectClosureHit: closureInteraction.isDirectClosureHit,
  distanceMm: geometry.distanceMm,
  angleDeg: geometry.angleDeg,
  buildWallSnapGeometry: wallGeometry.buildWallSnapGeometry,
  buildWallRenderGeometry: wallGeometry.buildWallRenderGeometry,
  buildWallJoinRenderGeometries: wallGeometry.buildWallJoinRenderGeometries,
  buildSpaceBoundaryPoints: spaceBoundary.buildSpaceBoundaryPoints,
  buildSpaceInnerBoundaryPoints: spaceBoundary.buildSpaceInnerBoundaryPoints,
  buildSpaceRenderBoundaryPoints: spaceBoundary.buildSpaceRenderBoundaryPoints,
  buildSpaceDimensionPlan: spaceDimensions.buildSpaceDimensionPlan,
  getClosurePath: cursorReadModel.getClosurePath,
  getMinimumClosureSuggestionWallCount: closureQueries.getMinimumClosureSuggestionWallCount,
  getMinimumDirectBoundaryCloseWallCount: closureQueries.getMinimumDirectBoundaryCloseWallCount,
  getMinimumActiveCloseWallCount: closureQueries.getMinimumActiveCloseWallCount,
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
  commitPreviewLength: legacyCommit.commitPreviewLength,
  confirmClosure: legacyClosure.confirmClosure,
  repairCollinearDegree2Walls: wallRepair.legacyRepairCollinearDegree2Walls,
  selectWall: interactions.selectWall,
  selectOpening: interactions.selectOpening,
  selectSpace: interactions.selectSpace,
  renameClosedSpace: spaceProperties.legacyRenameClosedSpace,
  deleteClosedSpace: deletions.deleteClosedSpace,
  addOpeningToWall: openings.legacyOpeningOperations.addOpeningToWall,
  updateOpening: openings.legacyOpeningOperations.updateOpening,
  deleteOpening: openings.legacyOpeningOperations.deleteOpening,
  deleteWall: deletions.deleteWall,
  startWallSnap: interactions.startWallSnap,
  snapCursorToWall: legacyCursor.snapCursorToWall,
  startRemeasure: interactions.startRemeasure,
  remeasureSelectedWall: measurements.legacyRemeasureSelectedWall,
  setFixedNode: interactions.setFixedNode,
  setMeasurementSide: wallProperties.legacySetMeasurementSide,
  canSetInitialMeasurementSide: measurementSide.canSetInitialMeasurementSide,
  setThickness: wallProperties.legacySetThickness,
  resetCursor: interactions.resetCursor,
  updateViewport: interactions.updateViewport
};
