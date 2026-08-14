function normalizeDraft(draft) {
  const floor = draft.floors.find((item) => item.id === draft.activeFloorId) || draft.floors[0];
  const nodeIds = new Map(floor.nodes.map((node, index) => [node.id, `n${index + 1}`]));
  const wallIds = new Map(floor.walls.map((wall, index) => [wall.id, `w${index + 1}`]));
  const openingIds = new Map(floor.openings.map((opening, index) => [opening.id, `o${index + 1}`]));
  const spaceIds = new Map(floor.spaces.map((space, index) => [space.id, `s${index + 1}`]));
  const mapId = (map, id) => id ? map.get(id) || 'missing' : '';
  return {
    nodes: floor.nodes.map((node) => ({
      id: nodeIds.get(node.id),
      xMm: node.xMm,
      yMm: node.yMm
    })),
    walls: floor.walls.map((wall) => ({
      id: wallIds.get(wall.id),
      startNodeId: mapId(nodeIds, wall.startNodeId),
      endNodeId: mapId(nodeIds, wall.endNodeId),
      lengthMm: wall.lengthMm,
      thicknessMm: wall.thicknessMm,
      measurementSide: wall.measurementSide,
      measurementStartInsetMm: wall.measurementStartInsetMm || 0,
      measurementEndInsetMm: wall.measurementEndInsetMm || 0
    })),
    openings: floor.openings.map((opening) => ({
      id: openingIds.get(opening.id),
      wallId: mapId(wallIds, opening.wallId),
      type: opening.type,
      centerOffsetMm: opening.centerOffsetMm,
      widthMm: opening.widthMm
    })),
    spaces: floor.spaces.map((space) => ({
      id: spaceIds.get(space.id),
      wallIds: space.wallIds.map((wallId) => mapId(wallIds, wallId)),
      closed: !!space.closed,
      wallFaceOverrides: Object.fromEntries(Object.entries(space.wallFaceOverrides || {}).map(([wallId, face]) => [
        mapId(wallIds, wallId),
        face
      ]))
    })),
    session: {
      state: floor.session.state,
      anchorNodeId: mapId(nodeIds, floor.session.anchorNodeId),
      selectedWallId: mapId(wallIds, floor.session.selectedWallId),
      selectedOpeningId: mapId(openingIds, floor.session.selectedOpeningId)
    }
  };
}

module.exports = { normalizeDraft };
