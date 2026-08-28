const vector2 = require('../geometry/vector2.js');

function coordinateLength(floor, wall, index) {
  const lookup = index && index.nodesById;
  const start = lookup ? lookup.get(wall.startNodeId) : floor.nodes.find((node) => node.id === wall.startNodeId);
  const end = lookup ? lookup.get(wall.endNodeId) : floor.nodes.find((node) => node.id === wall.endNodeId);
  return vector2.distance(start, end);
}

function undirectedKey(wall) {
  return [wall.startNodeId, wall.endNodeId].sort().join('|');
}

module.exports = {
  coordinateLength,
  undirectedKey
};
