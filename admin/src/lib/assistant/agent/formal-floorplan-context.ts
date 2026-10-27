import { adaptSurveyGraphToRooms, parseFormalSurveyLayout } from '@/lib/survey-graph';

export const formalFloorplanContextProtocol = 'formal-recorded-dimensions-v1';
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Read only actual v4 records. Render bounds, coordinates and default heights
 * are not measured net dimensions; absent records never become zero values. */
export function formalFloorplanText(name: string, value: unknown, selection: { roomId?: string; floorId?: string } = {}): string | null {
  const layout = parseFormalSurveyLayout(value);
  if (!layout) return null;
  const selected = layout.surveyGraph.floors.flatMap(floor => {
    if (selection.floorId && floor.id !== selection.floorId) return [];
    const eligible = new Set(adaptSurveyGraphToRooms({ ...layout, surveyGraph: { ...layout.surveyGraph, activeFloorId: floor.id } }).map(room => room.id));
    return (floor.spaces || []).filter(space => eligible.has(space.id) && (!selection.roomId || space.id === selection.roomId))
      .map(space => ({ floor, space }));
  });
  if (selection.roomId && selected.length !== 1) return null;
  const lines = [`正式v4户型「${name}」，以下只读图内原有记录。`];
  for (const { floor, space } of selected.slice(0, 6)) {
    const wallIds = new Set(space.wallIds || []);
    const walls = (floor.walls || []).filter(wall => wallIds.has(wall.id));
    const lengths = walls.filter(wall => positive(wall.lengthMm));
    lines.push(`${floor.name || '楼层'} / ${space.name || '未命名房间'}：`
      + (lengths.length ? `图内墙边记录：${lengths.slice(0, 12).map(wall => wall.lengthMm + '毫米').join('、')}。` : '未提供可直接引用的墙边长度记录。'));
    if (lengths.length < walls.length) lines.push('部分墙边没有可读长度，不能从坐标或照片补成实测值。');
    if (lengths.length > 12) lines.push('其余墙边记录未在本次展开，不能将本段当作完整尺寸表。');
    if (positive(floor.ceilingHeightMm)) lines.push(`本层图内层高记录：${floor.ceilingHeightMm}毫米。`);
    const openings = (floor.openings || []).filter(opening => wallIds.has(opening.wallId));
    for (const opening of openings.slice(0, 6)) {
      const dimensions = [positive(opening.widthMm) ? `宽${opening.widthMm}毫米` : '',
        positive(opening.heightMm) ? `高${opening.heightMm}毫米` : '',
        positive(opening.sillHeightMm) ? `窗台高${opening.sillHeightMm}毫米` : ''].filter(Boolean);
      lines.push(`图内${opening.type === 'window' ? '窗' : '门'}记录：${dimensions.join('、') || '未提供可直接引用的尺寸'}。`);
    }
    if (!openings.length) lines.push('本次图内未提供门窗尺寸记录，不等于现场没有门窗。');
    if (openings.length > 6) lines.push('其余门窗记录未在本次展开。');
  }
  if (selected.length > 6) lines.push('其余房间未在本次展开，须明确房间再查询。');
  lines.push('图内墙边不等于房间净尺寸、柜体可用长度或点位图，不将两条边拼成矩形尺寸；照片与具体墙边尚未建立对应。'
    + '这些记录不证明现场复核、隐蔽水电或安装条件；没有的门窗、管线和设备尺寸仍待核对。');
  return lines.join('\n');
}
