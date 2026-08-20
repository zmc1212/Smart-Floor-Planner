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
type OpeningKind = 'window' | 'sliding-door' | 'double-door' | 'door';

const WALL_STROKE = '#ffffff';
const DOOR_STROKE = '#ffcc33';
const WINDOW_STROKE = '#66d9ff';
const LABEL_FONT = 'Microsoft YaHei, SimHei, Noto Sans SC, sans-serif';

function openingKind(opening: SurveyOpening): OpeningKind {
  if (opening.type === 'window') return 'window';
  if (opening.modelCategory === 'sliding-door') return 'sliding-door';
  if (opening.modelCategory === 'double-door') return 'double-door';
  return 'door';
}

function isRailOpening(kind: OpeningKind) {
  return kind === 'window' || kind === 'sliding-door';
}

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
    nx: -uy,
    ny: ux,
    width,
  };
}

function swingEnvelope(segment: NonNullable<ReturnType<typeof openingSegment>>, opening: SurveyOpening) {
  if (isRailOpening(openingKind(opening))) return [segment.start, segment.end];
  const { start, end, nx, ny, width } = segment;
  return [
    start,
    end,
    { x: start.x + nx * width, y: start.y + ny * width },
    { x: start.x - nx * width, y: start.y - ny * width },
    { x: end.x + nx * width, y: end.y + ny * width },
    { x: end.x - nx * width, y: end.y - ny * width },
  ];
}

export function createMiniAiFloorPlanControlSvg(layoutData: unknown, size = 1024, roomId?: string) {
  const layout = parseFormalSurveyLayout(layoutData);
  const floor = layout ? getActiveSurveyFloor(layout) : null;
  if (!floor) throw new Error('正式户型缺少可用楼层');
  const allClosedSpaces = (floor.spaces || []).filter((space) => space.closed);
  const closedSpaces = roomId
    ? allClosedSpaces.filter((space) => space.id === roomId)
    : allClosedSpaces;
  if (roomId && !closedSpaces.length) throw new Error('所选房间不属于该户型或尚未闭合');
  const wallIds = new Set(closedSpaces.flatMap((space) => space.wallIds || []));
  const walls = (floor.walls || []).filter((wall) => wallIds.has(wall.id));
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, { x: node.xMm, y: node.yMm }]));
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const openings = (floor.openings || []).flatMap((opening) => {
    if (!wallIds.has(opening.wallId)) return [];
    const wall = wallById.get(opening.wallId);
    const segment = wall ? openingSegment(opening, wall, nodes) : null;
    return segment ? [{ opening, kind: openingKind(opening), segment }] : [];
  });
  const points = [
    ...walls.flatMap((wall) => [nodes.get(wall.startNodeId), nodes.get(wall.endNodeId)]),
    ...openings.flatMap(({ opening, segment }) => swingEnvelope(segment, opening)),
  ].filter(Boolean) as Point[];
  if (!walls.length || !points.length) throw new Error('正式户型缺少闭合墙体');

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = 88;
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
  const pxLine = (start: Point, end: Point, stroke: string, width: number) =>
    `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;

  const wallLines = walls.map((wall) => {
    const start = nodes.get(wall.startNodeId);
    const end = nodes.get(wall.endNodeId);
    return start && end ? line(start, end, WALL_STROKE, 7) : '';
  }).join('');

  const doorLeaf = (hinge: Point, ux: number, uy: number, nx: number, ny: number, radius: number, stroke: string) => {
    const leaf = { x: hinge.x + nx * radius, y: hinge.y + ny * radius };
    const jamb = { x: hinge.x + ux * radius, y: hinge.y + uy * radius };
    const sweep = nx * uy - ny * ux >= 0 ? 1 : 0;
    return `<path data-kind="door-swing" d="M ${hinge.x.toFixed(2)} ${hinge.y.toFixed(2)} L ${leaf.x.toFixed(2)} ${leaf.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 ${sweep} ${jamb.x.toFixed(2)} ${jamb.y.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`;
  };

  const railOpening = (start: Point, end: Point, nx: number, ny: number, stroke: string, kind: OpeningKind) => {
    const inset = 7;
    const rails = [
      { x: nx * inset, y: ny * inset },
      { x: -nx * inset, y: -ny * inset },
    ].map((offset) => pxLine(
      { x: start.x + offset.x, y: start.y + offset.y },
      { x: end.x + offset.x, y: end.y + offset.y },
      stroke,
      3
    )).join('');
    const jambs = [start, end].map((point) => pxLine(
      { x: point.x + nx * inset, y: point.y + ny * inset },
      { x: point.x - nx * inset, y: point.y - ny * inset },
      stroke,
      3
    )).join('');
    return `<g data-kind="${kind}">${rails}${jambs}</g>`;
  };

  const openingMarkup = openings.map(({ opening, kind, segment }) => {
    const start = mapPoint(segment.start);
    const end = mapPoint(segment.end);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const erased = line(segment.start, segment.end, '#000000', 13);
    const stroke = kind === 'window' ? WINDOW_STROKE : DOOR_STROKE;
    const label = kind === 'window' ? '窗' : '门';
    const swing = opening.openDirection === 'outside' ? -1 : 1;
    const symbol = isRailOpening(kind)
      ? railOpening(start, end, nx, ny, stroke, kind)
      : kind === 'double-door'
        ? doorLeaf(start, ux, uy, nx * swing, ny * swing, length / 2, stroke)
          + doorLeaf(end, -ux, -uy, nx * swing, ny * swing, length / 2, stroke)
        : doorLeaf(start, ux, uy, nx * swing, ny * swing, length, stroke);
    const labelPoint = {
      x: (start.x + end.x) / 2 + nx * swing * 22,
      y: (start.y + end.y) / 2 + ny * swing * 22,
    };
    const text = `<text data-opening="${kind}" x="${labelPoint.x.toFixed(1)}" y="${labelPoint.y.toFixed(1)}" fill="${stroke}" font-size="20" font-family="${LABEL_FONT}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${label}</text>`;
    return `${erased}${symbol}${text}`;
  }).join('');

  const hasDoor = openings.some(({ kind }) => kind !== 'window');
  const hasWindow = openings.some(({ kind }) => kind === 'window');
  const legend = openings.length
    ? `<g data-legend="openings" font-family="${LABEL_FONT}" font-size="18" font-weight="700">
        ${hasDoor ? `<line x1="24" y1="28" x2="52" y2="28" stroke="${DOOR_STROKE}" stroke-width="4"/><text x="60" y="34" fill="${DOOR_STROKE}">门</text>` : ''}
        ${hasWindow ? `<line x1="${hasDoor ? 108 : 24}" y1="28" x2="${hasDoor ? 136 : 52}" y2="28" stroke="${WINDOW_STROKE}" stroke-width="4"/><text x="${hasDoor ? 144 : 60}" y="34" fill="${WINDOW_STROKE}">窗</text>` : ''}
      </g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#000000"/>${wallLines}${openingMarkup}${legend}</svg>`;
}

export async function renderMiniAiFloorPlanControlPng(layoutData: unknown, size = 1024, roomId?: string) {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(createMiniAiFloorPlanControlSvg(layoutData, size, roomId)))
    .png()
    .toBuffer();
}
