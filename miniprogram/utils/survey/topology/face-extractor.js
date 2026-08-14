const polygon = require('../geometry/polygon.js');
const { createTopologyIndex } = require('./topology-index.js');

const MIN_FACE_AREA_MM2 = 1;

function canonicalCycle(values) {
  if (!values.length) return '';
  const rotations = values.map((_, index) => values.slice(index).concat(values.slice(0, index)).join('|'));
  return rotations.sort()[0];
}

function buildNodeComponents(index) {
  const componentByNodeId = new Map();
  let componentId = 0;
  index.nodesById.forEach((node) => {
    if (componentByNodeId.has(node.id)) return;
    componentId += 1;
    const pending = [node.id];
    componentByNodeId.set(node.id, componentId);
    while (pending.length) {
      const nodeId = pending.pop();
      (index.wallsByNodeId.get(nodeId) || []).forEach((wall) => {
        const otherId = wall.startNodeId === nodeId ? wall.endNodeId : wall.startNodeId;
        if (!componentByNodeId.has(otherId)) {
          componentByNodeId.set(otherId, componentId);
          pending.push(otherId);
        }
      });
    }
  });
  return componentByNodeId;
}

function findBridgeWallIds(index) {
  const discovery = new Map();
  const low = new Map();
  const bridges = new Set();
  let sequence = 0;
  const visit = (nodeId, parentWallId) => {
    sequence += 1;
    discovery.set(nodeId, sequence);
    low.set(nodeId, sequence);
    (index.wallsByNodeId.get(nodeId) || []).forEach((wall) => {
      if (wall.id === parentWallId) return;
      const otherId = wall.startNodeId === nodeId ? wall.endNodeId : wall.startNodeId;
      if (!discovery.has(otherId)) {
        visit(otherId, wall.id);
        low.set(nodeId, Math.min(low.get(nodeId), low.get(otherId)));
        if (low.get(otherId) > discovery.get(nodeId)) bridges.add(wall.id);
      } else {
        low.set(nodeId, Math.min(low.get(nodeId), discovery.get(otherId)));
      }
    });
  };
  index.nodesById.forEach((node) => {
    if (!discovery.has(node.id)) visit(node.id, '');
  });
  return bridges;
}

function extractFaces(floor) {
  const index = createTopologyIndex(floor);
  const componentByNodeId = buildNodeComponents(index);
  const bridgeWallIds = findBridgeWallIds(index);
  const outgoing = new Map();
  const halfEdges = [];
  (floor && floor.walls || []).forEach((wall) => {
    if (bridgeWallIds.has(wall.id)) return;
    const start = index.nodesById.get(wall.startNodeId);
    const end = index.nodesById.get(wall.endNodeId);
    if (!start || !end || start.id === end.id) return;
    const forward = { id: `${wall.id}:f`, wallId: wall.id, from: start.id, to: end.id };
    const reverse = { id: `${wall.id}:r`, wallId: wall.id, from: end.id, to: start.id };
    forward.twinId = reverse.id;
    reverse.twinId = forward.id;
    halfEdges.push(forward, reverse);
    [forward, reverse].forEach((edge) => {
      const values = outgoing.get(edge.from) || [];
      values.push(edge);
      outgoing.set(edge.from, values);
    });
  });
  outgoing.forEach((edges, nodeId) => {
    const origin = index.nodesById.get(nodeId);
    edges.sort((left, right) => {
      const leftNode = index.nodesById.get(left.to);
      const rightNode = index.nodesById.get(right.to);
      return Math.atan2(leftNode.yMm - origin.yMm, leftNode.xMm - origin.xMm) -
        Math.atan2(rightNode.yMm - origin.yMm, rightNode.xMm - origin.xMm);
    });
  });
  const edgesById = new Map(halfEdges.map((edge) => [edge.id, edge]));
  halfEdges.forEach((edge) => {
    const atTarget = outgoing.get(edge.to) || [];
    const twinIndex = atTarget.findIndex((candidate) => candidate.id === edge.twinId);
    edge.nextId = twinIndex < 0 || !atTarget.length
      ? ''
      : atTarget[(twinIndex - 1 + atTarget.length) % atTarget.length].id;
  });

  const visited = new Set();
  const faces = [];
  halfEdges.forEach((startEdge) => {
    if (visited.has(startEdge.id)) return;
    const edges = [];
    const local = new Set();
    let edge = startEdge;
    while (edge && !local.has(edge.id) && edges.length <= halfEdges.length) {
      local.add(edge.id);
      visited.add(edge.id);
      edges.push(edge);
      edge = edgesById.get(edge.nextId);
    }
    if (!edge || edge.id !== startEdge.id || edges.length < 3) return;
    const nodeIds = edges.map((item) => item.from);
    const points = nodeIds.map((nodeId) => index.nodesById.get(nodeId));
    const areaMm2 = polygon.signedArea(points);
    if (areaMm2 <= MIN_FACE_AREA_MM2) return;
    faces.push({
      id: `face-${faces.length + 1}`,
      componentId: componentByNodeId.get(nodeIds[0]) || 0,
      wallIds: edges.map((item) => item.wallId),
      nodeIds,
      points: points.map((point) => ({ xMm: Number(point.xMm), yMm: Number(point.yMm) })),
      areaMm2: Math.round(areaMm2),
      signature: canonicalCycle(edges.map((item) => item.wallId))
    });
  });
  const faceWallIds = new Set();
  faces.forEach((face) => face.wallIds.forEach((wallId) => faceWallIds.add(wallId)));
  const dangles = (floor && floor.walls || [])
    .filter((wall) => !faceWallIds.has(wall.id))
    .map((wall) => ({
      wallId: wall.id,
      nodeIds: [wall.startNodeId, wall.endNodeId],
      componentId: componentByNodeId.get(wall.startNodeId) || 0
    }));
  return { faces, dangles, index };
}

module.exports = { extractFaces };
