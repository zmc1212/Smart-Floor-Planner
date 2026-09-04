// Read-only lookups preserve the legacy missing-node/wall semantics.

function getNode(floor, nodeId) {
  return floor.nodes.find((node) => node.id === nodeId);
}

function getWall(floor, wallId) {
  return floor.walls.find((wall) => wall.id === wallId);
}

function getFirstNode(floor) {
  if (!floor.walls.length) return null;
  return getNode(floor, floor.walls[0].startNodeId);
}

function getLastWall(floor) {
  return floor.walls[floor.walls.length - 1] || null;
}

function getLastEndNode(floor) {
  const lastWall = getLastWall(floor);
  return lastWall ? getNode(floor, lastWall.endNodeId) : null;
}

function getClosedSpace(floor, spaceId) {
  if (!spaceId) return null;
  return (floor.spaces || []).find((space) => (
    space && space.id === spaceId && space.closed && Array.isArray(space.wallIds)
  )) || null;
}

function getNodeWallUseCount(floor, nodeId) {
  if (!floor || !nodeId) return 0;
  return (floor.walls || []).filter((wall) => (
    wall.startNodeId === nodeId || wall.endNodeId === nodeId
  )).length;
}

// Return the only endpoint of a wall that is connected to another wall.
// Measurement operations use this to keep the connected endpoint fixed while
// moving a free endpoint. Keeping the lookup in the shared graph-query layer
// avoids a second topology implementation in the legacy compatibility kernel.
function getSingleSharedEndpoint(floor, wall) {
  if (!floor || !wall) return null;
  const startShared = (floor.walls || []).some((item) => (
    item.id !== wall.id &&
    (item.startNodeId === wall.startNodeId || item.endNodeId === wall.startNodeId)
  ));
  const endShared = (floor.walls || []).some((item) => (
    item.id !== wall.id &&
    (item.startNodeId === wall.endNodeId || item.endNodeId === wall.endNodeId)
  ));

  if (startShared === endShared) return null;
  return startShared
    ? { fixedNodeId: wall.startNodeId, movingNodeId: wall.endNodeId }
    : { fixedNodeId: wall.endNodeId, movingNodeId: wall.startNodeId };
}

module.exports = {
  getNode,
  getWall,
  getFirstNode,
  getLastWall,
  getLastEndNode,
  getClosedSpace,
  getNodeWallUseCount,
  getSingleSharedEndpoint
};
