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

module.exports = {
  SNAP_ACQUIRE_PX,
  SNAP_RELEASE_PX,
  resolveSnap
};
