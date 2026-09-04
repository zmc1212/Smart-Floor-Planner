

function findWallPathBetweenNodes(floor, fromNodeId, toNodeId, excludedWallIds) {
  if (!floor || !fromNodeId || !toNodeId) return [];
  if (fromNodeId === toNodeId) return [];

  const excluded = excludedWallIds || {};
  const visited = {};
  const queue = [{ nodeId: fromNodeId, wallIds: [] }];
  visited[fromNodeId] = true;

  while (queue.length) {
    const current = queue.shift();
    const walls = floor.walls || [];
    for (let index = 0; index < walls.length; index += 1) {
      const wall = walls[index];
      if (!wall || excluded[wall.id]) continue;
      let nextNodeId = '';
      if (wall.startNodeId === current.nodeId) {
        nextNodeId = wall.endNodeId;
      } else if (wall.endNodeId === current.nodeId) {
        nextNodeId = wall.startNodeId;
      }
      if (!nextNodeId || visited[nextNodeId]) continue;
      const nextWallIds = current.wallIds.concat(wall.id);
      if (nextNodeId === toNodeId) {
        return nextWallIds;
      }
      visited[nextNodeId] = true;
      queue.push({ nodeId: nextNodeId, wallIds: nextWallIds });
    }
  }

  return [];
}

module.exports = {
  findWallPathBetweenNodes
};
