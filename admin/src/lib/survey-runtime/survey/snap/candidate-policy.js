// Shared by graph queries and the editor's precomputed Canvas index. Geometry
// collection differs; hit priority and the inner/outer terminal band do not.
function preferOuterVertex(innerVertex, outerVertex, innerRadiusMm) {
  if (!outerVertex) return false;
  if (!innerVertex) return true;
  if (innerVertex.distanceMm <= innerRadiusMm && outerVertex.distanceMm > innerRadiusMm * 0.4) {
    return false;
  }
  return outerVertex.distanceMm < innerVertex.distanceMm;
}

function preferOuterProjection(vertex, projection, limitMm, innerRadiusMm) {
  return !!(vertex && projection && projection.snapLine === 'outer' &&
    projection.distanceMm <= limitMm && vertex.distanceMm > innerRadiusMm &&
    projection.distanceMm < vertex.distanceMm);
}

function targetPriority(target) {
  if (!target) return 0;
  if (target.type === 'vertex') return 3;
  if (target.type === 'wall') return 2;
  if (target.type === 'alignment') return 1;
  return 0;
}

module.exports = { preferOuterVertex, preferOuterProjection, targetPriority };
