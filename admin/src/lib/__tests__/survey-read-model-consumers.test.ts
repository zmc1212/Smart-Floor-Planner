import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createSurveyRenderScene } from '@/lib/survey-canvas-runtime';
import { createReadonlySurveyFloor, fitSurveyViewport } from '@/lib/survey-canvas-viewport';
import { renderSurveyFloorPlanSnapshotPng } from '@/lib/survey-floor-plan-snapshot';
import { generateFormalSurveyDxf } from '@/lib/dxf';
import {
  adaptSurveyGraphToRooms,
  buildSurveyFloorPlanNavigator,
  type FormalSurveyLayout,
} from '@/lib/survey-graph';
import { createMiniAiFloorPlanControlSvg, resolveMiniAiFloorPlanTarget } from '@/lib/ai/mini-ai-floorplan';

const require = createRequire(import.meta.url);
const miniRenderer = require('../../../../miniprogram/packages/surveying/utils/surveyCanvasRenderer.js');
const baseline: { fixtures: Record<string, { draft: FormalSurveyLayout['surveyGraph'] }> } = require(
  '../../../../miniprogram/test/fixtures/survey-kernel-baseline/expected-behavior.json',
);

for (const [id, fixture] of Object.entries(baseline.fixtures)) {
  test(`Phase 3 consumers preserve the v4 graph and Mini/Admin scene parity: ${id}`, () => {
    const layout: FormalSurveyLayout = {
      version: 4,
      measurementMode: 'surveying',
      surveyGraph: structuredClone(fixture.draft),
    };
    const before = structuredClone(layout);
    const sourceFloor = layout.surveyGraph.floors[0];
    const floor = createReadonlySurveyFloor(sourceFloor);
    const floorBefore = structuredClone(floor);
    const rect = { width: 800, height: 600 };
    const viewport = fitSurveyViewport(floor.nodes, rect);
    const input = { floor, session: floor.session, rect, viewport };
    const scene = createSurveyRenderScene(input);
    assert.deepEqual(scene, miniRenderer.createSurveyRenderScene(input));
    assert.deepEqual(scene, createSurveyRenderScene(input));
    assert.deepEqual(floor, floorBefore, 'Canvas scene must not write its input floor');
    assert.deepEqual(layout, before, 'Canvas adaptation must not write layoutData');

    const rooms = adaptSurveyGraphToRooms(layout);
    const navigator = buildSurveyFloorPlanNavigator(layout);
    assert.deepEqual(rooms, adaptSurveyGraphToRooms(layout));
    assert.deepEqual(navigator, buildSurveyFloorPlanNavigator(layout));
    assert.deepEqual(layout, before, 'Room/3D/navigation read models must not write layoutData');

    if (sourceFloor.walls?.length) {
      const png = renderSurveyFloorPlanSnapshotPng(layout, 256);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    } else {
      assert.throws(() => renderSurveyFloorPlanSnapshotPng(layout, 256), /缺少可绘制/);
    }
    assert.deepEqual(layout, before, 'Preview generation must not write layoutData');

    if (sourceFloor.spaces?.some((space) => space.closed)) {
      assert.match(generateFormalSurveyDxf(layout, 'completed'), /ENTITIES/);
      assert.deepEqual(layout, before, 'DXF export must not write layoutData');
      assert.match(createMiniAiFloorPlanControlSvg(layout, 256), /<svg/);
      assert.equal(resolveMiniAiFloorPlanTarget(layout, 'whole_floor_plan').roomCount, rooms.length);
      for (const room of rooms) {
        assert.match(createMiniAiFloorPlanControlSvg(layout, 256, room.id), /<svg/);
        assert.equal(resolveMiniAiFloorPlanTarget(layout, 'single_room', room.id).roomId, room.id);
      }
    } else {
      assert.throws(() => generateFormalSurveyDxf(layout, 'completed'), /闭合空间/);
      assert.throws(() => createMiniAiFloorPlanControlSvg(layout, 256), /闭合墙体/);
      assert.throws(() => resolveMiniAiFloorPlanTarget(layout, 'whole_floor_plan'), /闭合房间/);
    }
    assert.deepEqual(layout, before, 'AI/export adapters must not persist a derived layout copy');
    assert.deepEqual(Object.keys(layout), ['version', 'measurementMode', 'surveyGraph']);
  });
}
