function describeWallSplit(floor, wallId, index) {
  const topologyIndex = index;
  const wall = topologyIndex && topologyIndex.wallsById.get(wallId);
  if (!wall) return null;
  return {
    wall,
    openings: topologyIndex.openingsByWallId.get(wallId) || [],
    spaces: topologyIndex.spacesByWallId.get(wallId) || []
  };
}

module.exports = { describeWallSplit };
