const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');
const snapEngine = require('../packages/surveying/utils/survey/snap/snap-engine.js');
const cursorIndex = require('../packages/surveying/utils/surveyCursorPlacementIndex.js');
const { buildVisualCases } = require('./helpers/surveyTopologyVisualCases.js');

function createRectangleFloor() {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 4000, yMm: 0 },
    { id: 'c', xMm: 4000, yMm: 3000 },
    { id: 'd', xMm: 0, yMm: 3000 }
  ];
  floor.walls = [
    { id: 'ab', startNodeId: 'a', endNodeId: 'b', lengthMm: 4000 },
    { id: 'bc', startNodeId: 'b', endNodeId: 'c', lengthMm: 3000 },
    { id: 'cd', startNodeId: 'c', endNodeId: 'd', lengthMm: 4000 },
    { id: 'da', startNodeId: 'd', endNodeId: 'a', lengthMm: 3000 }
  ].map((wall) => Object.assign(wall, {
    thicknessMm: 200,
    mode: 'straight',
    status: 'confirmed',
    measurementSide: 'left',
    bodyNormalSide: 'left'
  }));
  floor.spaces = [{
    id: 'room',
    name: '房间1',
    wallIds: ['ab', 'bc', 'cd', 'da'],
    closed: true
  }];
  return floor;
}

function createIndexFromRenderer(floor) {
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: { scale: 0.1, offsetX: 0, offsetY: 0 },
    rect: { width: 1000, height: 800 }
  });
  return cursorIndex.createCursorPlacementIndex({ floor, scene });
}

function comparableTarget(target) {
  if (!target) return null;
  return {
    type: target.type,
    pointMm: target.pointMm,
    nodeId: target.nodeId || '',
    wallId: target.wallId || '',
    snapLine: target.snapLine || '',
    axis: target.axis || '',
    referencePoint: target.referencePoint || null
  };
}

function project(point, viewport, rect) {
  return {
    x: rect.width / 2 + viewport.offsetX + point.xMm * viewport.scale,
    y: rect.height / 2 + viewport.offsetY + point.yMm * viewport.scale
  };
}

function createLargeLinearFixture(wallCount) {
  const floor = {
    nodes: [],
    walls: [],
    spaces: [],
    openings: []
  };
  const viewport = { scale: 0.05, offsetX: 0, offsetY: 0 };
  const rect = { width: 1000, height: 800 };
  const scene = { viewport, rect, walls: [] };
  for (let index = 0; index < wallCount; index += 1) {
    const start = { id: `n-${index}-a`, xMm: index * 600, yMm: 0 };
    const end = { id: `n-${index}-b`, xMm: index * 600 + 500, yMm: 0 };
    const wall = {
      id: `w-${index}`,
      startNodeId: start.id,
      endNodeId: end.id,
      thicknessMm: 200,
      lengthMm: 500
    };
    const outerStart = { xMm: start.xMm, yMm: 200 };
    const outerEnd = { xMm: end.xMm, yMm: 200 };
    floor.nodes.push(start, end);
    floor.walls.push(wall);
    scene.walls.push({
      id: wall.id,
      topologyStart: start,
      topologyEnd: end,
      rawOuterStart: project(outerStart, viewport, rect),
      rawOuterEnd: project(outerEnd, viewport, rect),
      outerStart: project(outerStart, viewport, rect),
      outerEnd: project(outerEnd, viewport, rect)
    });
  }
  return {
    floor,
    index: cursorIndex.createCursorPlacementIndex({ floor, scene })
  };
}

test('cursor placement index preserves vertex, wall, outer-face, alignment and free targets', () => {
  const floor = createRectangleFloor();
  const index = createIndexFromRenderer(floor);
  const outer = surveyGraph.buildWallRenderGeometry(floor, floor.walls[0]);
  const points = [
    { xMm: 20, yMm: 15 },
    { xMm: 1800, yMm: 70 },
    outer.outerStart,
    {
      xMm: Math.round((outer.outerStart.xMm + outer.outerEnd.xMm) / 2),
      yMm: Math.round((outer.outerStart.yMm + outer.outerEnd.yMm) / 2)
    },
    { xMm: 6000, yMm: 100 },
    { xMm: 5200, yMm: 1200 }
  ];

  points.forEach((point) => {
    const legacy = surveyGraph.getCursorPlacementTarget(
      floor,
      point,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    const indexed = cursorIndex.resolveCursorPlacementTarget(
      index,
      point,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    assert.deepEqual(comparableTarget(indexed), comparableTarget(legacy), JSON.stringify(point));
  });
});

test('cursor placement index matches the topology visual matrix at every wall face and endpoint', () => {
  buildVisualCases().forEach((caseItem) => {
    const floor = surveyGraph.getActiveFloor(caseItem.draft);
    const index = cursorIndex.createCursorPlacementIndex({
      floor,
      scene: caseItem.scene
    });
    floor.walls.forEach((wall) => {
      const start = surveyGraph.getNode(floor, wall.startNodeId);
      const end = surveyGraph.getNode(floor, wall.endNodeId);
      const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
      const points = [
        start,
        end,
        { xMm: Math.round((start.xMm + end.xMm) / 2), yMm: Math.round((start.yMm + end.yMm) / 2) },
        geometry.outerStart,
        geometry.outerEnd,
        {
          xMm: Math.round((geometry.outerStart.xMm + geometry.outerEnd.xMm) / 2),
          yMm: Math.round((geometry.outerStart.yMm + geometry.outerEnd.yMm) / 2)
        }
      ];
      points.forEach((point) => {
        const legacy = surveyGraph.getCursorPlacementTarget(floor, point, 350);
        const indexed = cursorIndex.resolveCursorPlacementTarget(index, point, 350);
        assert.deepEqual(
          comparableTarget(indexed),
          comparableTarget(legacy),
          `${caseItem.name}:${wall.id}:${JSON.stringify(point)}`
        );
      });
    });
  });
});

test('wall and alignment locks slide continuously, upgrade at a higher-priority target, and release perpendicular', () => {
  const floor = createRectangleFloor();
  const index = createIndexFromRenderer(floor);
  const wallCandidate = cursorIndex.resolveCursorPlacementTarget(index, { xMm: 1000, yMm: 20 }, 350);
  assert.equal(wallCandidate.type, 'wall');

  const movedAlongWall = cursorIndex.resolveCursorPlacementLock(
    index,
    { xMm: 2800, yMm: 80 },
    wallCandidate,
    520
  );
  assert.equal(movedAlongWall.wallId, wallCandidate.wallId);
  assert.deepEqual(movedAlongWall.pointMm, { xMm: 2800, yMm: 0 });
  const upgradedAtEndpoint = cursorIndex.resolveCursorPlacementLock(
    index,
    { xMm: 70, yMm: 20 },
    movedAlongWall,
    520,
    160
  );
  assert.equal(upgradedAtEndpoint.type, 'vertex');
  assert.equal(upgradedAtEndpoint.nodeId, 'a');
  assert.equal(cursorIndex.resolveCursorPlacementLock(
    index,
    { xMm: 2800, yMm: 600 },
    wallCandidate,
    520
  ), null);

  const alignment = cursorIndex.resolveCursorPlacementTarget(index, { xMm: 6000, yMm: 100 }, 350);
  assert.equal(alignment.type, 'alignment');
  const movedAlongGuide = cursorIndex.resolveCursorPlacementLock(
    index,
    { xMm: 7200, yMm: 120 },
    alignment,
    520
  );
  assert.deepEqual(movedAlongGuide.pointMm, { xMm: 7200, yMm: 0 });
});

test('snap acquisition does not create a sticky point outside the 16px acquire radius', () => {
  const candidate = { type: 'vertex', pointMm: { xMm: 0, yMm: 0 } };
  const outsideAcquire = snapEngine.resolveSnap({
    scale: 0.05,
    rawPointMm: { xMm: 400, yMm: 0 },
    candidate
  });
  assert.equal(outsideAcquire.candidate, null);
  assert.equal(outsideAcquire.lock, null);

  const insideAcquire = snapEngine.resolveSnap({
    scale: 0.05,
    rawPointMm: { xMm: 300, yMm: 0 },
    candidate
  });
  assert.equal(insideAcquire.acquired, true);
});

test('large-wall cursor queries stay linear on the precomputed drag index', () => {
  const fixture = createLargeLinearFixture(500);
  assert.equal(fixture.index.complete, true);
  const startedAt = performance.now();
  for (let step = 0; step < 120; step += 1) {
    cursorIndex.resolveCursorPlacementTarget(
      fixture.index,
      { xMm: step * 1100 + 50, yMm: 70 + (step % 3) * 20 },
      520
    );
  }
  const elapsedMs = performance.now() - startedAt;
  assert.ok(elapsedMs < 250, `120 indexed queries over 500 walls took ${elapsedMs.toFixed(2)}ms`);
});
