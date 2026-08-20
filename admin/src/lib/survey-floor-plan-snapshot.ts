import { existsSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { RENDER_REVISION, createSurveyRenderScene, drawSurveyScene } from '@/lib/survey-canvas-runtime';
import { createReadonlySurveyFloor, fitSurveyViewport } from '@/lib/survey-canvas-viewport';
import { getActiveSurveyFloor, parseFormalSurveyLayout } from '@/lib/survey-graph';

export const FLOOR_PLAN_SNAPSHOT_SIZE = 1024;

const CJK_FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\msyh.ttf',
  'C:\\Windows\\Fonts\\simhei.ttf',
  '/usr/share/fonts/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
];

let fontsRegistered = false;

function registerSnapshotFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  for (const fontPath of CJK_FONT_CANDIDATES) {
    if (!existsSync(fontPath)) continue;
    try {
      GlobalFonts.registerFromPath(fontPath, 'sans-serif');
      GlobalFonts.registerFromPath(fontPath, 'Microsoft YaHei');
      return;
    } catch {
      // Keep scanning remaining system fonts.
    }
  }
}

export function renderSurveyFloorPlanSnapshotPng(
  layoutData: unknown,
  size = FLOOR_PLAN_SNAPSHOT_SIZE,
) {
  const layout = parseFormalSurveyLayout(layoutData);
  const floor = layout ? getActiveSurveyFloor(layout) : null;
  if (!floor || !(floor.nodes || []).length || !(floor.walls || []).length) {
    throw new Error('户型缺少可绘制的正式量房数据');
  }

  registerSnapshotFonts();
  const width = Math.max(256, Math.trunc(Number(size) || FLOOR_PLAN_SNAPSHOT_SIZE));
  const canvas = createCanvas(width, width);
  const ctx = canvas.getContext('2d');
  const readonlyFloor = createReadonlySurveyFloor(floor);
  const rect = { width, height: width };
  const viewport = fitSurveyViewport(readonlyFloor.nodes, rect);
  const scene = createSurveyRenderScene({
    floor: readonlyFloor,
    session: readonlyFloor.session,
    viewport,
    rect,
  });
  drawSurveyScene(ctx, scene, { dpr: 1 });
  return canvas.toBuffer('image/png');
}

export function surveyCanvasRenderRevision() {
  return RENDER_REVISION;
}
