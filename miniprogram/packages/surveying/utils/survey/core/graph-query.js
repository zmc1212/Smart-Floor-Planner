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

module.exports = { getNode, getWall, getFirstNode, getLastWall, getLastEndNode, getClosedSpace };
