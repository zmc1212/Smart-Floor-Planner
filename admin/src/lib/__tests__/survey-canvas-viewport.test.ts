import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SURVEY_VIEWER_MAX_SCALE,
  SURVEY_VIEWER_MIN_SCALE,
  canvasPointToMm,
  createReadonlySurveyFloor,
  createReadonlySurveySession,
  fitSurveyViewport,
  panSurveyViewport,
  zoomSurveyViewport,
} from '@/lib/survey-canvas-viewport';

test('fitSurveyViewport centers the node bounds in the canvas without mutating nodes', () => {
  const nodes = [
    { xMm: 0, yMm: 0 },
    { xMm: 4000, yMm: 0 },
    { xMm: 4000, yMm: 2000 },
    { xMm: 0, yMm: 2000 },
  ];
  const snapshot = JSON.stringify(nodes);
  const viewport = fitSurveyViewport(nodes, { width: 800, height: 600 }, { x: 100, y: 100 });

  assert.equal(JSON.stringify(nodes), snapshot);
  assert.ok(viewport.scale > SURVEY_VIEWER_MIN_SCALE);
  assert.ok(viewport.scale < SURVEY_VIEWER_MAX_SCALE);
  assert.equal(viewport.offsetX, -2000 * viewport.scale);
  assert.equal(viewport.offsetY, -1000 * viewport.scale);

  const center = canvasPointToMm({ x: 400, y: 300 }, { width: 800, height: 600 }, viewport);
  assert.ok(Math.abs(center.xMm - 2000) < 0.001);
  assert.ok(Math.abs(center.yMm - 1000) < 0.001);
});

test('pan and zoom keep the pointer millimetre point stable and stay within editor scale limits', () => {
  const rect = { width: 800, height: 600 };
  const start = fitSurveyViewport(
    [{ xMm: 0, yMm: 0 }, { xMm: 3000, yMm: 2000 }],
    rect,
  );
  const panned = panSurveyViewport(start, 40, -20);
  assert.equal(panned.scale, start.scale);
  assert.equal(panned.offsetX, start.offsetX + 40);
  assert.equal(panned.offsetY, start.offsetY - 20);

  const pointer = { x: 220, y: 180 };
  const before = canvasPointToMm(pointer, rect, start);
  const zoomed = zoomSurveyViewport(start, rect, pointer, 1.5);
  const after = canvasPointToMm(pointer, rect, zoomed);
  assert.ok(Math.abs(after.xMm - before.xMm) < 0.001);
  assert.ok(Math.abs(after.yMm - before.yMm) < 0.001);
  assert.ok(zoomed.scale > start.scale);

  const clamped = zoomSurveyViewport(start, rect, pointer, 10000);
  assert.equal(clamped.scale, SURVEY_VIEWER_MAX_SCALE);
});

test('createReadonlySurveyFloor strips editor session so the viewer cannot keep a live preview', () => {
  const floor = {
    id: 'floor-1',
    nodes: [{ id: 'a', xMm: 0, yMm: 0 }],
    session: {
      state: 'wallPreview',
      selectedWallId: 'ab',
      previewPoint: { xMm: 100, yMm: 0 },
    },
  };
  const snapshot = JSON.stringify(floor);
  const readonlyFloor = createReadonlySurveyFloor(floor);

  assert.equal(JSON.stringify(floor), snapshot);
  assert.deepEqual(readonlyFloor.session, createReadonlySurveySession());
  assert.equal(readonlyFloor.session.state, 'spaceClosed');
  assert.equal('selectedWallId' in readonlyFloor.session, false);
});
