import {
  adaptSurveyGraphToRooms,
  getActiveSurveyFloor,
  parseFormalSurveyLayout,
  type SurveyOpening,
  type SurveyWall,
} from '@/lib/survey-graph';

export type MiniAiTargetScope = 'whole_floor_plan' | 'single_room';

export type MiniAiFloorPlanTarget = {
  targetScope: MiniAiTargetScope;
  targetLabel: string;
  roomId?: string;
  summary: string;
  roomCount: number;
};

export function normalizeMiniAiTargetScope(
  targetScope: unknown,
  roomId?: string
): MiniAiTargetScope {
  if (targetScope === undefined || targetScope === null || targetScope === '') {
    return roomId ? 'single_room' : 'whole_floor_plan';
  }
  if (targetScope !== 'whole_floor_plan' && targetScope !== 'single_room') {
    throw new Error('不支持的户型设计范围');
  }
  return targetScope;
}

function describeRoom(room: ReturnType<typeof adaptSurveyGraphToRooms>[number]) {
  return `${room.name}, approximately ${(room.width / 10).toFixed(2)}m by ${(room.height / 10).toFixed(2)}m, ceiling height ${(room.height3D / 10).toFixed(2)}m, with ${room.openings.length} measured openings`;
}

export function resolveMiniAiFloorPlanTarget(
  layoutData: unknown,
  targetScopeInput: unknown,
  roomId?: string
): MiniAiFloorPlanTarget {
  const layout = parseFormalSurveyLayout(layoutData);
  if (!layout) throw new Error('所选户型不是正式量房数据');
  const rooms = adaptSurveyGraphToRooms(layout);
  if (!rooms.length) throw new Error('请选择包含正式闭合房间的户型');

  const targetScope = normalizeMiniAiTargetScope(targetScopeInput, roomId);
  if (targetScope === 'single_room') {
    if (!roomId) throw new Error('单房间设计必须选择具体房间');
    const room = rooms.find((item) => item.id === roomId);
    if (!room) throw new Error('所选房间不属于该户型或尚未闭合');
    return {
      targetScope,
      targetLabel: room.name,
      roomId: room.id,
      summary: `Measured room context: ${describeRoom(room)}.`,
      roomCount: 1,
    };
  }

  if (roomId) throw new Error('完整户型设计不能同时指定房间');
  return {
    targetScope,
    targetLabel: '完整户型',
    summary: `Measured whole-floor-plan context: ${rooms.length} closed rooms. Room list: ${rooms.map(describeRoom).join('; ')}.`,
    roomCount: rooms.length,
  };
}

type Point = { x: number; y: number };

function openingSegment(opening: SurveyOpening, wall: SurveyWall, nodes: Map<string, Point>) {
  const start = nodes.get(wall.startNodeId);
  const end = nodes.get(wall.endNodeId);
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const width = Math.min(Math.max(Number(opening.widthMm || 0), 100), length);
  const center = Math.min(Math.max(Number(opening.centerOffsetMm ?? length / 2), width / 2), length - width / 2);
  const ux = dx / length;
  const uy = dy / length;
  return {
    start: { x: start.x + ux * (center - width / 2), y: start.y + uy * (center - width / 2) },
    end: { x: start.x + ux * (center + width / 2), y: start.y + uy * (center + width / 2) },
    ux,
    uy,
    width,
  };
}

export function createMiniAiFloorPlanControlSvg(layoutData: unknown, size = 1024) {
  const layout = parseFormalSurveyLayout(layoutData);
  const floor = layout ? getActiveSurveyFloor(layout) : null;
  if (!floor) throw new Error('正式户型缺少可用楼层');
  const closedSpaces = (floor.spaces || []).filter((space) => space.closed);
  const wallIds = new Set(closedSpaces.flatMap((space) => space.wallIds || []));
  const walls = (floor.walls || []).filter((wall) => wallIds.has(wall.id));
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, { x: node.xMm, y: node.yMm }]));
  const points = walls.flatMap((wall) => [nodes.get(wall.startNodeId), nodes.get(wall.endNodeId)]).filter(Boolean) as Point[];
  if (!walls.length || !points.length) throw new Error('正式户型缺少闭合墙体');

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = 72;
  const scale = Math.min((size - padding * 2) / Math.max(maxX - minX, 1), (size - padding * 2) / Math.max(maxY - minY, 1));
  const mapPoint = (point: Point) => ({
    x: padding + (point.x - minX) * scale,
    y: padding + (point.y - minY) * scale,
  });
  const line = (start: Point, end: Point, stroke: string, width: number) => {
    const a = mapPoint(start);
    const b = mapPoint(end);
    return `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
  };

  const wallLines = walls.map((wall) => {
    const start = nodes.get(wall.startNodeId);
    const end = nodes.get(wall.endNodeId);
    return start && end ? line(start, end, '#ffffff', 7) : '';
  }).join('');

  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const openingLines = (floor.openings || []).filter((opening) => wallIds.has(opening.wallId)).map((opening) => {
    const wall = wallById.get(opening.wallId);
    const segment = wall ? openingSegment(opening, wall, nodes) : null;
    if (!segment) return '';
    const erased = line(segment.start, segment.end, '#000000', 13);
    if (opening.type === 'window') {
      const nx = -segment.uy * 8 / scale;
      const ny = segment.ux * 8 / scale;
      return `${erased}${line({ x: segment.start.x + nx, y: segment.start.y + ny }, { x: segment.end.x + nx, y: segment.end.y + ny }, '#ffffff', 3)}${line({ x: segment.start.x - nx, y: segment.start.y - ny }, { x: segment.end.x - nx, y: segment.end.y - ny }, '#ffffff', 3)}`;
    }
    const doorEnd = {
      x: segment.start.x - segment.uy * segment.width,
      y: segment.start.y + segment.ux * segment.width,
    };
    return `${erased}${line(segment.start, doorEnd, '#ffffff', 4)}`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#000000"/>${wallLines}${openingLines}</svg>`;
}

export async function renderMiniAiFloorPlanControlPng(layoutData: unknown, size = 1024) {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(createMiniAiFloorPlanControlSvg(layoutData, size)))
    .png()
    .toBuffer();
}
