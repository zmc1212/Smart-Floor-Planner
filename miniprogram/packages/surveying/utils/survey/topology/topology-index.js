function addToListMap(map, key, value) {
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

function createTopologyIndex(floor) {
  const source = floor || {};
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const walls = Array.isArray(source.walls) ? source.walls : [];
  const spaces = Array.isArray(source.spaces) ? source.spaces : [];
  const openings = Array.isArray(source.openings) ? source.openings : [];
  const index = {
    nodesById: new Map(),
    wallsById: new Map(),
    spacesById: new Map(),
    openingsById: new Map(),
    wallsByNodeId: new Map(),
    spacesByWallId: new Map(),
    openingsByWallId: new Map(),
    duplicateIds: { nodes: [], walls: [], spaces: [], openings: [] },
    missingIdIndexes: { nodes: [], walls: [], spaces: [], openings: [] },
    invalidated: false,
    invalidate() {
      this.invalidated = true;
    }
  };
  const record = (map, item, itemIndex, kind) => {
    if (!item || typeof item.id !== 'string' || !item.id) {
      index.missingIdIndexes[kind].push(itemIndex);
      return;
    }
    if (map.has(item.id)) index.duplicateIds[kind].push({ id: item.id, index: itemIndex });
    map.set(item.id, item);
  };
  nodes.forEach((node, nodeIndex) => record(index.nodesById, node, nodeIndex, 'nodes'));
  walls.forEach((wall, wallIndex) => {
    record(index.wallsById, wall, wallIndex, 'walls');
    addToListMap(index.wallsByNodeId, wall.startNodeId, wall);
    addToListMap(index.wallsByNodeId, wall.endNodeId, wall);
  });
  spaces.forEach((space, spaceIndex) => {
    record(index.spacesById, space, spaceIndex, 'spaces');
    (space.wallIds || []).forEach((wallId) => addToListMap(index.spacesByWallId, wallId, space));
  });
  openings.forEach((opening, openingIndex) => {
    record(index.openingsById, opening, openingIndex, 'openings');
    addToListMap(index.openingsByWallId, opening.wallId, opening);
  });
  return index;
}

module.exports = { createTopologyIndex };
