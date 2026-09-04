const { CLOSE_TOLERANCE_MM, DEFAULT_SCALE, DEFAULT_THICKNESS_MM, MIN_THICKNESS_MM, MIN_WALL_LENGTH_MM, VERTEX_AXIS_SNAP_TOLERANCE_MM } = require('./core/constants.js');
const { SESSION_STATES } = require('./core/session.js');
const { SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES, createSurveyDomainError } = require('./domain/errors.js');
const { adaptLegacySurveyOperation } = require('./compat/legacy-error-messages.js');
const { applyPreviewInteriorAngle, materializeLockedPreview, reopenLastDiagonalWallForAngle, startPreview, startPreviewFromBearing } = require('./operations/preview.js');
const { buildSpaceBoundaryPoints, findClosedSpaceForWall } = require('./topology/closed-boundary.js');
const { buildSpaceDimensionPlan, calculateSpaceAreaMm2 } = require('./read-model/space-dimensions.js');
const { buildSpaceInnerBoundaryPoints, buildSpaceRenderBoundaryPoints } = require('./read-model/space-boundary.js');
const { buildWallJoinRenderGeometries, buildWallRenderGeometry, buildWallSnapGeometry } = require('./read-model/wall-geometry.js');
const { cancelPending, clearBleLockedBearing, holdPreviewForInput, lockPreviewBearing, selectOpening, selectSpace, selectWall, setFixedNode, setMode, startRemeasure, startWallSnap } = require('./operations/session-actions.js');
const { cloneDraft, createSurveyDraft, getActiveFloor: findActiveFloor, touchDraft } = require('./core/draft.js');
const { commitPreviewLength } = require('./operations/commit-preview.js');
const { createLegacyConfirmClosure } = require('./operations/closure.js');
const { deleteClosedSpace, deleteWall } = require('./operations/wall-deletion.js');
const { getClosedSpace, getNode, getWall } = require('./core/graph-query.js');
const { getClosurePath, getCursorDisplayPoint } = require('./read-model/cursor.js');
const { getCursorPlacementTarget, getWallSnapPoint } = require('./snap/wall-targets.js');
const { getMinimumActiveCloseWallCount, getMinimumClosureSuggestionWallCount, getMinimumDirectBoundaryCloseWallCount } = require('./topology/closure-queries.js');
const { getOpening, mergeCollinearDegree2Walls, removeUnreferencedNodes, syncFloorSpaces } = require('./operations/wall-mutation-helpers.js');
const { isDirectClosureHit } = require('./interaction/closure-projection.js');
const { legacyOpeningOperations } = require('./operations/opening-operations.js');
const { legacyRemeasureSelectedWall } = require('./operations/measurement.js');
const { placeCursor, placeNewWallChainCursor, resetCursor, snapCursorToWall } = require('./operations/cursor.js');
const { resolveLastWallReverseEdit } = require('./topology/wall-edit-queries.js');
const domainValidation = require('./domain/validation.js');
const vector2 = require('./geometry/vector2.js');
const wallDomain = require('./domain/wall.js');

const legacySetThickness = adaptLegacySurveyOperation(setThickness);
const legacySnapCursorToWall = adaptLegacySurveyOperation(snapCursorToWall);
const legacyRenameClosedSpace = adaptLegacySurveyOperation(renameClosedSpace);
const legacyConfirmClosure = createLegacyConfirmClosure(commitPreviewLength);
const legacyCommitPreviewLength = adaptLegacySurveyOperation(commitPreviewLength);
const legacyReopenLastDiagonalWallForAngle = adaptLegacySurveyOperation(reopenLastDiagonalWallForAngle);
const legacyApplyPreviewInteriorAngle = adaptLegacySurveyOperation(applyPreviewInteriorAngle);
const legacyMaterializeLockedPreview = adaptLegacySurveyOperation(materializeLockedPreview);
const legacyLockPreviewBearing = adaptLegacySurveyOperation(lockPreviewBearing);
const legacyStartPreviewFromBearing = adaptLegacySurveyOperation(startPreviewFromBearing);
const angleDeg = vector2.angleDeg;
const distanceMm = vector2.distanceMm;
const validateThickness = domainValidation.validateThickness;
const MAX_SPACE_NAME_LENGTH = 20;
const pointFromLength = wallDomain.pointFromMeasuredLength;
const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
function repairCollinearDegree2Walls(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  mergeCollinearDegree2Walls(floor);
  if ((floor.spaces || []).some((space) => space && space.closed)) {
    syncFloorSpaces(floor);
  }
  removeUnreferencedNodes(floor);
  return touchDraft(next);
}

function isPreviewReverseEdit(draft) {
  const floor = getActiveFloor(draft);
  const session = floor && floor.session;
  const anchor = session && getNode(floor, session.anchorNodeId);
  if (!floor || !session || !anchor || !session.previewPoint) return false;
  const point = pointFromLength(anchor, session.previewPoint, Number(session.previewLengthMm) || 0,
    session.previewMeasurementStartInsetMm, session.previewMeasurementEndInsetMm,
    session.previewMeasurementStartExtensionMm);
  return !!resolveLastWallReverseEdit(floor, session, anchor, point);
}

function renameClosedSpace(draft, spaceId, name) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const space = getClosedSpace(floor, spaceId || (floor.session && floor.session.selectedSpaceId));
  if (!space) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_SPACE_REQUIRED);
  }
  const nextName = String(name == null ? '' : name).trim();
  if (!nextName) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.ROOM_NAME_REQUIRED);
  }
  if (nextName.length > MAX_SPACE_NAME_LENGTH) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.ROOM_NAME_TOO_LONG, {
      maximumCharacters: MAX_SPACE_NAME_LENGTH
    });
  }
  space.name = nextName;
  return touchDraft(next);
}

function orderClosedBoundaryWallIds(floor, wallIds) {
  const uniqueWallIds = (wallIds || []).filter((wallId, index, list) => (
    wallId && list.indexOf(wallId) === index && !!getWall(floor, wallId)
  ));
  if (uniqueWallIds.length < 3) return [];
  const incidentWallIds = new Map();
  uniqueWallIds.forEach((wallId) => {
    const wall = getWall(floor, wallId);
    [wall.startNodeId, wall.endNodeId].forEach((nodeId) => {
      const incident = incidentWallIds.get(nodeId) || [];
      incident.push(wallId);
      incidentWallIds.set(nodeId, incident);
    });
  });
  if ([...incidentWallIds.values()].some((incident) => incident.length !== 2)) return [];
  const firstWall = getWall(floor, uniqueWallIds[0]);
  const trace = (reverseFirstWall) => {
    const initialNodeId = reverseFirstWall ? firstWall.endNodeId : firstWall.startNodeId;
    let currentNodeId = reverseFirstWall ? firstWall.startNodeId : firstWall.endNodeId;
    let currentWallId = firstWall.id;
    const ordered = [firstWall.id];
    const used = new Set(ordered);
    while (ordered.length < uniqueWallIds.length) {
      const nextWallId = (incidentWallIds.get(currentNodeId) || []).find((id) => id !== currentWallId && !used.has(id));
      if (!nextWallId) return [];
      const nextWall = getWall(floor, nextWallId);
      currentNodeId = nextWall.startNodeId === currentNodeId ? nextWall.endNodeId : nextWall.startNodeId;
      currentWallId = nextWallId;
      ordered.push(nextWallId);
      used.add(nextWallId);
    }
    return currentNodeId === initialNodeId ? ordered : [];
  };
  const ordered = trace(false);
  return ordered.length ? ordered : trace(true);
}

function setMeasurementSide(draft, side, wallId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor.session;
  const targetSide = side === 'left' ? 'left' : 'right';
  const targetWallId = wallId || session.selectedWallId;
  const wall = targetWallId ? getWall(floor, targetWallId) : null;

  // The measuring edge establishes the convention for a free-standing wall
  // chain. A chain snapped to an existing boundary inherits that boundary side.
  if (!canSetInitialMeasurementSide(floor, session, wall && wall.id)) return next;

  const previousSide = wall && (wall.measurementSide === 'left' || wall.measurementSide === 'right')
    ? wall.measurementSide
    : (session.previewMeasurementSide === 'left' || session.previewMeasurementSide === 'right'
      ? session.previewMeasurementSide
      : session.measurementSide);
  session.measurementSideUserSet = true;
  session.measurementSide = targetSide;
  if (session.previewPoint) {
    session.previewMeasurementSide = targetSide;
  }
  if (session.activeSpaceSharedWallId && (previousSide === 'left' || previousSide === 'right')) {
    if (!session.previewBodyNormalSide) {
      session.previewBodyNormalSide = previousSide;
    }
    if (wall && !wall.bodyNormalSide) {
      wall.bodyNormalSide = session.previewBodyNormalSide;
    }
  }
  if (wall) {
    wall.measurementSide = targetSide;
  }

  return touchDraft(next);
}

function canSetInitialMeasurementSide(floor, session, wallId) {
  if (!floor || !session) return false;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  const firstWall = floor.walls[startWallIndex] || null;

  if (session.activeSpaceSharedWallId) {
    const startsFromClosedBoundary = !!findClosedSpaceForWall(floor, session.activeSpaceSharedWallId);
    const previewStage = startsFromClosedBoundary &&
      activeWallCount === 0 &&
      !!session.previewPoint &&
      (session.state === SESSION_STATES.WALL_PREVIEW || session.state === SESSION_STATES.AWAITING_LENGTH);
    const committedStage = startsFromClosedBoundary &&
      activeWallCount === 1 &&
      !!firstWall &&
      (!wallId || wallId === firstWall.id) &&
      (session.state === SESSION_STATES.WALL_COMMITTED || session.state === SESSION_STATES.MERGE_CLOSING) &&
      !session.previewPoint;
    return previewStage || committedStage;
  }

  return !!(
    firstWall &&
    (!wallId || wallId === firstWall.id) &&
    floor.walls.length === startWallIndex + 1 &&
    session.state === SESSION_STATES.WALL_COMMITTED &&
    !session.previewPoint
  );
}

function setThickness(draft, thicknessMm, wallId) {
  const parsedThickness = validateThickness(thicknessMm);
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const targetWallId = wallId || floor.session.selectedWallId;
  const wall = targetWallId ? getWall(floor, targetWallId) : null;

  floor.session.thicknessMm = parsedThickness;
  next.settings.defaultThicknessMm = parsedThickness;
  if (wall) {
    wall.thicknessMm = parsedThickness;
  }

  return touchDraft(next);
}

const { updateViewport } = require('./operations/viewport.js');


module.exports = {
  DEFAULT_THICKNESS_MM,
  DEFAULT_SCALE,
  CLOSE_TOLERANCE_MM,
  VERTEX_AXIS_SNAP_TOLERANCE_MM,
  MIN_WALL_LENGTH_MM,
  MIN_THICKNESS_MM,
  createSurveyDraft,
  cloneDraft,
  getActiveFloor,
  getNode,
  getWall,
  getOpening,
  getWallSnapPoint,
  getCursorPlacementTarget,
  getCursorDisplayPoint,
  isDirectClosureHit,
  distanceMm,
  angleDeg,
  buildWallSnapGeometry,
  buildWallRenderGeometry,
  buildWallJoinRenderGeometries,
  buildSpaceBoundaryPoints,
  buildSpaceInnerBoundaryPoints,
  buildSpaceRenderBoundaryPoints,
  buildSpaceDimensionPlan,
  getClosurePath,
  getMinimumClosureSuggestionWallCount,
  getMinimumDirectBoundaryCloseWallCount,
  getMinimumActiveCloseWallCount,
  calculateSpaceAreaMm2,
  setMode,
  placeCursor,
  placeNewWallChainCursor,
  startPreview,
  startPreviewFromBearing: legacyStartPreviewFromBearing,
  lockPreviewBearing: legacyLockPreviewBearing,
  clearBleLockedBearing,
  materializeLockedPreview: legacyMaterializeLockedPreview,
  holdPreviewForInput,
  applyPreviewInteriorAngle: legacyApplyPreviewInteriorAngle,
  reopenLastDiagonalWallForAngle: legacyReopenLastDiagonalWallForAngle,
  cancelPending,
  commitPreviewLength: legacyCommitPreviewLength,
  confirmClosure: legacyConfirmClosure,
  repairCollinearDegree2Walls,
  selectWall,
  selectOpening,
  selectSpace,
  renameClosedSpace: legacyRenameClosedSpace,
  deleteClosedSpace,
  addOpeningToWall: legacyOpeningOperations.addOpeningToWall,
  updateOpening: legacyOpeningOperations.updateOpening,
  deleteOpening: legacyOpeningOperations.deleteOpening,
  deleteWall,
  startWallSnap,
  snapCursorToWall: legacySnapCursorToWall,
  startRemeasure,
  remeasureSelectedWall: legacyRemeasureSelectedWall,
  setFixedNode,
  setMeasurementSide,
  canSetInitialMeasurementSide,
  setThickness: legacySetThickness,
  resetCursor,
  updateViewport
};
