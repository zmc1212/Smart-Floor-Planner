import {
  DxfWriter,
  MTextAttachmentPoint,
  TextHorizontalAlignment,
  TextVerticalAlignment,
  Units,
  point3d,
  type DxfWriter as DxfWriterType,
} from '@tarikjabiri/dxf';
import { createClosedDimensionPlan } from '@/lib/surveyDimensionPlan.js';
import { createWallSolidPlan } from '@/lib/surveyWallSolidPlan.js';
import {
  parseFormalSurveyLayout,
  type FormalSurveyLayout,
  type SurveyFloor,
  type SurveyNode,
  type SurveySpace,
  type SurveyWall,
} from '@/lib/survey-graph';

export const DXF_EXPORT_STATUS = 'completed';
export const DXF_LAYER_NAMES = Object.freeze({
  walls: 'SFP-WALLS', openings: 'SFP-OPENINGS', dimensions: 'SFP-DIMENSIONS', spaces: 'SFP-SPACES', floors: 'SFP-FLOORS',
});

export class DxfExportError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = 'DXF_EXPORT_INVALID') {
    super(message); this.name = 'DxfExportError'; this.status = status; this.code = code;
  }
}

type Point = { x: number; y: number };
type Vec = { x: number; y: number };
type Node = SurveyNode & { xMm: number; yMm: number };
type Opening = {
  id: string; wallId?: string; type?: 'door' | 'window'; centerOffsetMm?: number; widthMm?: number;
  openDirection?: 'inside' | 'outside'; modelCategory?: string;
};
type WallBody = {
  wall: SurveyWall; start: Point; end: Point; outerStart: Point; outerEnd: Point; direction: Vec; normal: Vec; thickness: number;
};
type DimensionItem = { start: Point; end: Point; extensionStart: Point; extensionEnd: Point; label: string | number };

function numberOr(value: unknown, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function distance(first: Point, second: Point) { return Math.hypot(second.x - first.x, second.y - first.y); }
function add(first: Point, second: Vec): Point { return { x: first.x + second.x, y: first.y + second.y }; }
function scale(vector: Vec, amount: number): Vec { return { x: vector.x * amount, y: vector.y * amount }; }
function subtract(first: Point, second: Point): Vec { return { x: first.x - second.x, y: first.y - second.y }; }
function normalize(vector: Vec): Vec { const length = Math.hypot(vector.x, vector.y); return length ? scale(vector, 1 / length) : { x: 1, y: 0 }; }

function polygonCentroid(points: Point[]) {
  if (points.length < 3) return null;
  let twiceArea = 0; let x = 0; let y = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]; const cross = point.x * next.y - next.x * point.y;
    twiceArea += cross; x += (point.x + next.x) * cross; y += (point.y + next.y) * cross;
  });
  return Math.abs(twiceArea) < 0.000001 ? null : { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

function nodeMap(floor: SurveyFloor) {
  return new Map((floor.nodes || []).flatMap((node) => node.id ? [[node.id, { ...node, xMm: numberOr(node.xMm), yMm: numberOr(node.yMm) } as Node] as const] : []));
}

function spacePoints(floor: SurveyFloor, space: SurveySpace, nodes: Map<string, Node>) {
  const walls = (space.wallIds || []).map((id) => (floor.walls || []).find((wall) => wall.id === id));
  if (walls.some((wall) => !wall) || walls.length < 3) return [] as Point[];
  const first = walls[0]!;
  const trace = (reverse: boolean) => {
    const initial = reverse ? first.endNodeId : first.startNodeId; if (!initial) return [] as Point[];
    let current = initial; const points: Point[] = [];
    for (const wall of walls) {
      if (!wall) return [] as Point[];
      const next = wall.startNodeId === current ? wall.endNodeId : wall.endNodeId === current ? wall.startNodeId : '';
      const point = nodes.get(current); if (!next || !point) return [] as Point[];
      points.push({ x: point.xMm, y: point.yMm }); current = next;
    }
    return current === initial ? points : [] as Point[];
  };
  const forward = trace(false); return forward.length ? forward : trace(true);
}

function wallEndpoints(wall: SurveyWall, nodes: Map<string, Node>) {
  const start = wall.startNodeId ? nodes.get(wall.startNodeId) : null; const end = wall.endNodeId ? nodes.get(wall.endNodeId) : null;
  return start && end ? { start, end } : null;
}

function getWallBody(floor: SurveyFloor, wall: SurveyWall, nodes: Map<string, Node>): WallBody | null {
  const endpoints = wallEndpoints(wall, nodes); if (!endpoints) return null;
  const start = { x: endpoints.start.xMm, y: endpoints.start.yMm }; const end = { x: endpoints.end.xMm, y: endpoints.end.yMm };
  const direction = normalize(subtract(end, start)); const leftNormal = { x: direction.y, y: -direction.x }; const rightNormal = scale(leftNormal, -1);
  const space = (floor.spaces || []).find((item) => item.closed && item.wallIds?.includes(wall.id));
  const centroid = space ? polygonCentroid(spacePoints(floor, space, nodes)) : null;
  const midpoint = scale({ x: start.x + end.x, y: start.y + end.y }, 0.5); const outward = centroid ? subtract(midpoint, centroid) : null;
  const normal = outward
    ? (leftNormal.x * outward.x + leftNormal.y * outward.y >= rightNormal.x * outward.x + rightNormal.y * outward.y ? leftNormal : rightNormal)
    : wall.measurementSide === 'right' ? rightNormal : leftNormal;
  const thickness = Math.max(80, numberOr(wall.thicknessMm, 200));
  return { wall, start, end, direction, normal, thickness, outerStart: add(start, scale(normal, thickness)), outerEnd: add(end, scale(normal, thickness)) };
}

function floorBodies(floor: SurveyFloor) {
  const nodes = nodeMap(floor); return (floor.walls || []).flatMap((wall) => { const body = getWallBody(floor, wall, nodes); return body ? [body] : []; });
}

function bounds(points: Point[]) {
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function localOpeningGeometry(body: WallBody, opening: Opening) {
  const length = distance(body.start, body.end); const width = Math.min(length, Math.max(80, numberOr(opening.widthMm, 0))); if (!width) return null;
  const center = Math.max(width / 2, Math.min(length - width / 2, numberOr(opening.centerOffsetMm, length / 2)));
  const start = add(body.start, scale(body.direction, center - width / 2)); const end = add(body.start, scale(body.direction, center + width / 2));
  return { start, end, outerStart: add(start, scale(body.normal, body.thickness)), outerEnd: add(end, scale(body.normal, body.thickness)), center, width };
}

function createDxfWriter() {
  const dxf = new DxfWriter(); dxf.setUnits(Units.Millimeters);
  dxf.addLayer(DXF_LAYER_NAMES.walls, 7, 'Continuous'); dxf.addLayer(DXF_LAYER_NAMES.openings, 5, 'Continuous');
  dxf.addLayer(DXF_LAYER_NAMES.dimensions, 2, 'Continuous'); dxf.addLayer(DXF_LAYER_NAMES.spaces, 3, 'Continuous'); dxf.addLayer(DXF_LAYER_NAMES.floors, 6, 'Continuous');
  return dxf;
}

function addPolyline(dxf: DxfWriterType, points: Point[], layerName: string, closed = true) {
  if (points.length < 2) return;
  dxf.addLWPolyline(points.map((point) => ({ point: { x: point.x, y: point.y } })), { layerName, flags: closed ? 1 : 0 });
}

function addOpeningSymbol(dxf: DxfWriterType, body: WallBody, opening: Opening) {
  const geometry = localOpeningGeometry(body, opening); if (!geometry) return;
  const { start, end, outerStart, outerEnd } = geometry; const options = { layerName: DXF_LAYER_NAMES.openings };
  dxf.addLine(point3d(start.x, start.y), point3d(outerStart.x, outerStart.y), options); dxf.addLine(point3d(end.x, end.y), point3d(outerEnd.x, outerEnd.y), options);
  if (opening.type === 'window') {
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; const rail = add(midpoint, scale(body.normal, body.thickness / 2));
    dxf.addLine(point3d(start.x, start.y), point3d(end.x, end.y), options);
    dxf.addLine(point3d(rail.x - body.direction.x * (geometry.width / 2), rail.y - body.direction.y * (geometry.width / 2)), point3d(rail.x + body.direction.x * (geometry.width / 2), rail.y + body.direction.y * (geometry.width / 2)), options);
    return;
  }
  if (opening.modelCategory === 'sliding-door') {
    const railA = add(start, scale(body.normal, body.thickness * 0.32));
    const railB = add(start, scale(body.normal, body.thickness * 0.68));
    dxf.addLine(point3d(railA.x, railA.y), point3d(railA.x + body.direction.x * geometry.width, railA.y + body.direction.y * geometry.width), options);
    dxf.addLine(point3d(railB.x, railB.y), point3d(railB.x + body.direction.x * geometry.width, railB.y + body.direction.y * geometry.width), options);
    return;
  }
  const opensOutside = opening.openDirection === 'outside'; const hinge = opensOutside ? end : start; const radius = Math.max(100, geometry.width);
  if (opening.modelCategory === 'double-door') {
    const halfWidth = Math.max(100, geometry.width / 2);
    [start, end].forEach((doubleHinge, index) => {
      const hingePoint = add(doubleHinge, scale(body.normal, opensOutside ? body.thickness : 0));
      const arcStart = Math.atan2(body.normal.y, body.normal.x) * 180 / Math.PI;
      const sweep = index === 0 ? (opensOutside ? 90 : -90) : (opensOutside ? -90 : 90);
      dxf.addArc(point3d(hingePoint.x, hingePoint.y), halfWidth, arcStart, arcStart + sweep, options);
      const leafEnd = add(hingePoint, scale(body.direction, index === 0 ? halfWidth : -halfWidth));
      dxf.addLine(point3d(hingePoint.x, hingePoint.y), point3d(leafEnd.x, leafEnd.y), options);
    });
    return;
  }
  const hingePoint = add(hinge, scale(body.normal, opensOutside ? body.thickness : 0)); const arcStart = Math.atan2(body.normal.y, body.normal.x) * 180 / Math.PI;
  dxf.addArc(point3d(hingePoint.x, hingePoint.y), radius, arcStart, arcStart + (opensOutside ? 90 : -90), options);
  dxf.addLine(point3d(hingePoint.x, hingePoint.y), point3d(opensOutside ? start.x : end.x, opensOutside ? start.y : end.y), options);
}

function addWallWithOpeningGaps(dxf: DxfWriterType, body: WallBody, openings: Opening[], offset: Vec) {
  const length = distance(body.start, body.end);
  const gaps = openings
    .map((opening) => localOpeningGeometry(body, opening))
    .filter((geometry): geometry is NonNullable<ReturnType<typeof localOpeningGeometry>> => !!geometry)
    .map((geometry) => ({ start: Math.max(0, geometry.center - geometry.width / 2), end: Math.min(length, geometry.center + geometry.width / 2) }))
    .sort((first, second) => first.start - second.start);
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  gaps.forEach((gap) => {
    if (gap.start > cursor) segments.push({ start: cursor, end: gap.start });
    cursor = Math.max(cursor, gap.end);
  });
  if (cursor < length) segments.push({ start: cursor, end: length });
  segments.forEach((segment) => {
    if (segment.end - segment.start < 1) return;
    const start = add(body.start, scale(body.direction, segment.start));
    const end = add(body.start, scale(body.direction, segment.end));
    addPolyline(dxf, [start, end, add(end, scale(body.normal, body.thickness)), add(start, scale(body.normal, body.thickness))].map((point) => add(point, offset)), DXF_LAYER_NAMES.walls);
  });
}

function addFloorDimensions(dxf: DxfWriterType, floor: SurveyFloor, bodies: WallBody[], offset: Vec) {
  const allPoints = bodies.flatMap((body) => [body.start, body.end, body.outerStart, body.outerEnd]); if (!allPoints.length) return;
  const floorBounds = bounds(allPoints); const drawingScale = Math.max(floorBounds.maxX - floorBounds.minX, floorBounds.maxY - floorBounds.minY);
  const dimensionOffset = Math.max(160, drawingScale * 0.035);
  const solidPlan = createWallSolidPlan({ walls: bodies.map((body) => ({ id: body.wall.id, start: body.start, end: body.end, outerStart: body.outerStart, outerEnd: body.outerEnd, thickness: body.thickness, polygon: [body.start, body.end, body.outerEnd, body.outerStart] })) }) as { rings: Point[][] };
  const dimensionItems = createClosedDimensionPlan({
    baseGap: dimensionOffset * 0.28, laneGap: Math.max(120, drawingScale / 40) * 1.45, groupTolerance: Math.max(12, drawingScale * 0.002), measurementUnitsPerCoordinate: 1,
    walls: bodies.map((body) => ({ id: body.wall.id, start: body.start, end: body.end, coordinateLength: numberOr(body.wall.lengthMm, distance(body.start, body.end)), measurementLength: numberOr(body.wall.lengthMm, distance(body.start, body.end)), thickness: body.thickness, outerStart: body.outerStart, outerEnd: body.outerEnd })),
    spaces: (floor.spaces || []).filter((space) => space.closed), outerRings: solidPlan.rings || [],
    openings: ((floor.openings || []) as Opening[]).map((opening) => {
      const body = bodies.find((item) => item.wall.id === opening.wallId); const length = body ? distance(body.start, body.end) : 0; const width = Math.min(length, Math.max(0, numberOr(opening.widthMm)));
      const center = Math.max(width / 2, Math.min(length - width / 2, numberOr(opening.centerOffsetMm, length / 2)));
      return { id: opening.id, wallId: opening.wallId || '', type: opening.type || 'window', start: center - width / 2, end: center + width / 2 };
    }),
  }).items as DimensionItem[];
  dimensionItems.forEach((item) => {
    const start = add(item.start, offset); const extensionStart = add(item.extensionStart, offset); const extensionEnd = add(item.extensionEnd, offset);
    dxf.addAlignedDim(point3d(extensionStart.x, extensionStart.y), point3d(extensionEnd.x, extensionEnd.y), { layerName: DXF_LAYER_NAMES.dimensions, insertionPoint: point3d(start.x, start.y), text: String(item.label) });
  });
}

function addFloorToDxf(dxf: DxfWriterType, floor: SurveyFloor, offset: Vec) {
  const bodies = floorBodies(floor); if (!bodies.length) return null;
  bodies.forEach((body) => addWallWithOpeningGaps(dxf, body, ((floor.openings || []) as Opening[]).filter((opening) => opening.wallId === body.wall.id), offset));
  ((floor.openings || []) as Opening[]).forEach((opening) => { const body = bodies.find((item) => item.wall.id === opening.wallId); if (body) addOpeningSymbol(dxf, { ...body, start: add(body.start, offset), end: add(body.end, offset), outerStart: add(body.outerStart, offset), outerEnd: add(body.outerEnd, offset) }, opening); });
  const nodes = nodeMap(floor);
  (floor.spaces || []).filter((space) => space.closed).forEach((space, index) => { const centroid = polygonCentroid(spacePoints(floor, space, nodes)); if (!centroid) return; dxf.addMText(point3d(centroid.x + offset.x, centroid.y + offset.y), 160, space.name || `空间 ${index + 1}`, { layerName: DXF_LAYER_NAMES.spaces, attachmentPoint: MTextAttachmentPoint.MiddleCenter }); });
  addFloorDimensions(dxf, floor, bodies, offset);
  const allPoints = bodies.flatMap((body) => [body.start, body.end, body.outerStart, body.outerEnd]); const floorBounds = bounds(allPoints);
  dxf.addText(point3d(floorBounds.minX + offset.x, floorBounds.minY + offset.y - 500), 220, floor.name || '楼层', { layerName: DXF_LAYER_NAMES.floors, horizontalAlignment: TextHorizontalAlignment.Left, verticalAlignment: TextVerticalAlignment.Top });
  return { width: floorBounds.maxX - floorBounds.minX, minX: floorBounds.minX, minY: floorBounds.minY };
}

export function getFormalSurveyLayoutForDxf(layoutData: unknown, status?: string): FormalSurveyLayout {
  if (status !== DXF_EXPORT_STATUS) throw new DxfExportError('仅已完成量房可以导出 CAD', 409, 'DXF_EXPORT_REQUIRES_COMPLETED');
  const layout = parseFormalSurveyLayout(layoutData); if (!layout) throw new DxfExportError('户型不是正式 v4 量房图', 400, 'DXF_EXPORT_INVALID_LAYOUT');
  if (!layout.surveyGraph.floors.some((floor) => floor.spaces?.some((space) => space.closed))) throw new DxfExportError('户型至少需要一个闭合空间才能导出 CAD', 409, 'DXF_EXPORT_REQUIRES_CLOSED_SPACE');
  return layout;
}

export function generateFormalSurveyDxf(layoutData: unknown, status?: string) {
  const layout = getFormalSurveyLayoutForDxf(layoutData, status); const dxf = createDxfWriter(); let cursorX = 0; let exportedFloors = 0;
  for (const floor of layout.surveyGraph.floors) {
    const bodies = floorBodies(floor); if (!bodies.length) continue; const allPoints = bodies.flatMap((body) => [body.start, body.end, body.outerStart, body.outerEnd]); const floorBounds = bounds(allPoints);
    const result = addFloorToDxf(dxf, floor, { x: cursorX - floorBounds.minX, y: -floorBounds.minY }); if (result) { cursorX += result.width + 3000; exportedFloors += 1; }
  }
  if (!exportedFloors) throw new DxfExportError('户型没有可导出的墙体', 409, 'DXF_EXPORT_EMPTY'); return dxf.stringify();
}

export function safeDxfFileName(name: string | null | undefined, id: string) {
  const normalized = String(name || 'FloorPlan').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || 'FloorPlan'; return `FloorPlan_${normalized}_${id}.dxf`;
}

export function dxfContentDisposition(name: string | null | undefined, id: string) {
  const fileName = safeDxfFileName(name, id);
  const asciiFallback = `FloorPlan_${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}.dxf`;
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
