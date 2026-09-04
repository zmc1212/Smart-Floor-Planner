// Read-only lookups preserve the legacy missing-node/wall semantics.

function getNode(floor, nodeId) {
  return floor.nodes.find((node) => node.id === nodeId);
}

function getWall(floor, wallId) {
  return floor.walls.find((wall) => wall.id === wallId);
}

module.exports = {
  getNode,
  getWall
};
