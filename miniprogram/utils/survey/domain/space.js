function buildSpaceNodeCycle(space, index) {
  const wallIds = Array.isArray(space && space.wallIds) ? space.wallIds : [];
  const walls = wallIds.map((wallId) => index.wallsById.get(wallId)).filter(Boolean);
  if (walls.length !== wallIds.length || walls.length < 3) return [];
  const adjacency = new Map();
  walls.forEach((wall) => {
    [wall.startNodeId, wall.endNodeId].forEach((nodeId) => {
      const values = adjacency.get(nodeId) || [];
      values.push(wall);
      adjacency.set(nodeId, values);
    });
  });
  if ([...adjacency.values()].some((values) => values.length !== 2)) return [];
  const cycle = [];
  const used = new Set();
  let wall = walls[0];
  let nodeId = wall.startNodeId;
  const startNodeId = nodeId;
  while (wall && !used.has(wall.id)) {
    used.add(wall.id);
    cycle.push(nodeId);
    nodeId = wall.startNodeId === nodeId ? wall.endNodeId : wall.startNodeId;
    wall = (adjacency.get(nodeId) || []).find((candidate) => !used.has(candidate.id));
  }
  return used.size === walls.length && nodeId === startNodeId ? cycle : [];
}

module.exports = { buildSpaceNodeCycle };
