import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMiniAiFloorPlanControlSvg,
  renderMiniAiFloorPlanControlPng,
  resolveMiniAiFloorPlanTarget,
} from '@/lib/ai/mini-ai-floorplan';
import { buildSurveyFloorPlanNavigator } from '@/lib/survey-graph';

const layout = {
  version: 4 as const,
  measurementMode: 'surveying' as const,
  surveyGraph: {
    kind: 'survey-wall-graph' as const,
    activeFloorId: 'floor-1',
    floors: [{
      id: 'floor-1',
      name: '一层',
      ceilingHeightMm: 2800,
      nodes: [
        { id: 'n1', xMm: 0, yMm: 0 },
        { id: 'n2', xMm: 4000, yMm: 0 },
        { id: 'n3', xMm: 4000, yMm: 3000 },
        { id: 'n4', xMm: 0, yMm: 3000 },
        { id: 'n5', xMm: 8000, yMm: 0 },
        { id: 'n6', xMm: 8000, yMm: 3000 },
      ],
      walls: [
        { id: 'w1', startNodeId: 'n1', endNodeId: 'n2' },
        { id: 'w2', startNodeId: 'n2', endNodeId: 'n3' },
        { id: 'w3', startNodeId: 'n3', endNodeId: 'n4' },
        { id: 'w4', startNodeId: 'n4', endNodeId: 'n1' },
        { id: 'w5', startNodeId: 'n2', endNodeId: 'n5' },
        { id: 'w6', startNodeId: 'n5', endNodeId: 'n6' },
        { id: 'w7', startNodeId: 'n6', endNodeId: 'n3' },
      ],
      openings: [],
      spaces: [
        { id: 'living', name: '客厅', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true },
        { id: 'bedroom', name: '卧室', wallIds: ['w5', 'w6', 'w7', 'w2'], closed: true },
        { id: 'draft', name: '未闭合空间', wallIds: ['w1'], closed: false },
      ],
    }],
  },
};

test('whole-floor-plan target contains every closed room without mutating the formal layout', () => {
  const before = JSON.stringify(layout);
  const target = resolveMiniAiFloorPlanTarget(layout, 'whole_floor_plan');
  assert.equal(target.targetScope, 'whole_floor_plan');
  assert.equal(target.targetLabel, '完整户型');
  assert.equal(target.roomCount, 2);
  assert.match(target.summary, /客厅/);
  assert.match(target.summary, /卧室/);
  assert.doesNotMatch(target.summary, /未闭合空间/);
  assert.equal(JSON.stringify(layout), before);
});

test('single-room target requires a closed room that belongs to the plan', () => {
  const target = resolveMiniAiFloorPlanTarget(layout, 'single_room', 'living');
  assert.equal(target.targetLabel, '客厅');
  assert.equal(target.roomCount, 1);
  assert.throws(() => resolveMiniAiFloorPlanTarget(layout, 'single_room'), /必须选择具体房间/);
  assert.throws(() => resolveMiniAiFloorPlanTarget(layout, 'single_room', 'missing'), /不属于该户型或尚未闭合/);
  assert.throws(() => resolveMiniAiFloorPlanTarget(layout, 'whole_floor_plan', 'living'), /不能同时指定房间/);
});

test('control image deduplicates shared walls and renders a stable PNG', async () => {
  const svg = createMiniAiFloorPlanControlSvg(layout);
  assert.equal((svg.match(/<line /g) || []).length, 7);
  const png = await renderMiniAiFloorPlanControlPng(layout);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1000);
});

test('floor-plan navigator derives normalized walls and room labels without exposing layout data', () => {
  const navigator = buildSurveyFloorPlanNavigator(layout);

  assert.ok(navigator);
  assert.equal(navigator.walls.length, 7);
  assert.deepEqual(navigator.rooms.map((room) => room.id), ['living', 'bedroom']);
  assert.ok(navigator.rooms.every((room) => room.left >= 0 && room.left <= 100));
  assert.ok(navigator.rooms.every((room) => room.centerX >= 0 && room.centerX <= 100));
  assert.ok(navigator.rooms.every((room) => room.polygon.length >= 3));
  assert.ok(Math.abs(navigator.aspectRatio - 8 / 3) < 0.01);
  const wallPoints = navigator.walls.flatMap((wall) => {
    const radians = wall.angle * Math.PI / 180;
    return [
      { x: wall.left, y: wall.top },
      {
        x: wall.left + Math.cos(radians) * wall.width,
        y: wall.top + Math.sin(radians) * wall.width,
      },
    ];
  });
  const renderedWidth = Math.max(...wallPoints.map((point) => point.x))
    - Math.min(...wallPoints.map((point) => point.x));
  const renderedHeight = Math.max(...wallPoints.map((point) => point.y))
    - Math.min(...wallPoints.map((point) => point.y));
  assert.ok(Math.abs(renderedWidth / renderedHeight - navigator.aspectRatio) < 0.01);
});

test('single-room control image contains only the selected closed room', async () => {
  const svg = createMiniAiFloorPlanControlSvg(layout, 1024, 'bedroom');
  assert.equal((svg.match(/<line /g) || []).length, 4);
  assert.throws(
    () => createMiniAiFloorPlanControlSvg(layout, 1024, 'missing'),
    /不属于该户型或尚未闭合/
  );
  const png = await renderMiniAiFloorPlanControlPng(layout, 1024, 'bedroom');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('single-room control image includes only openings on the selected room walls', () => {
  const layoutWithOpenings = structuredClone(layout);
  layoutWithOpenings.surveyGraph.floors[0].openings = [
    { id: 'living-door', wallId: 'w1', type: 'door', centerOffsetMm: 1000, widthMm: 900 },
    { id: 'bedroom-window', wallId: 'w6', type: 'window', centerOffsetMm: 1500, widthMm: 1200 },
  ];

  const svg = createMiniAiFloorPlanControlSvg(layoutWithOpenings, 1024, 'bedroom');
  assert.equal((svg.match(/<line /g) || []).length, 7);
});
