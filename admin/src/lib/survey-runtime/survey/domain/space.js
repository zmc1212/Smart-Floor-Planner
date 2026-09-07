// Persisted boundaries are ordered cycles, never unordered bags of walls.
function traceSpaceBoundary(wallIds, getWall, getNode, reverseFirstWall) {
  if (!Array.isArray(wallIds) || wallIds.length < 3 || new Set(wallIds).size !== wallIds.length) return [];
  const first = getWall(wallIds[0]);
  if (!first) return [];
  const origin = reverseFirstWall ? first.endNodeId : first.startNodeId;
  let current = origin;
  const visited = new Set();
  const chain = [];
  for (const id of wallIds) {
    const wall = getWall(id);
    if (!wall || visited.has(current)) return [];
    visited.add(current);
    const next = wall.startNodeId === current ? wall.endNodeId :
      (wall.endNodeId === current ? wall.startNodeId : null);
    const start = getNode(current);
    const end = getNode(next);
    if (!start || !end) return [];
    chain.push({ wall, start, end, reversed: wall.endNodeId === current });
    current = next;
  }
  return current === origin ? chain : [];
}

function buildSpaceNodeCycle(space, index) {
  const trace = reverse => traceSpaceBoundary(space && space.wallIds,
    id => index.wallsById.get(id), id => index.nodesById.get(id), reverse);
  const forward = trace(false);
  return (forward.length ? forward : trace(true)).map(entry => entry.start.id);
}

module.exports = { buildSpaceNodeCycle, traceSpaceBoundary };
