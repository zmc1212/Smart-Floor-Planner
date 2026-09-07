const segment = require('../geometry/segment.js');
const { getNode } = require('../core/graph-query.js');
const { nextId } = require('../core/runtime-id.js');
const { collectSessionReferences } = require('../core/session.js');
const { splitWallAtNodes } = require('./wall-split.js');

function reject(code, details) {
  const error = new Error('交点无法安全节点化，请调整墙体后重试');
  error.code = code;
  error.details = details;
  throw error;
}

// Composable transaction step. Never uses UI snap tolerances or moves endpoints.
function nodeIntersections(floor) {
  const session = floor.session || {};
  const canonical = new Map();
  const aliases = new Map();
  floor.nodes.forEach(node => {
    const key = `${node.xMm},${node.yMm}`;
    if (!canonical.has(key)) canonical.set(key, node);
    aliases.set(node.id, canonical.get(key).id);
  });
  floor.walls.forEach(wall => {
    wall.startNodeId = aliases.get(wall.startNodeId) || wall.startNodeId;
    wall.endNodeId = aliases.get(wall.endNodeId) || wall.endNodeId;
  });
  collectSessionReferences(session, { includeTransient: true }).nodeIds.forEach(({ field, id }) => {
    session[field] = aliases.get(id) || id;
  });
  floor.nodes = floor.nodes.filter(node => aliases.get(node.id) === node.id);
  const sourceWalls = floor.walls.slice();
  const cuts = new Map();
  const addCut = (wall, node) => {
    if (wall.startNodeId === node.id || wall.endNodeId === node.id) return;
    if (!cuts.has(wall.id)) cuts.set(wall.id, new Set());
    cuts.get(wall.id).add(node.id);
  };
  for (let i = 0; i < sourceWalls.length; i += 1) {
    const a = sourceWalls[i];
    const a1 = getNode(floor, a.startNodeId);
    const a2 = getNode(floor, a.endNodeId);
    for (let j = i + 1; j < sourceWalls.length; j += 1) {
      const b = sourceWalls[j];
      const b1 = getNode(floor, b.startNodeId);
      const b2 = getNode(floor, b.endNodeId);
      const relation = segment.classifySegmentRelation(a1, a2, b1, b2);
      const details = { wallIds: [a.id, b.id] };
      if (relation.type === 'collinear-overlap') reject('OVERLAPPING_WALLS', details);
      if (relation.type === 'proper-intersection') {
        const point = segment.intersectLines(a1, a2, b1, b2);
        const quantized = { xMm: Math.round(point.xMm), yMm: Math.round(point.yMm) };
        // Fractional crossings require arrangement-wide snap rounding. Until that
        // exists, reject rather than bend independently rounded wall fragments.
        if (!segment.pointOnSegment(quantized, a1, a2, 1e-7) ||
            !segment.pointOnSegment(quantized, b1, b2, 1e-7)) {
          reject('UNSUPPORTED_INTERSECTION_PRECISION', { ...details, point });
        }
        const key = `${quantized.xMm},${quantized.yMm}`;
        let node = canonical.get(key);
        if (!node) {
          node = { id: nextId('node'), ...quantized };
          canonical.set(key, node);
          floor.nodes.push(node);
        }
        addCut(a, node);
        addCut(b, node);
      } else if (relation.type === 'endpoint-on-interior') {
        [a1, a2].filter(node => segment.pointOnSegmentInterior(node, b1, b2)).forEach(node => addCut(b, node));
        [b1, b2].filter(node => segment.pointOnSegmentInterior(node, a1, a2)).forEach(node => addCut(a, node));
      }
    }
  }
  const activeWall = sourceWalls[session.activeSpaceStartWallIndex];
  cuts.forEach((ids, wallId) => {
    const result = splitWallAtNodes(floor, wallId, [...ids]);
    const replacements = result.segmentIds.map(id => floor.walls.find(wall => wall.id === id));
    collectSessionReferences(session, { includeTransient: true }).wallIds.forEach(({ field, id }) => {
      if (id !== wallId || replacements.some(wall => wall.id === id)) return;
      const replacement = replacements.find(wall => wall.startNodeId === session.anchorNodeId || wall.endNodeId === session.anchorNodeId);
      session[field] = (replacement || replacements[0]).id;
    });
  });
  if (activeWall) {
    // Split retains the source ID on its first fragment.
    session.activeSpaceStartWallIndex = floor.walls.findIndex(wall => wall.id === activeWall.id);
  }
  return { splitCount: cuts.size };
}

module.exports = { nodeIntersections };
