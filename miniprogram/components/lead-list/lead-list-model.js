const surveyLayout = require('../../utils/surveyLayout.js');

const PREVIEW_WIDTH = 164;
const PREVIEW_HEIGHT = 128;
const PREVIEW_PADDING = 12;

function asPlan(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function getPlanId(plan) {
  return String((plan && plan._id) || '');
}

function pickLeadFloorPlan(lead) {
  const primary = asPlan(lead && lead.primaryFloorPlanId);
  if (primary) return primary;

  const plans = Array.isArray(lead && lead.floorPlanIds) ? lead.floorPlanIds : [];
  return plans.map(asPlan).find(Boolean) || null;
}

function createWallSegments(layoutData) {
  const floor = surveyLayout.getActiveFloor(layoutData);
  const nodes = Array.isArray(floor && floor.nodes) ? floor.nodes : [];
  const walls = Array.isArray(floor && floor.walls) ? floor.walls : [];
  if (!nodes.length || !walls.length) return [];

  const nodesById = Object.create(null);
  nodes.forEach((node) => {
    if (node && node.id) nodesById[node.id] = node;
  });

  const drawableWalls = walls.map((wall) => {
    const start = wall && nodesById[wall.startNodeId];
    const end = wall && nodesById[wall.endNodeId];
    return start && end ? { wall, start, end } : null;
  }).filter(Boolean);
  if (!drawableWalls.length) return [];

  const points = drawableWalls.flatMap(({ start, end }) => [start, end]);
  const xs = points.map((point) => Number(point.xMm) || 0);
  const ys = points.map((point) => Number(point.yMm) || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(
    (PREVIEW_WIDTH - PREVIEW_PADDING * 2) / spanX,
    (PREVIEW_HEIGHT - PREVIEW_PADDING * 2) / spanY
  );
  const contentWidth = spanX * scale;
  const contentHeight = spanY * scale;
  const offsetX = (PREVIEW_WIDTH - contentWidth) / 2;
  const offsetY = (PREVIEW_HEIGHT - contentHeight) / 2;

  return drawableWalls.slice(0, 80).map(({ wall, start, end }, index) => {
    const startX = offsetX + (Number(start.xMm) - minX) * scale;
    const startY = offsetY + (Number(start.yMm) - minY) * scale;
    const dx = (Number(end.xMm) - Number(start.xMm)) * scale;
    const dy = (Number(end.yMm) - Number(start.yMm)) * scale;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    return {
      id: wall.id || `wall-${index}`,
      style: [
        `left:${(startX / PREVIEW_WIDTH * 100).toFixed(2)}%`,
        `top:${(startY / PREVIEW_HEIGHT * 100).toFixed(2)}%`,
        `width:${(length / PREVIEW_WIDTH * 100).toFixed(2)}%`,
        `transform:rotate(${angle.toFixed(2)}deg)`
      ].join(';')
    };
  });
}

function getClosedSpaceCount(layoutData) {
  const floor = surveyLayout.getActiveFloor(layoutData);
  const spaces = Array.isArray(floor && floor.spaces) ? floor.spaces : [];
  return spaces.filter((space) => space && space.closed).length;
}

function buildFloorPlanPreview(lead) {
  const plan = pickLeadFloorPlan(lead);
  if (!plan) {
    return {
      type: 'empty',
      label: '暂无户型',
      planId: '',
      segments: [],
      layoutLabel: ''
    };
  }

  const segments = createWallSegments(plan.layoutData);
  const previewUrl = String((plan.externalSource && plan.externalSource.previewUrl) || '').trim();
  const spaceCount = getClosedSpaceCount(plan.layoutData);
  const layoutLabel = String((plan.externalSource && plan.externalSource.layoutLabel) || '').trim()
    || (spaceCount ? `${spaceCount}个空间` : '');

  return {
    type: previewUrl ? 'image' : (segments.length ? 'graph' : 'empty'),
    label: segments.length ? '户型预览' : '暂无预览',
    planId: getPlanId(plan),
    previewUrl,
    segments,
    layoutLabel
  };
}

module.exports = {
  pickLeadFloorPlan,
  createWallSegments,
  buildFloorPlanPreview
};
