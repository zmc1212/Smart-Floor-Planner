const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');
const cursorIndex = require('../packages/surveying/utils/surveyCursorPlacementIndex.js');

const editorScript = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.js'),
  'utf8'
);

function almostEqual(actual, expected, epsilon) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

function projectUnrotated(point, viewport, rect) {
  return {
    x: rect.width / 2 + viewport.offsetX + point.xMm * viewport.scale,
    y: rect.height / 2 + viewport.offsetY + point.yMm * viewport.scale
  };
}

function createClosedFloor() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, { xMm: 3000, yMm: 0 }),
    3000,
    'manual'
  );
  draft = surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, { xMm: 3000, yMm: 2000 }),
    2000,
    'manual'
  );
  draft = surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, { xMm: 0, yMm: 2000 }),
    3000,
    'manual'
  );
  draft = surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, { xMm: 0, yMm: 0 }),
    2000,
    'manual'
  );
  return surveyGraph.getActiveFloor(surveyGraph.confirmClosure(draft));
}

test('zero rotation projector matches the unrotated screen mapping', () => {
  const rect = { width: 390, height: 650 };
  const viewport = { scale: 0.04, offsetX: 18, offsetY: -42 };
  const point = { xMm: 2400, yMm: 1250 };
  const projected = surveyCanvasRenderer.projectSurveyPoint(point, viewport, rect);
  const expected = projectUnrotated(point, viewport, rect);
  almostEqual(projected.x, expected.x, 1e-9);
  almostEqual(projected.y, expected.y, 1e-9);
  assert.equal(surveyCanvasRenderer.resolveViewport(viewport).rotationRad, 0);
});

test('rotated project and unproject are inverses and leave millimetre coordinates unchanged', () => {
  const rect = { width: 400, height: 300 };
  const viewport = {
    scale: 0.05,
    offsetX: 36,
    offsetY: -24,
    rotationRad: Math.PI / 5
  };
  const point = { xMm: 1850, yMm: -640 };
  const screen = surveyCanvasRenderer.projectSurveyPoint(point, viewport, rect);
  const recovered = surveyCanvasRenderer.unprojectSurveyPoint(screen, viewport, rect);
  almostEqual(recovered.xMm, point.xMm, 1e-6);
  almostEqual(recovered.yMm, point.yMm, 1e-6);

  const persisted = surveyCanvasRenderer.persistSurveyViewport(viewport);
  assert.equal('rotationRad' in persisted, false);
  assert.equal(persisted.scale, viewport.scale);
  assert.equal(persisted.offsetX, viewport.offsetX);
  assert.equal(persisted.offsetY, viewport.offsetY);
});

test('rotation offset compensation keeps the screen-centre world point fixed', () => {
  const rect = { width: 400, height: 300 };
  const start = { scale: 0.05, offsetX: 40, offsetY: -28, rotationRad: 0 };
  const screenCenter = { x: rect.width / 2, y: rect.height / 2 };
  const worldBefore = surveyCanvasRenderer.unprojectSurveyPoint(screenCenter, start, rect);
  const rotated = surveyCanvasRenderer.compensateViewportOffsetForRotation(start, Math.PI / 6);
  const worldAfter = surveyCanvasRenderer.unprojectSurveyPoint(screenCenter, rotated, rect);
  almostEqual(worldAfter.xMm, worldBefore.xMm, 1e-6);
  almostEqual(worldAfter.yMm, worldBefore.yMm, 1e-6);
  assert.equal(rotated.rotationRad, Math.PI / 6);
});

test('pinch anchor offset with rotation keeps the millimetre point under the canvas point', () => {
  const rect = { width: 390, height: 650 };
  const rotationRad = -Math.PI / 7;
  const mmPoint = { xMm: 900, yMm: 1400 };
  const canvasPoint = { x: 210, y: 318 };
  const scale = 0.06;
  const offset = surveyCanvasRenderer.resolveViewportOffsetForAnchor(
    rect,
    canvasPoint,
    mmPoint,
    scale,
    rotationRad
  );
  const projected = surveyCanvasRenderer.projectSurveyPoint(
    mmPoint,
    { scale, offsetX: offset.offsetX, offsetY: offset.offsetY, rotationRad },
    rect
  );
  almostEqual(projected.x, canvasPoint.x, 1e-6);
  almostEqual(projected.y, canvasPoint.y, 1e-6);
});

test('viewport interaction transform with rotation matches a rebuilt scene', () => {
  const rect = { width: 390, height: 650 };
  const baseViewport = { scale: 0.03, offsetX: 23, offsetY: -108, rotationRad: Math.PI / 8 };
  const viewport = { scale: 0.045, offsetX: -34, offsetY: 72, rotationRad: -Math.PI / 10 };
  const pointMm = { xMm: 2750, yMm: 1600 };
  const basePoint = surveyCanvasRenderer.projectSurveyPoint(pointMm, baseViewport, rect);
  const targetPoint = surveyCanvasRenderer.projectSurveyPoint(pointMm, viewport, rect);
  const transform = surveyCanvasRenderer.resolveViewportInteractionTransform(
    baseViewport,
    viewport,
    rect
  );
  const transformed = surveyCanvasRenderer.projectInteractionPoint(basePoint, transform);
  almostEqual(transformed.x, targetPoint.x, 1e-6);
  almostEqual(transformed.y, targetPoint.y, 1e-6);
});

test('cursor placement unproject recovers millimetre outer points after view rotation', () => {
  const floor = createClosedFloor();
  const rect = { width: 1000, height: 800 };
  const baseViewport = { scale: 0.1, offsetX: 12, offsetY: -8 };
  const rotatedViewport = Object.assign({}, baseViewport, { rotationRad: Math.PI / 4 });
  const baseScene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: baseViewport,
    rect
  });
  const rotatedScene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: rotatedViewport,
    rect
  });
  const baseIndex = cursorIndex.createCursorPlacementIndex({ floor, scene: baseScene });
  const rotatedIndex = cursorIndex.createCursorPlacementIndex({ floor, scene: rotatedScene });
  assert.equal(baseIndex.complete, true);
  assert.equal(rotatedIndex.complete, true);
  assert.equal(rotatedIndex.walls.length, baseIndex.walls.length);
  baseIndex.walls.forEach((wall, index) => {
    const rotated = rotatedIndex.walls[index];
    almostEqual(rotated.outerStart.xMm, wall.outerStart.xMm, 0.6);
    almostEqual(rotated.outerStart.yMm, wall.outerStart.yMm, 0.6);
    almostEqual(rotated.outerEnd.xMm, wall.outerEnd.xMm, 0.6);
    almostEqual(rotated.outerEnd.yMm, wall.outerEnd.yMm, 0.6);
  });
});

test('updateViewport never persists rotationRad onto the floor draft', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.updateViewport(draft, {
    scale: 0.08,
    offsetX: 10,
    offsetY: -4,
    rotationRad: 0.4
  });
  const floor = surveyGraph.getActiveFloor(draft);
  assert.equal('rotationRad' in floor.viewport, false);
  assert.equal(floor.viewport.scale, 0.08);
  assert.equal(floor.viewport.offsetX, 10);
  assert.equal(floor.viewport.offsetY, -4);
});

test('editor viewport helpers merge page-level rotation and share the renderer projectors', () => {
  assert.match(editorScript, /this\.viewRotationDeg = 0/);
  assert.match(editorScript, /rotationRad:\s*\(rotationDeg \* Math\.PI\) \/ 180/);
  assert.match(editorScript, /surveyCanvasRenderer\.projectSurveyPoint/);
  assert.match(editorScript, /surveyCanvasRenderer\.unprojectSurveyPoint/);
  assert.match(editorScript, /surveyCanvasRenderer\.persistSurveyViewport/);
  assert.match(editorScript, /surveyCanvasRenderer\.resolveViewportOffsetForAnchor/);
});
