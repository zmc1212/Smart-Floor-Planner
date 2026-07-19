export const FORMAL_SURVEY_LAYOUT_VERSION = 4;
export const FORMAL_SURVEY_MEASUREMENT_MODE = 'surveying';
const FORMAL_SURVEY_LAYOUT_KEYS = ['version', 'measurementMode', 'surveyGraph'];

export type SurveyNode = { id: string; xMm: number; yMm: number };
export type SurveyWall = { id: string; startNodeId: string; endNodeId: string; lengthMm?: number; thicknessMm?: number };
export type SurveyOpening = { id: string; wallId: string; type: 'door' | 'window'; centerOffsetMm?: number; widthMm?: number; heightMm?: number; sillHeightMm?: number };
export type SurveySpace = { id: string; name?: string; wallIds?: string[]; closed?: boolean };
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
