import { adaptSurveyGraphToRooms, parseFormalSurveyLayout } from '@/lib/survey-graph';

export const formalFloorplanContextProtocol = 'formal-recorded-dimensions-v1';
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export type FormalFloorplanOpening = {
  id: string;
  type: 'door' | 'window';
  widthMm: number | null;
  heightMm: number | null;
  sillHeightMm: number | null;
};
export type FormalFloorplanRoom = {
  id: string;
  name: string;
  floorName: string;
  ceilingHeightMm: number | null;
  walls: { id: string; lengthMm: number }[];
  openings: FormalFloorplanOpening[];
  wallCount: number;
  readableWallCount: number;
  openingCount: number;
  omittedWalls: number;
  omittedOpenings: number;
};
export type FormalFloorplanRecords = {
  name: string;
  rooms: FormalFloorplanRoom[];
  totalRooms: number;
  omittedRooms: number;
};

/** Read only actual v4 records. Render bounds, coordinates and default heights
 * are not measured net dimensions; absent records never become zero values. */
export function formalFloorplanRecords(
  name: string,
  value: unknown,
  selection: { roomId?: string; floorId?: string } = {}
): FormalFloorplanRecords | null {
  const layout = parseFormalSurveyLayout(value);
  if (!layout) return null;
  const selected = layout.surveyGraph.floors.flatMap(floor => {
    if (selection.floorId && floor.id !== selection.floorId) return [];
    const eligible = new Set(adaptSurveyGraphToRooms({ ...layout, surveyGraph: { ...layout.surveyGraph, activeFloorId: floor.id } }).map(room => room.id));
    return (floor.spaces || []).filter(space => eligible.has(space.id) && (!selection.roomId || space.id === selection.roomId))
      .map(space => ({ floor, space }));
  });
  if (selection.roomId && selected.length !== 1) return null;

  const rooms = selected.slice(0, 6).map(({ floor, space }, index) => {
    const wallIds = new Set(space.wallIds || []);
    const walls = (floor.walls || []).filter(wall => wallIds.has(wall.id));
    const readableWalls = walls.filter(wall => positive(wall.lengthMm));
    const displayWalls = readableWalls.slice(0, 12);
    const openings = (floor.openings || []).filter(opening => wallIds.has(opening.wallId));
    return {
      id: space.id || `space-${index + 1}`,
      name: space.name || '未命名房间',
      floorName: floor.name || '楼层',
      ceilingHeightMm: positive(floor.ceilingHeightMm) ? floor.ceilingHeightMm : null,
      walls: displayWalls.map(wall => ({ id: wall.id, lengthMm: wall.lengthMm as number })),
      openings: openings.slice(0, 6).map(opening => ({
        id: opening.id,
        type: opening.type === 'window' ? 'window' as const : 'door' as const,
        widthMm: positive(opening.widthMm) ? opening.widthMm : null,
        heightMm: positive(opening.heightMm) ? opening.heightMm : null,
        sillHeightMm: positive(opening.sillHeightMm) ? opening.sillHeightMm : null,
      })),
      wallCount: walls.length,
      readableWallCount: readableWalls.length,
      openingCount: openings.length,
      omittedWalls: Math.max(0, readableWalls.length - displayWalls.length),
      omittedOpenings: Math.max(0, openings.length - 6),
    };
  });

  return { name, rooms, totalRooms: selected.length, omittedRooms: Math.max(0, selected.length - 6) };
}

export function formalFloorplanText(name: string, value: unknown, selection: { roomId?: string; floorId?: string } = {}): string | null {
  const records = formalFloorplanRecords(name, value, selection);
  if (!records) return null;
  const lines = [`正式v4户型「${name}」，以下只读图内原有记录。`];
  for (const room of records.rooms) {
    lines.push(`${room.floorName} / ${room.name}：`
      + (room.walls.length ? `图内墙边记录：${room.walls.map(wall => wall.lengthMm + '毫米').join('、')}。` : '未提供可直接引用的墙边长度记录。'));
    if (room.readableWallCount < room.wallCount) lines.push('部分墙边没有可读长度，不能从坐标或照片补成实测值。');
    if (room.omittedWalls) lines.push('其余墙边记录未在本次展开，不能将本段当作完整尺寸表。');
    if (room.ceilingHeightMm) lines.push(`本层图内层高记录：${room.ceilingHeightMm}毫米。`);
    for (const opening of room.openings) {
      const dimensions = [opening.widthMm ? `宽${opening.widthMm}毫米` : '',
        opening.heightMm ? `高${opening.heightMm}毫米` : '',
        opening.sillHeightMm ? `窗台高${opening.sillHeightMm}毫米` : ''].filter(Boolean);
      lines.push(`图内${opening.type === 'window' ? '窗' : '门'}记录：${dimensions.join('、') || '未提供可直接引用的尺寸'}。`);
    }
    if (!room.openingCount) lines.push('本次图内未提供门窗尺寸记录，不等于现场没有门窗。');
    if (room.omittedOpenings) lines.push('其余门窗记录未在本次展开。');
  }
  if (records.omittedRooms) lines.push('其余房间未在本次展开，须明确房间再查询。');
  lines.push('图内墙边不等于房间净尺寸、柜体可用长度或点位图，不将两条边拼成矩形尺寸；照片与具体墙边尚未建立对应。'
    + '这些记录不证明现场复核、隐蔽水电或安装条件；没有的门窗、管线和设备尺寸仍待核对。');
  return lines.join('\n');
}
