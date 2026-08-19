import assert from 'node:assert/strict';
import test from 'node:test';
import { Parser } from '@dxfjs/parser';
import {
  DxfExportError,
  DXF_LAYER_NAMES,
  generateFormalSurveyDxf,
  getFormalSurveyLayoutForDxf,
  safeDxfFileName,
} from '@/lib/dxf';

const layout = {
  version: 4 as const,
  measurementMode: 'surveying' as const,
  surveyGraph: {
    kind: 'survey-wall-graph' as const,
    activeFloorId: 'floor-1',
    floors: [
      {
        id: 'floor-1', name: '一层',
        nodes: [
          { id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 2400, yMm: 0 }, { id: 'c', xMm: 4800, yMm: 0 },
          { id: 'd', xMm: 4800, yMm: 3200 }, { id: 'e', xMm: 2400, yMm: 3200 }, { id: 'f', xMm: 0, yMm: 3200 },
        ],
        walls: [
          { id: 'ab', startNodeId: 'a', endNodeId: 'b', thicknessMm: 240 }, { id: 'bc', startNodeId: 'b', endNodeId: 'c', thicknessMm: 240 },
          { id: 'cd', startNodeId: 'c', endNodeId: 'd', thicknessMm: 200 }, { id: 'de', startNodeId: 'd', endNodeId: 'e', thicknessMm: 200 },
          { id: 'ef', startNodeId: 'e', endNodeId: 'f', thicknessMm: 200 }, { id: 'fa', startNodeId: 'f', endNodeId: 'a', thicknessMm: 200 },
          { id: 'be', startNodeId: 'b', endNodeId: 'e', thicknessMm: 180 },
        ],
        openings: [
          { id: 'door-1', wallId: 'ab', type: 'door' as const, centerOffsetMm: 1100, widthMm: 900, openDirection: 'inside' as const },
          { id: 'window-1', wallId: 'cd', type: 'window' as const, centerOffsetMm: 1500, widthMm: 1200 },
          { id: 'door-2', wallId: 'ef', type: 'door' as const, centerOffsetMm: 1100, widthMm: 1200, modelCategory: 'sliding-door' },
        ],
        spaces: [
          { id: 'living', name: '客厅', wallIds: ['ab', 'be', 'ef', 'fa'], closed: true },
          { id: 'dining', name: '餐厅', wallIds: ['bc', 'cd', 'de', 'be'], closed: true },
        ],
      },
      {
        id: 'floor-2', name: '二层',
        nodes: [
          { id: 'e', xMm: 0, yMm: 0 }, { id: 'f', xMm: 3600, yMm: 900 },
          { id: 'g', xMm: 2900, yMm: 3500 }, { id: 'h', xMm: -500, yMm: 2800 },
        ],
        walls: [
          { id: 'ef', startNodeId: 'e', endNodeId: 'f', thicknessMm: 180 },
          { id: 'fg', startNodeId: 'f', endNodeId: 'g', thicknessMm: 180 },
          { id: 'gh', startNodeId: 'g', endNodeId: 'h', thicknessMm: 180 },
          { id: 'he', startNodeId: 'h', endNodeId: 'e', thicknessMm: 180 },
        ],
        spaces: [{ id: 'bedroom', name: '卧室', wallIds: ['ef', 'fg', 'gh', 'he'], closed: true }],
      },
    ],
  },
};

test('formal DXF uses the open-source writer and is readable by a DXF parser', async () => {
  const dxf = generateFormalSurveyDxf(layout, 'completed');
  assert.match(dxf, /AC1021/);
  Object.values(DXF_LAYER_NAMES).forEach((layer) => assert.match(dxf, new RegExp(layer)));
  assert.match(dxf, /客厅/);
  assert.match(dxf, /一层/);
  assert.match(dxf, /二层/);
  assert.match(dxf, /LWPOLYLINE/);
  assert.match(dxf, /ARC/);
  assert.match(dxf, /DIMENSION/);

  const parsed = await new Parser().parse(dxf);
  assert.equal(parsed.header.$ACADVER, 'AC1021');
  assert.equal(parsed.header.$INSUNITS, 4);
  assert.ok(parsed.tables.layer.records.some((layer) => layer.name === DXF_LAYER_NAMES.walls));
  assert.ok(parsed.entities.lwPolylines.length > 0);
  assert.ok(parsed.entities.arcs.length > 0);
  assert.ok(parsed.entities.lines.length > 0);
});

test('formal DXF rejects non-completed and non-closed floor plans', () => {
  assert.throws(() => getFormalSurveyLayoutForDxf(layout, 'draft'), (error: unknown) => error instanceof DxfExportError && error.code === 'DXF_EXPORT_REQUIRES_COMPLETED');
  const withoutClosedSpace = structuredClone(layout);
  withoutClosedSpace.surveyGraph.floors[0].spaces = [{ id: 'open', name: '未闭合', wallIds: ['ab'], closed: false }];
  withoutClosedSpace.surveyGraph.floors[1].spaces = [];
  assert.throws(() => getFormalSurveyLayoutForDxf(withoutClosedSpace, 'completed'), (error: unknown) => error instanceof DxfExportError && error.code === 'DXF_EXPORT_REQUIRES_CLOSED_SPACE');
});

test('DXF download filename excludes unsafe path characters', () => {
  assert.equal(safeDxfFileName('户型: A/B', '42'), 'FloorPlan_户型_ A_B_42.dxf');
});
