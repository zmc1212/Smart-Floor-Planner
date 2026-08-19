export const FORMAL_SURVEY_LAYOUT_VERSION = 4;
export const FORMAL_SURVEY_MEASUREMENT_MODE = 'surveying';
const FORMAL_SURVEY_LAYOUT_KEYS = ['version', 'measurementMode', 'surveyGraph'];

export type SurveyNode = { id: string; xMm: number; yMm: number };
export type SurveyWall = {
  id: string;
  startNodeId: string;
  endNodeId: string;
  lengthMm?: number;
  thicknessMm?: number;
  measurementStartInsetMm?: number;
  measurementStartExtensionMm?: number;
  measurementEndInsetMm?: number;
  measurementSide?: 'left' | 'right';
  bodyNormalSide?: 'left' | 'right';
};
export type SurveyOpening = {
  id: string;
  wallId: string;
  type: 'door' | 'window';
  centerOffsetMm?: number;
  widthMm?: number;
  heightMm?: number;
  sillHeightMm?: number;
  openDirection?: 'inside' | 'outside';
  modelCategory?: string;
};
export type SurveySpace = {
  id: string;
  name?: string;
  wallIds?: string[];
  wallFaceOverrides?: Record<string, 'topology' | 'offset'>;
  closed?: boolean;
};
export type SurveyFloor = { id: string; name?: string; ceilingHeightMm?: number; nodes?: SurveyNode[]; walls?: SurveyWall[]; openings?: SurveyOpening[]; spaces?: SurveySpace[] };
export type SurveyGraph = { kind: 'survey-wall-graph'; activeFloorId?: string; floors: SurveyFloor[] };
export type FormalSurveyLayout = { version: 4; measurementMode: 'surveying'; surveyGraph: SurveyGraph };

export function parseFormalSurveyLayout(layoutData: unknown): FormalSurveyLayout | null {
  let parsed = layoutData;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (!Object.keys(parsed).every((key) => FORMAL_SURVEY_LAYOUT_KEYS.includes(key))) return null;
  const layout = parsed as Partial<FormalSurveyLayout>;
  if (layout.version !== FORMAL_SURVEY_LAYOUT_VERSION || layout.measurementMode !== FORMAL_SURVEY_MEASUREMENT_MODE) return null;
  if (!layout.surveyGraph || layout.surveyGraph.kind !== 'survey-wall-graph' || !Array.isArray(layout.surveyGraph.floors)) return null;
  return layout as FormalSurveyLayout;
}

export function isFormalSurveyLayout(layoutData: unknown): boolean {
  return !!parseFormalSurveyLayout(layoutData);
}

export function getActiveSurveyFloor(layout: FormalSurveyLayout): SurveyFloor | null {
  return layout.surveyGraph.floors.find((floor) => floor.id === layout.surveyGraph.activeFloorId) || layout.surveyGraph.floors[0] || null;
}

export type SurveyRenderRoom = { id: string; name: string; x: number; y: number; width: number; height: number; height3D: number; polygon: { x: number; y: number }[]; polygonClosed: boolean; openings: { id: string; type: 'DOOR' | 'WINDOW'; x: number; y: number; width: number; height: number; rotation: number }[] };

export type SurveyFloorPlanNavigator = {
  aspectRatio: number;
  walls: {
    id: string;
    left: number;
    top: number;
    width: number;
    angle: number;
  }[];
  rooms: {
    id: string;
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    polygon: { x: number; y: number }[];
  }[];
};

function roomPoints(floor: SurveyFloor, space: SurveySpace, nodes: Map<string, SurveyNode>) {
  const walls = (space.wallIds || []).map((id) => (floor.walls || []).find((wall) => wall.id === id)).filter(Boolean) as SurveyWall[];
  if (!walls.length) return [] as SurveyNode[];
  const first = walls[0];
  const start = nodes.get(first.startNodeId);
  const end = nodes.get(first.endNodeId);
  if (!start || !end) return [];
  const points = [start, end];
  let current = first.endNodeId;
  for (const wall of walls.slice(1)) {
    const next = wall.startNodeId === current ? nodes.get(wall.endNodeId) : nodes.get(wall.startNodeId);
    if (!next) return [];
    points.push(next);
    current = wall.startNodeId === current ? wall.endNodeId : wall.startNodeId;
  }
  if (points.length > 1 && points[0].id === points[points.length - 1].id) points.pop();
  return points;
}

export function adaptSurveyGraphToRooms(layoutData: unknown): SurveyRenderRoom[] {
  const layout = parseFormalSurveyLayout(layoutData);
  const floor = layout ? getActiveSurveyFloor(layout) : null;
  if (!floor) return [];
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
  const ceilingHeight = Number(floor.ceilingHeightMm || 2800) / 100;
  return (floor.spaces || []).filter((space) => space.closed).map((space, index) => {
    const points = roomPoints(floor, space, nodes);
    if (points.length < 3) return null;
    const minX = Math.min(...points.map((point) => point.xMm));
    const minY = Math.min(...points.map((point) => point.yMm));
    const maxX = Math.max(...points.map((point) => point.xMm));
    const maxY = Math.max(...points.map((point) => point.yMm));
    const wallIds = new Set(space.wallIds || []);
    const openings = (floor.openings || []).filter((opening) => wallIds.has(opening.wallId)).map((opening) => ({
      id: opening.id,
      type: opening.type === 'door' ? 'DOOR' as const : 'WINDOW' as const,
      x: minX / 100,
      y: minY / 100,
      width: Number(opening.widthMm || 0) / 100,
      height: Number(opening.heightMm || 0) / 100,
      rotation: 0
    }));
    return {
      id: space.id || `space-${index + 1}`,
      name: space.name || `空间 ${index + 1}`,
      x: minX / 100,
      y: minY / 100,
      width: Math.max(1, (maxX - minX) / 100),
      height: Math.max(1, (maxY - minY) / 100),
      height3D: ceilingHeight,
      polygon: points.map((point) => ({ x: (point.xMm - minX) / 100, y: (point.yMm - minY) / 100 })),
      polygonClosed: true,
      openings
    };
  }).filter((room): room is SurveyRenderRoom => !!room);
}

export function buildSurveyFloorPlanNavigator(layoutData: unknown): SurveyFloorPlanNavigator | null {
  const layout = parseFormalSurveyLayout(layoutData);
  const floor = layout ? getActiveSurveyFloor(layout) : null;
  const nodes = floor?.nodes || [];
  const walls = floor?.walls || [];
  if (!floor || !nodes.length || !walls.length) return null;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const drawableWalls = walls.map((wall) => {
    const start = nodeById.get(wall.startNodeId);
    const end = nodeById.get(wall.endNodeId);
    return start && end ? { wall, start, end } : null;
  }).filter((item): item is { wall: SurveyWall; start: SurveyNode; end: SurveyNode } => !!item);
  if (!drawableWalls.length) return null;

  const xs = nodes.map((node) => Number(node.xMm) || 0);
  const ys = nodes.map((node) => Number(node.yMm) || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const padding = 5;
  const available = 100 - padding * 2;
  const scale = available / Math.max(spanX, spanY);
  const fittedWidth = spanX * scale;
  const fittedHeight = spanY * scale;
  const offsetX = padding + (available - fittedWidth) / 2;
  const offsetY = padding + (available - fittedHeight) / 2;
  const normalizeX = (value: number) => offsetX + (value - minX) * scale;
  const normalizeY = (value: number) => offsetY + (value - minY) * scale;

  const navigatorWalls = drawableWalls.slice(0, 160).map(({ wall, start, end }, index) => {
    const left = normalizeX(start.xMm);
    const top = normalizeY(start.yMm);
    const endX = normalizeX(end.xMm);
    const endY = normalizeY(end.yMm);
    const dx = endX - left;
    const dy = endY - top;
    return {
      id: wall.id || `wall-${index}`,
      left,
      top,
      width: Math.sqrt(dx * dx + dy * dy),
      angle: Math.atan2(dy, dx) * 180 / Math.PI,
    };
  });

  const navigatorRooms = (floor.spaces || []).filter((space) => space.closed).map((space, index) => {
    const points = roomPoints(floor, space, nodeById);
    if (points.length < 3) return null;
    const normalizedPoints = points.map((point) => ({
      x: normalizeX(point.xMm),
      y: normalizeY(point.yMm),
    }));
    const roomMinX = Math.min(...normalizedPoints.map((point) => point.x));
    const roomMaxX = Math.max(...normalizedPoints.map((point) => point.x));
    const roomMinY = Math.min(...normalizedPoints.map((point) => point.y));
    const roomMaxY = Math.max(...normalizedPoints.map((point) => point.y));
    const roomWidth = Math.max(0.5, roomMaxX - roomMinX);
    const roomHeight = Math.max(0.5, roomMaxY - roomMinY);
    return {
      id: space.id || `space-${index + 1}`,
      name: space.name || `空间 ${index + 1}`,
      left: roomMinX,
      top: roomMinY,
      width: roomWidth,
      height: roomHeight,
      centerX: roomMinX + roomWidth / 2,
      centerY: roomMinY + roomHeight / 2,
      polygon: normalizedPoints.map((point) => ({
        x: ((point.x - roomMinX) / roomWidth) * 100,
        y: ((point.y - roomMinY) / roomHeight) * 100,
      })),
    };
  }).filter((room): room is SurveyFloorPlanNavigator['rooms'][number] => !!room);

  return {
    aspectRatio: spanX / spanY,
    walls: navigatorWalls,
    rooms: navigatorRooms,
  };
}
