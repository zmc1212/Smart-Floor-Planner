import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formalFloorplanText } from '../agent/formal-floorplan-context';
import type { FormalSurveyLayout } from '@/lib/survey-graph';

function plan(): FormalSurveyLayout {
  return { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'f', floors: [{
    id: 'f', name: '一层', ceilingHeightMm: 2800,
    nodes: [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }, { id: 'c', xMm: 4000, yMm: 3000 }, { id: 'd', xMm: 0, yMm: 3000 }],
    walls: [{ id: 'ab', startNodeId: 'a', endNodeId: 'b', lengthMm: 4000 }, { id: 'bc', startNodeId: 'b', endNodeId: 'c', lengthMm: 3000 },
      { id: 'cd', startNodeId: 'c', endNodeId: 'd', lengthMm: 4000 }, { id: 'da', startNodeId: 'd', endNodeId: 'a', lengthMm: 3000 }],
    spaces: [{ id: 'k', name: '厨房', closed: true, wallIds: ['ab', 'bc', 'cd', 'da'] }],
    openings: [{ id: 'w', wallId: 'ab', type: 'window', widthMm: 1200, sillHeightMm: 900 }],
  }] } };
}

test('formal source includes stored wall and opening records without treating them as net dimensions or writing the graph', () => {
  const layout = plan(), before = structuredClone(layout), text = formalFloorplanText('测试正式户型', layout, { roomId: 'k', floorId: 'f' })!;
  for (const value of ['4000毫米、3000毫米、4000毫米、3000毫米', '层高记录：2800毫米', '窗记录：宽1200毫米、窗台高900毫米', '不等于房间净尺寸', '照片与具体墙边尚未建立对应']) assert.ok(text.includes(value));
  assert.deepEqual(layout, before);
});

test('missing lengths and height stay unknown despite coordinate spans and renderer defaults', () => {
  const layout = plan(), floor = layout.surveyGraph.floors[0];
  floor.walls!.forEach(wall => { delete wall.lengthMm; }); delete floor.ceilingHeightMm; floor.openings = [];
  const text = formalFloorplanText('测试正式户型', layout)!;
  assert.match(text, /未提供可直接引用的墙边长度记录/);
  for (const invented of ['4000', '3000', '2800', '高0']) assert.ok(!text.includes(invented));
  assert.match(text, /不等于现场没有门窗/);
  floor.walls![0].lengthMm = NaN; floor.walls![1].lengthMm = -3000;
  assert.ok(!formalFloorplanText('测试正式户型', layout)!.includes('NaN'));
});

test('invalid, mixed legacy, open-room and ambiguous-floor inputs never acquire another room dimensions', () => {
  const layout = plan();
  assert.equal(formalFloorplanText('x', { ...layout, rooms: [] }), null);
  assert.equal(formalFloorplanText('x', { version: 3 }), null);
  assert.equal(formalFloorplanText('x', layout, { roomId: 'foreign' }), null);
  const upper = structuredClone(layout.surveyGraph.floors[0]); upper.id = 'upper'; upper.name = '二层';
  layout.surveyGraph.floors.push(upper);
  assert.equal(formalFloorplanText('x', layout, { roomId: 'k' }), null);
  assert.match(formalFloorplanText('x', layout, { roomId: 'k', floorId: 'upper' })!, /二层/);
  upper.spaces![0].closed = false;
  assert.equal(formalFloorplanText('x', layout, { roomId: 'k', floorId: 'upper' }), null);
});
