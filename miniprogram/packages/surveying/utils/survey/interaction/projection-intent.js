
function projectionIntent(projection) {
  if (!projection) return null;
  return {
    point: projection.point ? { xMm: projection.point.xMm, yMm: projection.point.yMm } : null,
    t: projection.t, snapLine: projection.snapLine,
    wallId: projection.wall ? projection.wall.id : '', nodeId: projection.node ? projection.node.id : '',
    startNodeId: projection.start ? projection.start.id : '', endNodeId: projection.end ? projection.end.id : '',
    sourceSpaceId: projection.sourceSpace ? projection.sourceSpace.id : '',
    topologyNodeId: projection.topologyNode ? projection.topologyNode.id : ''
  };
}

module.exports = {
  projectionIntent
};
