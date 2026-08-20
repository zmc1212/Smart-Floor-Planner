import {
  DimensionType,
  DxfWriter,
  LWPolylineFlags,
  MTextAttachmentPoint,
  TextHorizontalAlignment,
  TextVerticalAlignment,
  Units,
  point2d,
  point3d,
  type DxfDimStyle,
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
import {
  addModelSpaceSheet,
  addNorthArrowBlock,
  estimateDimensionLaneGaps,
  estimateDimensionPadding,
  fitDrawingToSheet,
  getFixedSheetLayout,
  mapSheetPoint,
  DXF_DRAWING_TITLE,
  DXF_NORTH_BLOCK,
  DXF_SHEET_HEIGHT,
  DXF_SHEET_WIDTH,
  type DxfSheetMeta,
  type SheetFitTransform,
} from '@/lib/dxf-sheet';

export const DXF_EXPORT_STATUS = 'completed';
export { DXF_DRAWING_TITLE, DXF_NORTH_BLOCK };
export type FormalSurveyDxfSheet = DxfSheetMeta;
export const DXF_LAYER_NAMES = Object.freeze({
  walls: '墙',
  doors: '门',
  windows: '窗',
  dimensions: '尺寸标注',
  spaces: '空间名称',
  north: '指北针',
});
export const DXF_DIM_STYLE_NAMES = Object.freeze({
  inner: '标注线-内墙',
  outer: '标注线',
});
export const DXF_TEXT_STYLE_NAME = '黑体';
export const DXF_ISO_DASH_LINETYPE = 'ACAD_ISO03W100';
export const DXF_ARCH_TICK_BLOCK = '_ARCHTICK';
export const DXF_DOOR_BLOCK = 'DOOR';
const DXF_SHEET_LAYER = '0';
const DEFAULT_LAYER_LINEWEIGHT = -3;
const DEFAULT_CEILING_HEIGHT_MM = 2800;
const ROOM_LABEL_TEXT_HEIGHT = 120;
const DOOR_LEAF_THICKNESS_RATIO = 0.044;
const DOOR_JAMB_MM = 50;
const WINDOW_RAIL_INSETS = [0.2, 0.4, 0.6, 0.8];
// Rotated linear dim: type 0 + referenced-by-this (32) + user text position (128).
const ROTATED_DIMENSION_TYPE = DimensionType.Default | DimensionType.ReferencedByThis | 128;

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
type DimensionItem = {
  start: Point;
  end: Point;
  dimensionStart?: Point;
  dimensionEnd?: Point;
  extensionStart: Point;
  extensionEnd: Point;
  label: string | number;
  kind?: string;
};
type WallSolidInput = {
  id: string; start: Point; end: Point; outerStart: Point; outerEnd: Point; thickness: number; polygon: Point[];
};
type WallSolidPlan = { rings: Point[][]; segments: Array<{ start: Point; end: Point }> };
const MIN_WALL_EDGE_MM = 1;

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

function polygonAreaAbs(points: Point[]) {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twiceArea += point.x * next.y - next.x * point.y;
  });
  return Math.abs(twiceArea) / 2;
}

function polygonPerimeter(points: Point[]) {
  return points.reduce((sum, point, index) => sum + distance(point, points[(index + 1) % points.length]), 0);
}

function intersectInfiniteLines(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point) {
  const first = subtract(firstEnd, firstStart);
  const second = subtract(secondEnd, secondStart);
  const denominator = first.x * second.y - first.y * second.x;
  if (Math.abs(denominator) < 0.000001) return null;
  const amount = ((secondStart.x - firstStart.x) * second.y - (secondStart.y - firstStart.y) * second.x) / denominator;
  return add(firstStart, scale(first, amount));
}

function metersFromMm(value: number, digits = 2) {
  return (value / 1000).toFixed(digits);
}

function areaM2FromMm2(value: number) {
  return (value / 1_000_000).toFixed(2);
}

function modelSpaceBounds(dxf: DxfWriterType) {
  const box = dxf.modelSpace.boundingBox();
  return { minX: box.tl.x, maxY: box.tl.y, maxX: box.br.x, minY: box.br.y };
}

function nodeMap(floor: SurveyFloor) {
  // Canvas Y grows downward with +yMm; CAD Y grows upward. Negate so the DXF
  // matches the formal viewer / Mini Program on-screen orientation.
  return new Map((floor.nodes || []).flatMap((node) => node.id ? [[node.id, { ...node, xMm: numberOr(node.xMm), yMm: -numberOr(node.yMm) } as Node] as const] : []));
}

function spaceWallLoop(floor: SurveyFloor, space: SurveySpace, nodes: Map<string, Node>) {
  const walls = (space.wallIds || []).map((id) => (floor.walls || []).find((wall) => wall.id === id));
  if (walls.some((wall) => !wall) || walls.length < 3) return [] as Array<{ wall: SurveyWall; start: Point; end: Point }>;
  const first = walls[0]!;
  const trace = (reverse: boolean) => {
    const initial = reverse ? first.endNodeId : first.startNodeId; if (!initial) return [] as Array<{ wall: SurveyWall; start: Point; end: Point }>;
    let current = initial; const loop: Array<{ wall: SurveyWall; start: Point; end: Point }> = [];
    for (const wall of walls) {
      if (!wall) return [] as Array<{ wall: SurveyWall; start: Point; end: Point }>;
      const next = wall.startNodeId === current ? wall.endNodeId : wall.endNodeId === current ? wall.startNodeId : '';
      const startNode = nodes.get(current); const endNode = next ? nodes.get(next) : null;
      if (!next || !startNode || !endNode) return [] as Array<{ wall: SurveyWall; start: Point; end: Point }>;
      loop.push({ wall, start: { x: startNode.xMm, y: startNode.yMm }, end: { x: endNode.xMm, y: endNode.yMm } });
      current = next;
    }
    return current === initial ? loop : [];
  };
  const forward = trace(false); return forward.length ? forward : trace(true);
}

function spacePoints(floor: SurveyFloor, space: SurveySpace, nodes: Map<string, Node>) {
  return spaceWallLoop(floor, space, nodes).map((edge) => edge.start);
}

function spaceInnerPolygon(floor: SurveyFloor, space: SurveySpace, bodiesById: Map<string, WallBody>, nodes: Map<string, Node>) {
  const loop = spaceWallLoop(floor, space, nodes);
  const centroid = polygonCentroid(loop.map((edge) => edge.start));
  if (!centroid || loop.length < 3) return [] as Point[];
  const faces = loop.map(({ wall, start }) => {
    const body = bodiesById.get(wall.id); if (!body) return null;
    const override = space.wallFaceOverrides?.[wall.id];
    const topologyMid = scale(add(body.start, body.end), 0.5);
    const oppositeMid = scale(add(body.outerStart, body.outerEnd), 0.5);
    const usesOffset = override === 'offset' || (override !== 'topology' && distance(centroid, oppositeMid) < distance(centroid, topologyMid));
    let lineStart = usesOffset ? body.outerStart : body.start;
    let lineEnd = usesOffset ? body.outerEnd : body.end;
    if (distance(start, lineEnd) < distance(start, lineStart)) {
      const swapped = lineStart; lineStart = lineEnd; lineEnd = swapped;
    }
    return { lineStart, lineEnd, thickness: body.thickness };
  });
  if (faces.some((face) => !face)) return [] as Point[];
  return faces.map((current, index) => {
    const previous = faces[(index - 1 + faces.length) % faces.length]!;
    const hit = intersectInfiniteLines(previous.lineStart, previous.lineEnd, current!.lineStart, current!.lineEnd);
    const cornerLimit = Math.max(previous.thickness, current!.thickness, MIN_WALL_EDGE_MM) * 4;
    return hit && distance(hit, current!.lineStart) <= cornerLimit ? hit : current!.lineStart;
  });
}

function roomLabelValue(name: string, areaMm2: number, ceilingHeightMm: number, perimeterMm: number) {
  return `${name}\\P面积:${areaM2FromMm2(areaMm2)}㎡\\P高度:${metersFromMm(ceilingHeightMm)}m\\P周长:${metersFromMm(perimeterMm)}m`;
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

function applyMetricDimStyle(style: DxfDimStyle, textHeight: number, textStyleHandle: string, annotationScale = 1) {
  const scale = Math.max(0.05, annotationScale);
  style.DIMSCALE = 1;
  style.DIMASZ = 50 * scale;
  // Keep extension lines clear of wall faces (do not cover the floor plan).
  style.DIMEXO = 280 * scale;
  style.DIMEXE = 60 * scale;
  style.DIMDLE = 0;
  style.DIMTXT = textHeight * scale;
  style.DIMGAP = 10 * scale;
  style.DIMDEC = 0;
  style.DIMTDEC = 0;
  style.DIMTIH = 0;
  style.DIMTOH = 0;
  style.DIMTAD = 2;
  style.DIMZIN = 8;
  style.DIMCLRD = 193;
  style.DIMCLRE = 193;
  style.DIMCLRT = 193;
  style.DIMLUNIT = 2;
  style.DIMDSEP = 46;
  style.DIMBLK = DXF_ARCH_TICK_BLOCK;
  style.DIMTXSTY = textStyleHandle;
  style.DIMLWD = DEFAULT_LAYER_LINEWEIGHT;
  style.DIMLWE = DEFAULT_LAYER_LINEWEIGHT;
}

function addArchTickBlock(dxf: DxfWriterType) {
  const block = dxf.addBlock(DXF_ARCH_TICK_BLOCK);
  block.addLWPolyline(
    [{ point: point2d(-0.5, -0.5) }, { point: point2d(0.5, 0.5) }],
    { layerName: DXF_SHEET_LAYER, constantWidth: 0.15 },
  );
}

function addDoorBlock(dxf: DxfWriterType) {
  const block = dxf.addBlock(DXF_DOOR_BLOCK);
  const inherit = { layerName: DXF_SHEET_LAYER };
  const leaf = DOOR_LEAF_THICKNESS_RATIO;
  block.addLWPolyline(
    [
      { point: point2d(0, 0) },
      { point: point2d(leaf, 0) },
      { point: point2d(leaf, 1) },
      { point: point2d(0, 1) },
    ],
    { ...inherit, colorNumber: 3, flags: LWPolylineFlags.Closed },
  );
  // DXF arcs are always CCW. An open unit leaf along +Y is reached by a 0–90° swing.
  block.addArc(point3d(0, 0), 1, 0, 90, { ...inherit, colorNumber: 252, lineType: DXF_ISO_DASH_LINETYPE });
}

function createDxfWriter(annotationScale = 1) {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable('$MEASUREMENT', { 70: 1 });
  dxf.addLType(DXF_ISO_DASH_LINETYPE, 'ISO dash __ __ __ __ __ __ __ __ __ __ __ __ __', [12, -18]);
  const heiti = dxf.tables.addStyle(DXF_TEXT_STYLE_NAME);
  heiti.fontFileName = 'simhei.ttf';
  addArchTickBlock(dxf);
  addDoorBlock(dxf);
  addNorthArrowBlock(dxf, DXF_TEXT_STYLE_NAME);
  dxf.addLayer(DXF_LAYER_NAMES.walls, 7, 'Continuous');
  dxf.addLayer(DXF_LAYER_NAMES.doors, 3, 'Continuous');
  dxf.addLayer(DXF_LAYER_NAMES.windows, 3, 'Continuous');
  dxf.addLayer(DXF_LAYER_NAMES.dimensions, 193, 'Continuous');
  dxf.addLayer(DXF_LAYER_NAMES.spaces, 7, 'Continuous');
  dxf.addLayer(DXF_LAYER_NAMES.north, 251, 'Continuous');
  const sheetLayer = dxf.layer(DXF_SHEET_LAYER);
  if (sheetLayer) sheetLayer.colorNumber = 4;
  applyMetricDimStyle(dxf.addDimStyle(DXF_DIM_STYLE_NAMES.inner), 135, heiti.handle, annotationScale);
  applyMetricDimStyle(dxf.addDimStyle(DXF_DIM_STYLE_NAMES.outer), 180, heiti.handle, annotationScale);
  return dxf;
}

function stringifyFormalSurveyDxf(dxf: DxfWriterType) {
  const box = dxf.modelSpace.boundingBox();
  dxf.setVariable('$EXTMIN', { 10: box.tl.x, 20: box.br.y, 30: 0 });
  dxf.setVariable('$EXTMAX', { 10: box.br.x, 20: box.tl.y, 30: 0 });
  // The writer emits DIMBLK as both name (5) and pointer (342). Keep the AutoCAD
  // name and drop 342 so strict parsers that only accept handles in 342 stay valid.
  return dxf.stringify()
    .replaceAll('\n370\n0\n390\n0', `\n370\n${DEFAULT_LAYER_LINEWEIGHT}\n390\n0`)
    .replaceAll(/\n342\n[^\n]+\n/g, '\n');
}

function openingLayerName(opening: Opening) {
  return opening.type === 'window' ? DXF_LAYER_NAMES.windows : DXF_LAYER_NAMES.doors;
}

function remainingWallRanges(body: WallBody, openings: Opening[]) {
  const length = distance(body.start, body.end);
  const gaps = openings
    .map((opening) => localOpeningGeometry(body, opening))
    .filter((geometry): geometry is NonNullable<ReturnType<typeof localOpeningGeometry>> => !!geometry)
    .map((geometry) => ({ start: Math.max(0, geometry.center - geometry.width / 2), end: Math.min(length, geometry.center + geometry.width / 2) }))
    .sort((first, second) => first.start - second.start);
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  gaps.forEach((gap) => {
    if (gap.start > cursor) ranges.push({ start: cursor, end: gap.start });
    cursor = Math.max(cursor, gap.end);
  });
  if (cursor < length) ranges.push({ start: cursor, end: length });
  return ranges.filter((range) => range.end - range.start >= MIN_WALL_EDGE_MM);
}

function remnantWallSolidInput(body: WallBody, range: { start: number; end: number }, index: number): WallSolidInput {
  const start = add(body.start, scale(body.direction, range.start));
  const end = add(body.start, scale(body.direction, range.end));
  const outerStart = add(start, scale(body.normal, body.thickness));
  const outerEnd = add(end, scale(body.normal, body.thickness));
  return {
    id: `${body.wall.id}:${index}`,
    start,
    end,
    outerStart,
    outerEnd,
    thickness: body.thickness,
    polygon: [start, end, outerEnd, outerStart],
  };
}

function uncutWallSolidInputs(bodies: WallBody[]): WallSolidInput[] {
  return bodies.map((body) => remnantWallSolidInput(body, { start: 0, end: distance(body.start, body.end) }, 0));
}

function gappedWallSolidInputs(bodies: WallBody[], openings: Opening[]): WallSolidInput[] {
  return bodies.flatMap((body) => remainingWallRanges(body, openings.filter((opening) => opening.wallId === body.wall.id))
    .map((range, index) => remnantWallSolidInput(body, range, index)));
}

function wallSolidEdges(plan: WallSolidPlan) {
  if (plan.rings.length) {
    return plan.rings.flatMap((ring) => ring.map((point, index) => ({ start: point, end: ring[(index + 1) % ring.length] })));
  }
  return plan.segments;
}

function angleDeg(vector: Vec) {
  return Math.atan2(vector.y, vector.x) * 180 / Math.PI;
}

function addOpeningRails(
  dxf: DxfWriterType,
  body: WallBody,
  geometry: NonNullable<ReturnType<typeof localOpeningGeometry>>,
  layerName: string,
  insets: number[],
  localOffset: Vec,
  fit: SheetFitTransform,
) {
  insets.forEach((inset) => {
    const start = mapFloorPoint(add(geometry.start, scale(body.normal, body.thickness * inset)), localOffset, fit);
    const end = mapFloorPoint(add(geometry.end, scale(body.normal, body.thickness * inset)), localOffset, fit);
    dxf.addLine(point3d(start.x, start.y), point3d(end.x, end.y), { layerName });
  });
}

function addDoorJambs(
  dxf: DxfWriterType,
  body: WallBody,
  geometry: NonNullable<ReturnType<typeof localOpeningGeometry>>,
  layerName: string,
  localOffset: Vec,
  fit: SheetFitTransform,
) {
  const jamb = Math.min(DOOR_JAMB_MM, Math.max(20, geometry.width / 8));
  const closed = { layerName, flags: LWPolylineFlags.Closed };
  const rectangle = (origin: Point, along: Vec, through: Vec) => {
    const a = mapFloorPoint(origin, localOffset, fit);
    const b = mapFloorPoint(add(origin, along), localOffset, fit);
    const c = mapFloorPoint(add(add(origin, along), through), localOffset, fit);
    const d = mapFloorPoint(add(origin, through), localOffset, fit);
    dxf.addLWPolyline(
      [{ point: point2d(a.x, a.y) }, { point: point2d(b.x, b.y) }, { point: point2d(c.x, c.y) }, { point: point2d(d.x, d.y) }],
      closed,
    );
  };
  rectangle(geometry.start, scale(body.direction, jamb), scale(body.normal, body.thickness));
  rectangle(geometry.end, scale(body.direction, -jamb), scale(body.normal, body.thickness));
}

function insertDoorLeaf(
  dxf: DxfWriterType,
  hinge: Point,
  leafDir: Vec,
  swingDir: Vec,
  width: number,
  layerName: string,
  localOffset: Vec,
  fit: SheetFitTransform,
  mirrored = false,
) {
  const ccwPerp = { x: -leafDir.y, y: leafDir.x };
  const ySign = ccwPerp.x * swingDir.x + ccwPerp.y * swingDir.y >= 0 ? 1 : -1;
  const mapped = mapFloorPoint(hinge, localOffset, fit);
  const leafScale = width * fit.scale;
  dxf.addInsert(DXF_DOOR_BLOCK, point3d(mapped.x, mapped.y), {
    layerName,
    rotationAngle: angleDeg(leafDir),
    scaleFactor: { x: (mirrored ? -1 : 1) * leafScale, y: ySign * leafScale, z: 1 },
  });
}

function addOpeningSymbol(
  dxf: DxfWriterType,
  body: WallBody,
  opening: Opening,
  localOffset: Vec,
  fit: SheetFitTransform,
) {
  const geometry = localOpeningGeometry(body, opening); if (!geometry) return;
  const layerName = openingLayerName(opening);
  if (opening.type === 'window') {
    addOpeningRails(dxf, body, geometry, layerName, WINDOW_RAIL_INSETS, localOffset, fit);
    return;
  }
  if (opening.modelCategory === 'sliding-door') {
    addOpeningRails(dxf, body, geometry, layerName, [0.32, 0.68], localOffset, fit);
    return;
  }
  const opensOutside = opening.openDirection === 'outside';
  const swingDir = opensOutside ? body.normal : scale(body.normal, -1);
  const hingeStart = opensOutside ? geometry.outerStart : geometry.start;
  const hingeEnd = opensOutside ? geometry.outerEnd : geometry.end;
  const leafWidth = Math.max(100, geometry.width);
  if (opening.modelCategory === 'double-door') {
    const halfWidth = Math.max(100, geometry.width / 2);
    insertDoorLeaf(dxf, hingeStart, body.direction, swingDir, halfWidth, layerName, localOffset, fit);
    insertDoorLeaf(dxf, hingeEnd, body.direction, swingDir, halfWidth, layerName, localOffset, fit, true);
    addDoorJambs(dxf, body, geometry, layerName, localOffset, fit);
    return;
  }
  insertDoorLeaf(dxf, hingeStart, body.direction, swingDir, leafWidth, layerName, localOffset, fit);
  addDoorJambs(dxf, body, geometry, layerName, localOffset, fit);
}

function mapFloorPoint(point: Point, localOffset: Vec, fit: SheetFitTransform) {
  return mapSheetPoint(point.x + localOffset.x, point.y + localOffset.y, fit);
}

function addFloorWalls(dxf: DxfWriterType, bodies: WallBody[], openings: Opening[], localOffset: Vec, fit: SheetFitTransform) {
  const solidPlan = createWallSolidPlan({ walls: gappedWallSolidInputs(bodies, openings) }) as WallSolidPlan;
  wallSolidEdges(solidPlan).forEach((edge) => {
    const start = mapFloorPoint(edge.start, localOffset, fit);
    const end = mapFloorPoint(edge.end, localOffset, fit);
    if (distance(start, end) < MIN_WALL_EDGE_MM * fit.scale) return;
    dxf.addLine(point3d(start.x, start.y), point3d(end.x, end.y), { layerName: DXF_LAYER_NAMES.walls });
  });
}

function dimensionAxisAngle(start: Point, end: Point) {
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 0 : 90;
}

function dimensionStyleName(kind?: string) {
  return kind === 'building-overall' || kind === 'chain-total'
    ? DXF_DIM_STYLE_NAMES.outer
    : DXF_DIM_STYLE_NAMES.inner;
}

function addLinearFloorDimension(dxf: DxfWriterType, item: DimensionItem, localOffset: Vec, fit: SheetFitTransform) {
  const extensionStart = mapFloorPoint(item.extensionStart, localOffset, fit);
  const extensionEnd = mapFloorPoint(item.extensionEnd, localOffset, fit);
  const lineStart = mapFloorPoint(item.dimensionStart ?? item.start, localOffset, fit);
  const lineEnd = mapFloorPoint(item.dimensionEnd ?? item.end, localOffset, fit);
  const dimensionMid = { x: (lineStart.x + lineEnd.x) / 2, y: (lineStart.y + lineEnd.y) / 2 };
  const dimension = dxf.addLinearDim(point3d(extensionStart.x, extensionStart.y), point3d(extensionEnd.x, extensionEnd.y), {
    layerName: DXF_LAYER_NAMES.dimensions,
    styleName: dimensionStyleName(item.kind),
    angle: dimensionAxisAngle(lineStart, lineEnd),
    definitionPoint: point3d(lineStart.x, lineStart.y),
    middlePoint: point3d(dimensionMid.x, dimensionMid.y),
    rotation: 0,
    text: String(Math.round(Number(item.label))),
  });
  Object.assign(dimension, { dimensionType: ROTATED_DIMENSION_TYPE });
}

function addFloorDimensions(dxf: DxfWriterType, floor: SurveyFloor, bodies: WallBody[], localOffset: Vec, fit: SheetFitTransform) {
  const allPoints = bodies.flatMap((body) => [body.start, body.end, body.outerStart, body.outerEnd]); if (!allPoints.length) return;
  const floorBounds = bounds(allPoints); const drawingScale = Math.max(floorBounds.maxX - floorBounds.minX, floorBounds.maxY - floorBounds.minY);
  const { baseGap, laneGap } = estimateDimensionLaneGaps(drawingScale);
  const solidPlan = createWallSolidPlan({ walls: uncutWallSolidInputs(bodies) }) as WallSolidPlan;
  const dimensionItems = createClosedDimensionPlan({
    baseGap, laneGap, groupTolerance: Math.max(12, drawingScale * 0.002), measurementUnitsPerCoordinate: 1,
    walls: bodies.map((body) => ({ id: body.wall.id, start: body.start, end: body.end, coordinateLength: numberOr(body.wall.lengthMm, distance(body.start, body.end)), measurementLength: numberOr(body.wall.lengthMm, distance(body.start, body.end)), thickness: body.thickness, outerStart: body.outerStart, outerEnd: body.outerEnd })),
    spaces: (floor.spaces || []).filter((space) => space.closed), outerRings: solidPlan.rings || [],
    openings: ((floor.openings || []) as Opening[]).map((opening) => {
      const body = bodies.find((item) => item.wall.id === opening.wallId); const length = body ? distance(body.start, body.end) : 0; const width = Math.min(length, Math.max(0, numberOr(opening.widthMm)));
      const center = Math.max(width / 2, Math.min(length - width / 2, numberOr(opening.centerOffsetMm, length / 2)));
      return { id: opening.id, wallId: opening.wallId || '', type: opening.type || 'window', start: center - width / 2, end: center + width / 2 };
    }),
  }).items as DimensionItem[];
  dimensionItems.forEach((item) => addLinearFloorDimension(dxf, item, localOffset, fit));
}

function addFloorSpaceLabels(dxf: DxfWriterType, floor: SurveyFloor, bodies: WallBody[], localOffset: Vec, fit: SheetFitTransform) {
  const nodes = nodeMap(floor);
  const bodiesById = new Map(bodies.map((body) => [body.wall.id, body]));
  const ceilingHeightMm = Math.round(numberOr(floor.ceilingHeightMm, DEFAULT_CEILING_HEIGHT_MM) || DEFAULT_CEILING_HEIGHT_MM);
  const labelHeight = ROOM_LABEL_TEXT_HEIGHT * fit.scale;
  (floor.spaces || []).filter((space) => space.closed).forEach((space, index) => {
    const inner = spaceInnerPolygon(floor, space, bodiesById, nodes);
    const centroid = polygonCentroid(inner); if (!centroid || inner.length < 3) return;
    const mapped = mapFloorPoint(centroid, localOffset, fit);
    const label = dxf.addMText(
      point3d(mapped.x, mapped.y),
      labelHeight,
      roomLabelValue(space.name || `空间 ${index + 1}`, polygonAreaAbs(inner), ceilingHeightMm, polygonPerimeter(inner)),
      { layerName: DXF_LAYER_NAMES.spaces, attachmentPoint: MTextAttachmentPoint.MiddleCenter, width: 2200 * fit.scale },
    );
    label.textStyle = DXF_TEXT_STYLE_NAME;
  });
}

function addFloorToDxf(dxf: DxfWriterType, floor: SurveyFloor, localOffset: Vec, fit: SheetFitTransform) {
  const bodies = floorBodies(floor); if (!bodies.length) return null;
  addFloorWalls(dxf, bodies, (floor.openings || []) as Opening[], localOffset, fit);
  ((floor.openings || []) as Opening[]).forEach((opening) => {
    const body = bodies.find((item) => item.wall.id === opening.wallId);
    if (body) addOpeningSymbol(dxf, body, opening, localOffset, fit);
  });
  addFloorSpaceLabels(dxf, floor, bodies, localOffset, fit);
  addFloorDimensions(dxf, floor, bodies, localOffset, fit);
  const allPoints = bodies.flatMap((body) => [body.start, body.end, body.outerStart, body.outerEnd]);
  const floorBounds = bounds(allPoints);
  const titlePoint = mapFloorPoint({ x: floorBounds.minX, y: floorBounds.minY - 500 }, localOffset, fit);
  const floorTitle = dxf.addText(
    point3d(titlePoint.x, titlePoint.y),
    220 * fit.scale,
    floor.name || '楼层',
    { layerName: DXF_LAYER_NAMES.spaces, horizontalAlignment: TextHorizontalAlignment.Left, verticalAlignment: TextVerticalAlignment.Top },
  );
  floorTitle.textStyle = DXF_TEXT_STYLE_NAME;
  return { width: floorBounds.maxX - floorBounds.minX, minX: floorBounds.minX, minY: floorBounds.minY };
}

export function getFormalSurveyLayoutForDxf(layoutData: unknown, status?: string): FormalSurveyLayout {
  if (status !== DXF_EXPORT_STATUS) throw new DxfExportError('仅已完成量房可以导出 CAD', 409, 'DXF_EXPORT_REQUIRES_COMPLETED');
  const layout = parseFormalSurveyLayout(layoutData); if (!layout) throw new DxfExportError('户型不是正式 v4 量房图', 400, 'DXF_EXPORT_INVALID_LAYOUT');
  if (!layout.surveyGraph.floors.some((floor) => floor.spaces?.some((space) => space.closed))) throw new DxfExportError('户型至少需要一个闭合空间才能导出 CAD', 409, 'DXF_EXPORT_REQUIRES_CLOSED_SPACE');
  return layout;
}

function computeNormalizedDrawingBounds(layout: FormalSurveyLayout) {
  let cursorX = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const floor of layout.surveyGraph.floors) {
    const bodies = floorBodies(floor);
    if (!bodies.length) continue;
    const allPoints = bodies.flatMap((body) => [body.start, body.end, body.outerStart, body.outerEnd]);
    const floorBounds = bounds(allPoints);
    const offsetX = cursorX - floorBounds.minX;
    const offsetY = -floorBounds.minY;
    allPoints.forEach((point) => {
      const x = point.x + offsetX;
      const y = point.y + offsetY;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y - 500);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    cursorX += floorBounds.maxX - floorBounds.minX + 3000;
  }
  if (!Number.isFinite(minX)) return null;
  const width = maxX - minX;
  const height = maxY - minY;
  const pad = estimateDimensionPadding(width, height);
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

export function generateFormalSurveyDxf(layoutData: unknown, status?: string, sheet?: FormalSurveyDxfSheet) {
  const layout = getFormalSurveyLayoutForDxf(layoutData, status);
  const rawBounds = computeNormalizedDrawingBounds(layout);
  if (!rawBounds) throw new DxfExportError('户型没有可导出的墙体', 409, 'DXF_EXPORT_EMPTY');
  const sheetLayout = getFixedSheetLayout();
  const fit = fitDrawingToSheet(rawBounds, sheetLayout);
  const dxf = createDxfWriter(fit.scale);
  let cursorX = 0;
  let exportedFloors = 0;
  for (const floor of layout.surveyGraph.floors) {
    const bodies = floorBodies(floor);
    if (!bodies.length) continue;
    const allPoints = bodies.flatMap((body) => [body.start, body.end, body.outerStart, body.outerEnd]);
    const floorBounds = bounds(allPoints);
    const result = addFloorToDxf(dxf, floor, {
      x: cursorX - floorBounds.minX,
      y: -floorBounds.minY,
    }, fit);
    if (result) {
      cursorX += result.width + 3000;
      exportedFloors += 1;
    }
  }
  if (!exportedFloors) throw new DxfExportError('户型没有可导出的墙体', 409, 'DXF_EXPORT_EMPTY');
  addModelSpaceSheet(dxf, { minX: 0, minY: 0, maxX: DXF_SHEET_WIDTH, maxY: DXF_SHEET_HEIGHT }, {
    textStyleName: DXF_TEXT_STYLE_NAME,
    northLayerName: DXF_LAYER_NAMES.north,
    meta: sheet,
    plotScale: fit.plotScale,
    sheet: sheetLayout,
  });
  return stringifyFormalSurveyDxf(dxf);
}

export function safeDxfFileName(name: string | null | undefined) {
  const normalized = String(name || '户型')
    .replace(/[\\/:*?\"<>|\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || '户型';
  return /\.dxf$/i.test(normalized) ? normalized : `${normalized}.dxf`;
}

export function dxfContentDisposition(fileName: string | null | undefined, asciiFallbackId?: string) {
  const resolved = safeDxfFileName(fileName);
  const asciiFallback = `FloorPlan_${String(asciiFallbackId || 'export').replace(/[^A-Za-z0-9_-]+/g, '_') || 'export'}.dxf`;
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(resolved)}`;
}

/** Prefer RFC 5987 filename* from Content-Disposition, else quoted filename. */
export function fileNameFromContentDisposition(header: string | null | undefined, fallback: string) {
  const value = String(header || '');
  const utf = value.match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1].trim().replace(/^\"|\"$/g, ''));
    } catch {
      /* keep falling through */
    }
  }
  const quoted = value.match(/filename=\"([^\"]+)\"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = value.match(/filename=([^;]+)/i);
  if (plain?.[1]) return plain[1].trim().replace(/^\"|\"$/g, '');
  return fallback;
}
