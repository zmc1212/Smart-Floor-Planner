const {
  snapPreviewPoint, maybeSnapToPreviousDiagonalDirection, maybeSnapThirdWallForRectangle,
  maybeSnapResetChainForRectangleClosure, maybeSnapStraightPreviewToVertexAxis, maybeSnapStraightClosureToStart
} = require('./preview-alignment.js');
const wallTargets = require('./wall-targets.js');
const { SNAP_ACQUIRE_PX, SNAP_RELEASE_PX } = require('../core/constants.js');
const vector2 = require('../geometry/vector2.js');

function normalizeCandidate(candidate) {
  if (!candidate || !candidate.pointMm) return candidate;
  return Object.assign({}, candidate, {
    pointMm: {
      xMm: Math.round(Number(candidate.pointMm.xMm)),
      yMm: Math.round(Number(candidate.pointMm.yMm))
    }
  });
}

function resolveSnap(options) {
  const opts = options || {};
  const scale = Math.max(0.000001, Number(opts.scale) || 1);
  const rawPoint = opts.rawPointMm;
  const candidate = normalizeCandidate(opts.candidate || null);
  const previousLock = opts.previousLock || null;
  const acquireMm = (Number(opts.acquirePx) || SNAP_ACQUIRE_PX) / scale;
  const releaseMm = (Number(opts.releasePx) || SNAP_RELEASE_PX) / scale;

  if (previousLock && previousLock.pointMm && rawPoint && vector2.distance(rawPoint, previousLock.pointMm) <= releaseMm) {
    return { candidate: previousLock.candidate, lock: previousLock, acquired: false, retained: true };
  }
  if (candidate && candidate.pointMm && rawPoint && vector2.distance(rawPoint, candidate.pointMm) <= acquireMm) {
    const lock = { candidate, pointMm: candidate.pointMm };
    return { candidate, lock, acquired: true, retained: false };
  }
  return { candidate: null, lock: null, acquired: false, retained: false };
}

// Input: read-only floor/session, anchor and millimetre pointer. Output: point
// and one guide. Direct-start > reset-rectangle > rectangle > vertex-axis >
// previous-diagonal controls guide priority; rectangle guides suppress axis snap.
function resolvePreviewSnap(floor, session, anchor, rawPoint) {
  const orthogonalPoint = snapPreviewPoint(anchor, rawPoint, session.mode);
  const directionSnap = maybeSnapToPreviousDiagonalDirection(floor, session, anchor, orthogonalPoint);
  const rectangleSnap = maybeSnapThirdWallForRectangle(floor, session, anchor, directionSnap.point);
  const resetClosureSnap = maybeSnapResetChainForRectangleClosure(
    floor,
    session,
    anchor,
    rectangleSnap.point
  );
  const vertexAxisSnap = resetClosureSnap.guide || rectangleSnap.guide
    ? { point: resetClosureSnap.point, guide: null }
    : maybeSnapStraightPreviewToVertexAxis(
      floor,
      session,
      anchor,
      resetClosureSnap.point
    );
  const directStartClosureSnap = maybeSnapStraightClosureToStart(
    floor,
    session,
    anchor,
    rawPoint,
    vertexAxisSnap.point
  );

  return { point: directStartClosureSnap.point,
    guide: directStartClosureSnap.guide || resetClosureSnap.guide || rectangleSnap.guide ||
      vertexAxisSnap.guide || directionSnap.guide };
}

function resolveConfirmationSnap(floor, session, anchor, measuredEndPoint, shortenLastWall, preservesOuterTWorkingLength) {
  const rectangle = shortenLastWall ? { point: measuredEndPoint, guide: null }
    : maybeSnapThirdWallForRectangle(floor, session, anchor, measuredEndPoint);
  const reset = maybeSnapResetChainForRectangleClosure(floor, session, anchor, rectangle.point);
  const axis = reset.guide || rectangle.guide ? { point: reset.point, guide: null }
    : maybeSnapStraightPreviewToVertexAxis(floor, session, anchor, reset.point);
  return { point: preservesOuterTWorkingLength || shortenLastWall ? measuredEndPoint : axis.point };
}

module.exports = {
  resolvePreviewSnap,
  resolveConfirmationSnap,
  getWallSnapPoint: wallTargets.getWallSnapPoint,
  getCursorPlacementTarget: wallTargets.getCursorPlacementTarget,
  SNAP_ACQUIRE_PX,
  SNAP_RELEASE_PX,
  resolveSnap
};
