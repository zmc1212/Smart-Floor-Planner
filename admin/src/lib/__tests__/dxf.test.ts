import assert from 'node:assert/strict';
import test from 'node:test';
import { Parser } from '@dxfjs/parser';
import {
  DxfExportError,
  DXF_ARCH_TICK_BLOCK,
  DXF_DIM_STYLE_NAMES,
  DXF_DOOR_BLOCK,
  DXF_DRAWING_TITLE,
  DXF_ISO_DASH_LINETYPE,
  DXF_LAYER_NAMES,
  DXF_NORTH_BLOCK,
  DXF_TEXT_STYLE_NAME,
  dxfContentDisposition,
  generateFormalSurveyDxf,
  getFormalSurveyLayoutForDxf,
  safeDxfFileName,
} from '@/lib/dxf';
import { buildFormalSurveyDxfSheet } from '@/lib/dxf-export-sheet';

function namedTableRecord(dxf: string, type: string, name: string) {
  return dxf.split(`0\n${type}`).slice(1).find((record) => record.includes(`\n2\n${name}\n`)) || '';
}

function dimensionRecords(dxf: string) {
  return dxf.split('0\nDIMENSION').slice(1).map((record) => record.match(/^[\s\S]*?(?=\n0\n[A-Z])/)?.[0] || record);
}

function lineCoversRange(
  line: { startX: number; startY: number; endX: number; endY: number },
  axis: 'x' | 'y',
  position: number,
  start: number,
  end: number,
  tolerance = 2,
) {
  const acrossStart = axis === 'x' ? line.startY : line.startX;
  const acrossEnd = axis === 'x' ? line.endY : line.endX;
  const alongStart = axis === 'x' ? line.startX : line.startY;
  const alongEnd = axis === 'x' ? line.endX : line.endY;
  if (Math.abs(acrossStart - position) > tolerance || Math.abs(acrossEnd - position) > tolerance) return false;
  const min = Math.min(alongStart, alongEnd);
  const max = Math.max(alongStart, alongEnd);
  return min <= start + tolerance && max >= end - tolerance;
}

function lineNearSegment(
  line: { startX: number; startY: number; endX: number; endY: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  tolerance = 8,
) {
  const matches = (first: { x: number; y: number }, second: { x: number; y: number }) => (
    Math.hypot(line.startX - first.x, line.startY - first.y) <= tolerance
    && Math.hypot(line.endX - second.x, line.endY - second.y) <= tolerance
  );
  return matches(start, end) || matches(end, start);
}

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
          { id: 'door-3', wallId: 'de', type: 'door' as const, centerOffsetMm: 1200, widthMm: 1600, modelCategory: 'double-door', openDirection: 'inside' as const },
        ],
        spaces: [
          { id: 'living', name: '客厅', wallIds: ['ab', 'be', 'ef', 'fa'], closed: true },
          { id: 'dining', name: '餐厅', wallIds: ['bc', 'cd', 'de', 'be'], closed: true },
        ],
      },
      {
        id: 'floor-2', name: '二层', ceilingHeightMm: 3000,
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
  assert.doesNotMatch(dxf, /SFP-WALLS|SFP-OPENINGS|SFP-DIMENSIONS|SFP-SPACES|SFP-FLOORS/);
  assert.match(dxf, /客厅/);
  assert.match(dxf, /一层/);
  assert.match(dxf, /二层/);
  assert.match(dxf, /INSERT/);
  assert.match(dxf, /ARC/);
  assert.match(dxf, /DIMENSION/);

  const parsed = await new Parser().parse(dxf);
  assert.equal(parsed.header.$ACADVER, 'AC1021');
  assert.equal(parsed.header.$INSUNITS, 4);
  assert.equal(parsed.header.$MEASUREMENT, 1);
  assert.ok(Number.isFinite(parsed.header.$EXTMIN?.x) && Number.isFinite(parsed.header.$EXTMIN?.y));
  assert.ok(Number.isFinite(parsed.header.$EXTMAX?.x) && Number.isFinite(parsed.header.$EXTMAX?.y));
  Object.values(DXF_LAYER_NAMES).forEach((layerName) => {
    assert.ok(parsed.tables.layer.records.some((layer) => layer.name === layerName), `missing layer ${layerName}`);
  });
  assert.match(namedTableRecord(dxf, 'LAYER', '0'), /\n62\n4\n/);
  assert.match(dxf, /\n370\n-3\n390\n0/);
  assert.doesNotMatch(dxf, /\n370\n0\n390\n0/);
  assert.match(dxf, new RegExp(DXF_ISO_DASH_LINETYPE));
  assert.match(dxf, new RegExp(`2\\n${DXF_ARCH_TICK_BLOCK}`));
  assert.match(namedTableRecord(dxf, 'STYLE', DXF_TEXT_STYLE_NAME), /simhei\.ttf/);
  const innerDimStyle = namedTableRecord(dxf, 'DIMSTYLE', DXF_DIM_STYLE_NAMES.inner);
  const outerDimStyle = namedTableRecord(dxf, 'DIMSTYLE', DXF_DIM_STYLE_NAMES.outer);
  assert.match(innerDimStyle, /\n41\n50(?:\.0+)?\n/);
  assert.match(innerDimStyle, /\n140\n135(?:\.0+)?\n/);
  assert.match(innerDimStyle, /\n271\n0\n/);
  assert.match(innerDimStyle, new RegExp(`\\n5\\n${DXF_ARCH_TICK_BLOCK}\\n`));
  assert.match(outerDimStyle, /\n140\n180(?:\.0+)?\n/);
  assert.match(outerDimStyle, new RegExp(`\\n5\\n${DXF_ARCH_TICK_BLOCK}\\n`));
  assert.equal(parsed.entities.lwPolylines.filter((entity) => entity.layerName === DXF_LAYER_NAMES.walls).length, 0);
  assert.equal(parsed.entities.arcs.length, 0);
  assert.ok(parsed.entities.inserts.some((insert) => insert.blockName === DXF_DOOR_BLOCK));
  assert.ok(parsed.entities.lines.length > 0);

  const dimensions = dimensionRecords(dxf);
  assert.ok(dimensions.length > 0);
  dimensions.forEach((dimension) => {
    assert.match(dimension, /100\nAcDbRotatedDimension/);
    assert.match(dimension, /\n70\n160\n/);
    assert.doesNotMatch(dimension, /\n70\n1\n/);
    assert.doesNotMatch(dimension, /\n12\n/);
    const angle = Number(dimension.match(/\n50\n([-+0-9.eE]+)/)?.[1]);
    assert.ok(angle === 0 || angle === 90, `dimension angle must be 0 or 90, got ${angle}: ${dimension.slice(0, 260)}`);
    assert.ok(
      dimension.includes(`\n3\n${DXF_DIM_STYLE_NAMES.inner}\n`) || dimension.includes(`\n3\n${DXF_DIM_STYLE_NAMES.outer}\n`),
      `dimension is missing a millimetre DIMSTYLE name: ${dimension.slice(0, 260)}`,
    );
    const value = (code: number) => Number(dimension.match(new RegExp(`\\n${code}\\n([-+0-9.eE]+)`))?.[1]);
    assert.ok(Number.isFinite(value(10)) && Number.isFinite(value(20)), `dimension definition point is missing: ${dimension.slice(0, 260)}`);
    assert.ok(Number.isFinite(value(11)) && Number.isFinite(value(21)), `dimension text midpoint is missing: ${dimension.slice(0, 260)}`);
    assert.ok(Number.isFinite(value(13)) && Number.isFinite(value(23)), `dimension first extension is missing: ${dimension.slice(0, 260)}`);
    assert.ok(Number.isFinite(value(14)) && Number.isFinite(value(24)), `dimension second extension is missing: ${dimension.slice(0, 260)}`);
  });
  assert.ok(dimensions.some((dimension) => dimension.includes(`\n3\n${DXF_DIM_STYLE_NAMES.inner}\n`)));
  assert.ok(dimensions.some((dimension) => dimension.includes(`\n3\n${DXF_DIM_STYLE_NAMES.outer}\n`)));
});

test('formal DXF walls are unioned inner/outer lines with opening jambs', async () => {
  const parsed = await new Parser().parse(generateFormalSurveyDxf(layout, 'completed'));
  const wallLines = parsed.entities.lines.filter((line) => line.layerName === DXF_LAYER_NAMES.walls);
  const wallPolylines = parsed.entities.lwPolylines.filter((entity) => entity.layerName === DXF_LAYER_NAMES.walls);
  assert.ok(wallLines.length > 11);
  assert.equal(wallPolylines.length, 0);
  assert.equal(wallPolylines.some((entity) => entity.numberOfVertices === 4 && entity.flag === 1), false);

  // Floor 1 is shifted so outer faces sit on the origin: inner AB is y=240.
  const innerY = 240;
  const doorInnerStart = 850;
  const doorInnerEnd = 1750;
  assert.equal(
    wallLines.some((line) => lineCoversRange(line, 'x', innerY, doorInnerStart, doorInnerEnd)),
    false,
    'door opening should break the inner wall face',
  );
  assert.ok(wallLines.some((line) => lineCoversRange(line, 'x', innerY, 200, 840)));
  assert.ok(wallLines.some((line) => lineCoversRange(line, 'x', innerY, 1760, 2580)));
  assert.ok(wallLines.some((line) => lineNearSegment(line, { x: doorInnerStart, y: innerY }, { x: doorInnerStart, y: 0 })));
  assert.ok(wallLines.some((line) => lineNearSegment(line, { x: doorInnerEnd, y: innerY }, { x: doorInnerEnd, y: 0 })));

  const livingInterior = { x: 1400, y: 1840 };
  const throughRoom = wallLines.filter((line) => {
    const length = Math.hypot(line.endX - line.startX, line.endY - line.startY);
    if (length < 500) return false;
    const dx = line.endX - line.startX;
    const dy = line.endY - line.startY;
    const t = ((livingInterior.x - line.startX) * dx + (livingInterior.y - line.startY) * dy) / (length * length);
    if (t <= 0.05 || t >= 0.95) return false;
    const projection = { x: line.startX + dx * t, y: line.startY + dy * t };
    return Math.hypot(projection.x - livingInterior.x, projection.y - livingInterior.y) < 20;
  });
  assert.equal(throughRoom.length, 0, 'unioned walls must not send a face through the living room');
});

test('formal DXF openings use door blocks and in-opening rails', async () => {
  const dxf = generateFormalSurveyDxf(layout, 'completed');
  const doorBlock = dxf.split('0\nBLOCK\n').slice(1).find((record) => record.includes(`\n2\n${DXF_DOOR_BLOCK}\n`)) || '';
  assert.match(doorBlock, /\n0\nLINE\n/);
  assert.match(doorBlock, /\n0\nARC\n/);
  assert.match(doorBlock, /\n50\n0(?:\.0+)?\n/);
  assert.match(doorBlock, /\n51\n90(?:\.0+)?\n/);
  assert.doesNotMatch(doorBlock, /\n51\n-/);
  assert.match(doorBlock, new RegExp(DXF_ISO_DASH_LINETYPE));

  const parsed = await new Parser().parse(dxf);
  assert.equal(parsed.entities.arcs.length, 0);
  const doorInserts = parsed.entities.inserts.filter((insert) => insert.blockName === DXF_DOOR_BLOCK);
  assert.equal(doorInserts.length, 3);

  const singleDoor = doorInserts.find((insert) => Math.abs(insert.xScale) > 800);
  assert.ok(singleDoor);
  assert.equal(singleDoor.layerName, DXF_LAYER_NAMES.doors);
  assert.ok(Math.abs(singleDoor.x - 850) < 2);
  assert.ok(Math.abs(singleDoor.y - 240) < 2, 'hinged door inserts on the opening face, not the wall centerline');
  assert.ok(Math.abs(singleDoor.rotation) < 1);
  assert.ok(Math.abs(singleDoor.xScale - 900) < 1);
  assert.ok(Math.abs(singleDoor.yScale - 900) < 1);

  const doubleLeaves = doorInserts.filter((insert) => Math.abs(Math.abs(insert.xScale) - 800) < 1);
  assert.equal(doubleLeaves.length, 2);
  assert.ok(doubleLeaves.some((insert) => insert.xScale > 0));
  assert.ok(doubleLeaves.some((insert) => insert.xScale < 0));

  const windowLines = parsed.entities.lines.filter((line) => line.layerName === DXF_LAYER_NAMES.windows);
  assert.ok(windowLines.some((line) => lineCoversRange(line, 'y', 5064, 1140, 2340)));
  assert.ok(windowLines.some((line) => lineCoversRange(line, 'y', 5136, 1140, 2340)));
  assert.equal(windowLines.some((line) => lineCoversRange(line, 'y', 5100, 1140, 2340)), false, 'window rails stay inside the opening, not on the wall centerline');

  const slidingLines = parsed.entities.lines.filter((line) => line.layerName === DXF_LAYER_NAMES.doors);
  assert.ok(slidingLines.some((line) => lineCoversRange(line, 'x', 3504, 900, 2100)));
  assert.ok(slidingLines.some((line) => lineCoversRange(line, 'x', 3576, 900, 2100)));
});

test('formal DXF room labels use inner-face metrics and a model-space sheet', async () => {
  const dxf = generateFormalSurveyDxf(layout, 'completed', {
    planName: '测试户型',
    enterpriseName: '测试装饰',
    designerName: '张工',
    date: '2026-08-20',
  });
  const mtexts = dxf.split('0\nMTEXT').slice(1);
  const living = mtexts.find((entity) => entity.includes('客厅')) || '';
  const dining = mtexts.find((entity) => entity.includes('餐厅')) || '';
  const bedroom = mtexts.find((entity) => entity.includes('卧室')) || '';
  assert.match(living, /\n40\n120(?:\.0+)?\n/);
  assert.match(living, /客厅\\P面积:7\.68㎡\\P高度:2\.80m\\P周长:11\.20m/);
  assert.doesNotMatch(living, /客厅P面积/);
  assert.match(living, /面积:7\.68㎡/);
  assert.match(living, /高度:2\.80m/);
  assert.match(living, /周长:11\.20m/);
  assert.match(dining, /面积:7\.10㎡/);
  assert.match(dining, /周长:10\.84m/);
  assert.doesNotMatch(dining, /面积:7\.68㎡/);
  assert.match(bedroom, /高度:3\.00m/);
  assert.match(dxf, new RegExp(DXF_DRAWING_TITLE));
  assert.match(dxf, /项目名称/);
  assert.match(dxf, /测试户型/);
  assert.match(dxf, /测试装饰/);
  assert.match(dxf, /张工/);
  assert.match(dxf, /2026-08-20/);
  assert.match(dxf, /1:35/);
  const parsed = await new Parser().parse(dxf);
  assert.ok(parsed.entities.inserts.some((insert) => insert.blockName === DXF_NORTH_BLOCK));
  assert.ok(parsed.entities.lwPolylines.some((entity) => entity.layerName === '0'));
});

test('formal DXF rejects non-completed and non-closed floor plans', () => {
  assert.throws(() => getFormalSurveyLayoutForDxf(layout, 'draft'), (error: unknown) => error instanceof DxfExportError && error.code === 'DXF_EXPORT_REQUIRES_COMPLETED');
  const withoutClosedSpace = structuredClone(layout);
  withoutClosedSpace.surveyGraph.floors[0].spaces = [{ id: 'open', name: '未闭合', wallIds: ['ab'], closed: false }];
  withoutClosedSpace.surveyGraph.floors[1].spaces = [];
  assert.throws(() => getFormalSurveyLayoutForDxf(withoutClosedSpace, 'completed'), (error: unknown) => error instanceof DxfExportError && error.code === 'DXF_EXPORT_REQUIRES_CLOSED_SPACE');
});

test('DXF sheet meta prefers the linked lead enterprise and assigned designer', () => {
  const sheet = buildFormalSurveyDxfSheet({
    planName: ' 客厅方案 ',
    enterpriseName: '嘉可莱装饰',
    designerName: '张工',
    date: new Date(2026, 7, 20),
  });
  assert.deepEqual(sheet, {
    planName: '客厅方案',
    enterpriseName: '嘉可莱装饰',
    designerName: '张工',
    date: '2026-08-20',
  });
  const withoutLead = buildFormalSurveyDxfSheet({
    planName: '未关联户型',
    enterpriseName: '租户公司',
    designerName: '  ',
    date: '2026-08-20',
  });
  assert.equal(withoutLead.enterpriseName, '租户公司');
  assert.equal(withoutLead.designerName, undefined);
});

test('DXF download filename excludes unsafe path characters', () => {
  assert.equal(safeDxfFileName('户型: A/B', '42'), 'FloorPlan_户型_ A_B_42.dxf');
  const disposition = dxfContentDisposition('户型: A/B', '42');
  assert.equal(disposition, 'attachment; filename="FloorPlan_42.dxf"; filename*=UTF-8\'\'FloorPlan_%E6%88%B7%E5%9E%8B_%20A_B_42.dxf');
  assert.ok([...disposition].every((character) => character.charCodeAt(0) <= 255));
});
