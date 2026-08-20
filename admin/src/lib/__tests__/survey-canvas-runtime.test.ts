import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createReadonlySurveyFloor,
  fitSurveyViewport,
} from '@/lib/survey-canvas-viewport';
import { RENDER_REVISION, createSurveyRenderScene, drawSurveyScene } from '@/lib/survey-canvas-runtime';

const require = createRequire(import.meta.url);
const adminRenderer = require('../survey-runtime/surveyCanvasRenderer.js');
const miniProgramRenderer = require('../../../../miniprogram/packages/surveying/utils/surveyCanvasRenderer.js');

const fixtureFloor = {
  id: 'floor-1',
  name: '一层',
  nodes: [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 2400, yMm: 0 },
    { id: 'c', xMm: 2400, yMm: 3200 },
    { id: 'd', xMm: 0, yMm: 3200 },
  ],
  walls: [
    { id: 'ab', startNodeId: 'a', endNodeId: 'b', thicknessMm: 200, lengthMm: 2400 },
    { id: 'bc', startNodeId: 'b', endNodeId: 'c', thicknessMm: 200, lengthMm: 3200 },
    { id: 'cd', startNodeId: 'c', endNodeId: 'd', thicknessMm: 200, lengthMm: 2400 },
    { id: 'da', startNodeId: 'd', endNodeId: 'a', thicknessMm: 200, lengthMm: 3200 },
  ],
  openings: [
    { id: 'door-1', wallId: 'ab', type: 'door', centerOffsetMm: 1200, widthMm: 900, openDirection: 'inside' },
  ],
  spaces: [
    { id: 'living', name: '客厅', wallIds: ['ab', 'bc', 'cd', 'da'], closed: true },
  ],
  session: {
    state: 'wallPreview',
    selectedWallId: 'ab',
    previewPoint: { xMm: 800, yMm: 0 },
  },
};

function createRecordingContext() {
  const calls: string[] = [];
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    setTransform: () => calls.push('setTransform'),
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    fillRect: () => calls.push('fillRect'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    fillText: () => calls.push('fillText'),
    strokeText: noop,
    arc: noop,
    quadraticCurveTo: noop,
    clip: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    clearRect: () => calls.push('clearRect'),
    measureText: (text: string) => ({ width: String(text).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
  };
  return { ctx, calls };
}

test('admin canvas runtime keeps the Mini Program renderer revision', async () => {
  const source = await readFile(
    resolve(process.cwd(), '..', 'miniprogram', 'packages', 'surveying', 'utils', 'surveyCanvasRenderer.js'),
    'utf8',
  );
  const match = source.match(/const RENDER_REVISION = '([^']+)'/);
  assert.ok(match);
  assert.equal(adminRenderer.RENDER_REVISION, match[1]);
  assert.equal(adminRenderer.RENDER_REVISION, miniProgramRenderer.RENDER_REVISION);
  assert.equal(RENDER_REVISION, adminRenderer.RENDER_REVISION);
});

test('readonly canvas scene draws committed walls without mutating the source graph', () => {
  const snapshot = JSON.stringify(fixtureFloor);
  const floor = createReadonlySurveyFloor(fixtureFloor);
  const viewport = fitSurveyViewport(floor.nodes, { width: 800, height: 600 });
  const scene = createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport,
    rect: { width: 800, height: 600 },
  });
  const recorder = createRecordingContext();
  drawSurveyScene(recorder.ctx, scene, { dpr: 1 });

  assert.equal(JSON.stringify(fixtureFloor), snapshot);
  assert.equal(floor.session.state, 'spaceClosed');
  assert.ok((scene.walls || []).length >= 4);
  assert.ok((scene.openings || []).length >= 1);
  assert.equal((scene.walls || []).some((wall: { selected?: boolean }) => wall.selected), false);
  assert.ok(!scene.previewWall);
  assert.ok(recorder.calls.includes('clearRect') || recorder.calls.includes('fillRect'));
});
