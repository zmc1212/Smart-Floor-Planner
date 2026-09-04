const { SESSION_STATES } = require('../core/session.js');
const { getWall } = require('../core/graph-query.js');
const { findClosedSpaceForWall } = require('../topology/closed-boundary.js');

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

function planMeasurementSide(floor, side, wallId) {
  const session = floor.session;
  const targetSide = side === 'left' ? 'left' : 'right';
  const targetWallId = wallId || session.selectedWallId;
  const wall = targetWallId ? getWall(floor, targetWallId) : null;
  if (!canSetInitialMeasurementSide(floor, session, wall && wall.id)) return { kind: 'noop' };
  const previousSide = wall && (wall.measurementSide === 'left' || wall.measurementSide === 'right')
    ? wall.measurementSide
    : (session.previewMeasurementSide === 'left' || session.previewMeasurementSide === 'right'
      ? session.previewMeasurementSide
      : session.measurementSide);
  const sessionPatch = { measurementSideUserSet: true, measurementSide: targetSide };
  const wallPatch = wall ? { measurementSide: targetSide } : {};
  if (session.previewPoint) sessionPatch.previewMeasurementSide = targetSide;
  if (session.activeSpaceSharedWallId && (previousSide === 'left' || previousSide === 'right')) {
    if (!session.previewBodyNormalSide) sessionPatch.previewBodyNormalSide = previousSide;
    if (wall && !wall.bodyNormalSide) {
      wallPatch.bodyNormalSide = session.previewBodyNormalSide || previousSide;
    }
  }
  return { kind: 'measurement-side', wallId: wall ? wall.id : null, sessionPatch, wallPatch };
}

module.exports = { canSetInitialMeasurementSide, planMeasurementSide };
