import assert from 'node:assert/strict';
import test from 'node:test';
import { createMiniAiFloorPlanControlSvg } from '@/lib/ai/mini-ai-floorplan';
import {
  renderSurveyFloorPlanSnapshotPng,
  surveyCanvasRenderRevision,
} from '@/lib/survey-floor-plan-snapshot';
import { RENDER_REVISION } from '@/lib/survey-canvas-runtime';

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
      ],
      walls: [
        { id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 4000, thicknessMm: 200 },
        { id: 'w2', startNodeId: 'n2', endNodeId: 'n3', lengthMm: 3000, thicknessMm: 120 },
        { id: 'w3', startNodeId: 'n3', endNodeId: 'n4', lengthMm: 4000, thicknessMm: 120 },
        { id: 'w4', startNodeId: 'n4', endNodeId: 'n1', lengthMm: 3000, thicknessMm: 120 },
      ],
      openings: [
        { id: 'door-1', wallId: 'w1', type: 'door' as const, centerOffsetMm: 900, widthMm: 900, heightMm: 2100, openDirection: 'inside' as const },
        { id: 'window-1', wallId: 'w3', type: 'window' as const, centerOffsetMm: 2000, widthMm: 1800, heightMm: 1500, sillHeightMm: 900 },
      ],
      spaces: [{ id: 'living', name: '客厅', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true }],
    }],
  },
};

test('survey canvas snapshot exports a PNG that matches the Admin renderer revision', () => {
  const png = renderSurveyFloorPlanSnapshotPng(layout, 512);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 4000);
  assert.equal(surveyCanvasRenderRevision(), RENDER_REVISION);
});

test('survey canvas snapshot is not the black SVG control drawing', () => {
  const png = renderSurveyFloorPlanSnapshotPng(layout, 256);
  const svg = createMiniAiFloorPlanControlSvg(layout, 256);
  assert.ok(svg.includes('fill="#000000"'));
  assert.ok(png.length > 1000);
});
