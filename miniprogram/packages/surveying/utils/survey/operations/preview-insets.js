const { buildBaseWallSegment } = require('../read-model/wall-geometry.js');
const { ensureSessionSpaceTracking } = require('../core/session.js');
const { getNode } = require('../core/graph-query.js');
const { setWallEndpointInset } = require('./wall-mutation-helpers.js');
const vector2 = require('../geometry/vector2.js');

const dot = vector2.dot;
const distanceMm = vector2.distanceMm;
function updateWallEndpointInset(floor, wall, nodeId, insetMm) {
  setWallEndpointInset(floor, wall, nodeId, insetMm, true);
}

function applyWallBodyInsetToIncidentWalls(floor, sourceWall, nodeId) {
  if (!floor || !sourceWall || !nodeId) return;
  const session = ensureSessionSpaceTracking(floor);
  const activeStartWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : floor.walls.length;
  const sourceWallIndex = floor.walls.findIndex((wall) => wall && wall.id === sourceWall.id);
  if (
    session.activeSpaceSharedWallMiddle &&
    sourceWallIndex > activeStartWallIndex
  ) {
    // A wall-middle T chain already records its real measurement origin on
    // the first wall and its final boundary inset on the closing wall. Later
    // turns must not shorten earlier confirmed readings merely to cover the
    // solid corner; the renderer joins those wall bodies from topology.
    return;
  }
  const sourceSegment = buildBaseWallSegment(floor, sourceWall);
  if (!sourceSegment) return;

  (floor.walls || []).forEach((wall) => {
    if (!wall || wall.id === sourceWall.id) return;
    const touchesStart = wall.startNodeId === nodeId;
    const touchesEnd = wall.endNodeId === nodeId;
    if (!touchesStart && !touchesEnd) return;
    const node = getNode(floor, nodeId);
    const oppositeNode = getNode(floor, touchesStart ? wall.endNodeId : wall.startNodeId);
    if (!node || !oppositeNode) return;
    const length = distanceMm(node, oppositeNode);
    if (!length) return;
    const awayDirection = {
      x: (oppositeNode.xMm - node.xMm) / length,
      y: (oppositeNode.yMm - node.yMm) / length
    };
    const coverageRate = dot(awayDirection, sourceSegment.normal);
    if (coverageRate <= 0.25) return;
    updateWallEndpointInset(
      floor,
      wall,
      nodeId,
      Math.ceil(sourceSegment.thicknessMm / coverageRate)
    );
  });
}

module.exports = {
  updateWallEndpointInset,
  applyWallBodyInsetToIncidentWalls
};
