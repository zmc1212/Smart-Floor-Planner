const { buildOrthogonalClosurePoints, findMergeClosurePlan, isAxisAlignedWithAnchor, normalizeClosurePoints } = require('../topology/closure-queries.js');
const { buildWallRenderGeometry } = require('./wall-geometry.js');
const { getLastWall, getNode, getWall } = require('../core/graph-query.js');
const { resolveMeasurementEndInsetMm } = require('../topology/wall-alignment.js');
const vector2 = require('../geometry/vector2.js');

const distanceMm = vector2.distanceMm;
function getCursorDisplayPoint(floor, session) {
  if (!floor || !session || !session.anchorNodeId) return null;

  const anchor = getNode(floor, session.anchorNodeId);
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  const isOuterTChain = session.activeSpaceSharedWallMiddle &&
    session.activeSpaceSharedSnapLine === 'outer';

  // Once a branch is being drawn, the cursor follows its graph-side working
  // face. Inner/outer only chooses the near/far start on the source boundary;
  // applying it again to the branch endpoint would shift the cursor sideways
  // by one wall thickness as soon as the operator drags the next segment.
  if (session.previewPoint) return session.previewPoint;

  if (isOuterTChain && activeWallCount > 0) {
    const lastWall = (floor.walls || [])[floor.walls.length - 1] || null;
    const geometry = lastWall ? buildWallRenderGeometry(floor, lastWall) : null;
    if (geometry) {
      return geometry.end;
    }
  }

  if (
    anchor &&
    activeWallCount === 0 &&
    session.activeSpaceSharedSnapLine === 'outer' &&
    session.activeSpaceSharedWallId &&
    typeof session.activeSpaceSharedStartT === 'number'
  ) {
    const wall = getWall(floor, session.activeSpaceSharedWallId);
    const geometry = wall ? buildWallRenderGeometry(floor, wall) : null;
    if (geometry && geometry.outerStart && geometry.outerEnd) {
      const t = clampNumber(session.activeSpaceSharedStartT, 0, 1);
      return {
        xMm: Math.round(geometry.outerStart.xMm + (geometry.outerEnd.xMm - geometry.outerStart.xMm) * t),
        yMm: Math.round(geometry.outerStart.yMm + (geometry.outerEnd.yMm - geometry.outerStart.yMm) * t)
      };
    }
  }
  return anchor || null;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getOrthogonalClosureGuidePoints(floor, session, currentNode, targetNode) {
  if (!currentNode || !targetNode) return [];
  if (!session || session.mode !== 'straight' || isAxisAlignedWithAnchor(currentNode, targetNode, 1)) {
    return [currentNode, targetNode];
  }
  const lastWall = getLastWall(floor);
  const incomingStart = session.previewPoint
    ? getNode(floor, session.anchorNodeId)
    : (lastWall ? getNode(floor, lastWall.startNodeId) : getNode(floor, session.anchorNodeId));
  const pathCandidates = buildOrthogonalClosurePoints(targetNode, currentNode, incomingStart);
  for (let index = 0; index < pathCandidates.length; index += 1) {
    const points = normalizeClosurePoints(pathCandidates[index]);
    if (points.length < 2) continue;
    if (points.some((point, pointIndex) => (
      pointIndex > 0 && !isAxisAlignedWithAnchor(points[pointIndex - 1], point, 1)
    ))) continue;
    return points.map((point) => ({ xMm: point.xMm, yMm: point.yMm }));
  }
  return [currentNode, targetNode];
}

function getClosurePath(floor, session) {
  if (!floor || !session) return [];
  const currentNode = session.previewPoint || getNode(floor, session.anchorNodeId);
  const targetNode = session.closeCandidatePoint || getNode(floor, session.closeCandidateNodeId);
  if (!currentNode || !targetNode) return [];
  if (session.closeCandidateType !== 'merge') {
    return getOrthogonalClosureGuidePoints(floor, session, currentNode, targetNode);
  }

  const plan = findMergeClosurePlan(floor, session, currentNode);
  if (!plan || !plan.targetNode || plan.targetNode.id !== session.closeCandidateNodeId) return [];
  const points = plan.points.map((point) => ({ xMm: point.xMm, yMm: point.yMm }));
  if (points.length >= 2) {
    const previous = points[points.length - 2];
    const target = points[points.length - 1];
    const endInsetMm = resolveMeasurementEndInsetMm(
      floor,
      previous,
      plan.targetNode,
      session.activeSpaceSharedWallId
    );
    const length = distanceMm(previous, target);
    if (endInsetMm > 0 && length > endInsetMm) {
      points[points.length - 1] = {
        xMm: Math.round(target.xMm + (previous.xMm - target.xMm) / length * endInsetMm),
        yMm: Math.round(target.yMm + (previous.yMm - target.yMm) / length * endInsetMm)
      };
    }
  }
  return points;
}

module.exports = {
  getCursorDisplayPoint,
  clampNumber,
  getOrthogonalClosureGuidePoints,
  getClosurePath
};
