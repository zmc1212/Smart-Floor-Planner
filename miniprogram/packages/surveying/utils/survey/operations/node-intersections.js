const { snapRoundSegments } = require('../geometry/snap-rounding.js');
const { getNode } = require('../core/graph-query.js');
const { nextId } = require('../core/runtime-id.js');
const { collectSessionReferences } = require('../core/session.js');
const { splitWallAtNodes } = require('./wall-split.js');
const { measurementCorrectionBudgetMm, MAX_MEASUREMENT_RESIDUAL_MM } = require('../domain/wall.js');

function reject(code, details) {
  const error = new Error('交点无法安全节点化，请调整墙体后重试');
  error.code = code;
  error.details = details;
  throw error;
}

// Composable transaction step. Unit-grid snap rounding never uses UI snap tolerances.
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
  const sourceById = new Map(sourceWalls.map(wall => [wall.id, wall]));
  const plan = snapRoundSegments(sourceWalls.map(wall => ({
    id: wall.id, start: getNode(floor, wall.startNodeId), end: getNode(floor, wall.endNodeId)
  })));
  if (plan.conflict) reject(plan.conflict.code, { wallIds: plan.conflict.wallIds });
  const cuts = new Map();
  const incidentWalls = new Map();
  plan.pixels.forEach(point => {
    const key = `${point.xMm},${point.yMm}`;
    if (!canonical.has(key)) {
      const node = { id: nextId('node'), ...point };
      canonical.set(key, node);
      floor.nodes.push(node);
    }
  });
  plan.paths.forEach(path => {
    path.points.forEach(point => {
      const nodeId = canonical.get(`${point.xMm},${point.yMm}`).id;
      if (!incidentWalls.has(nodeId)) incidentWalls.set(nodeId, []);
      incidentWalls.get(nodeId).push(sourceById.get(path.id));
    });
    if (path.points.length > 2) cuts.set(path.id, path.points.slice(1, -1)
      .map(point => canonical.get(`${point.xMm},${point.yMm}`).id));
  });
  const activeWall = sourceWalls[session.activeSpaceStartWallIndex];
  let totalGridAdjustmentMm = 0;
  cuts.forEach((ids, wallId) => {
    const source = sourceById.get(wallId);
    const sourceId = source.topologySourceWallId || source.id;
    const cutClearanceByNodeId = new Map(ids.map(id => [id, Math.max(0,
      ...incidentWalls.get(id).filter(wall => (wall.topologySourceWallId || wall.id) !== sourceId)
        .map(wall => Number(wall.thicknessMm) || 0))]));
    const result = splitWallAtNodes(floor, wallId, ids, { snapRounding: true, cutClearanceByNodeId });
    const replacements = result.segmentIds.map(id => floor.walls.find(wall => wall.id === id));
    // Raw readings are allocated by the shared splitter. Grid bending and
    // integer segment lengths can change their effective sum; record that in
    // the existing closure pair, but never grant an unbounded correction.
    const adjustmentMm = replacements.reduce((sum, wall) => sum + wall.lengthMm, 0) - source.lengthMm;
    totalGridAdjustmentMm += Math.abs(adjustmentMm);
    const budgetMm = measurementCorrectionBudgetMm(source.lengthMm);
    if (Math.abs(adjustmentMm) > budgetMm || totalGridAdjustmentMm > MAX_MEASUREMENT_RESIDUAL_MM) {
      reject('MEASUREMENT_ADJUSTMENT_BUDGET_EXCEEDED', { wallId, adjustmentMm, budgetMm, totalGridAdjustmentMm });
    }
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
