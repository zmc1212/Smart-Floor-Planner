const { getClosedSpace, getNode, getWall } = require('../core/graph-query.js');
function resolveProjectionIntent(floor, intent) {
  if (!intent) return null;
  return {
    point: intent.point ? { xMm: intent.point.xMm, yMm: intent.point.yMm } : null,
    t: intent.t, snapLine: intent.snapLine,
    wall: getWall(floor, intent.wallId), node: getNode(floor, intent.nodeId),
    start: getNode(floor, intent.startNodeId), end: getNode(floor, intent.endNodeId),
    sourceSpace: getClosedSpace(floor, intent.sourceSpaceId), topologyNode: getNode(floor, intent.topologyNodeId)
  };
}

module.exports = {
  resolveProjectionIntent
};
