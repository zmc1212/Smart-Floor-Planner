import assert from 'node:assert/strict';
import test from 'node:test';
import { Parser } from '@dxfjs/parser';
import { buildFormalSurveyDxfSheet, formatDxfExportFileName, formatDxfProjectName } from '@/lib/dxf-export-sheet';
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
  fileNameFromContentDisposition,
  generateFormalSurveyDxf,
  getFormalSurveyLayoutForDxf,
  safeDxfFileName,
} from '@/lib/dxf';
import {
  DXF_SHEET_CORNER_RADIUS,
  DXF_SHEET_HEIGHT,
  DXF_SHEET_WIDTH,
  estimateDimensionPadding,
  fitDrawingToSheet,
  getFixedSheetLayout,
  mapSheetPoint,
} from '@/lib/dxf-sheet';

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

/** Recover floor-1 survey→sheet mapping from the known door hinge at survey (850,240).
 * DXF negates survey Y so the drawing matches the canvas orientation. */
function floorOneMapperFromDoor(door: { x: number; y: number; xScale: number }) {
  const scale = Math.abs(door.xScale) / 900;
  const hingeX = 850;
  const hingeY = -240;
  const originX = door.x - hingeX * scale;
  const originY = door.y - hingeY * scale;
  return (x: number, y: number) => ({ x: originX + x * scale, y: originY + (-y) * scale });
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
  const innerAsz = Number(innerDimStyle.match(/\n41\n([-+0-9.eE]+)/)?.[1]);
  const innerTxt = Number(innerDimStyle.match(/\n140\n([-+0-9.eE]+)/)?.[1]);
  const innerGap = Number(innerDimStyle.match(/\n147\n([-+0-9.eE]+)/)?.[1]);
  const outerTxt = Number(outerDimStyle.match(/\n140\n([-+0-9.eE]+)/)?.[1]);
  const outerGap = Number(outerDimStyle.match(/\n147\n([-+0-9.eE]+)/)?.[1]);
  assert.ok(innerAsz > 20, `DIMASZ should follow sheet fit scale, got ${innerAsz}`);
  assert.ok(Math.abs(innerTxt / innerAsz - 135 / 50) < 0.02);
  assert.ok(Math.abs(innerGap / innerAsz - 10 / 50) < 0.02);
  const innerExo = Number(innerDimStyle.match(/\n42\n([-+0-9.eE]+)/)?.[1]);
  assert.ok(Math.abs(innerExo / innerAsz - 280 / 50) < 0.02, `DIMEXO should keep extension lines off the plan, got ${innerExo}`);
  assert.ok(Math.abs(outerTxt / innerAsz - 180 / 50) < 0.02);
  assert.ok(Math.abs(outerGap / innerAsz - 10 / 50) < 0.02);
  assert.match(innerDimStyle, /\n77\n2\n/);
  assert.match(innerDimStyle, /\n271\n0\n/);
  assert.match(innerDimStyle, new RegExp(`\\n5\\n${DXF_ARCH_TICK_BLOCK}\\n`));
  assert.match(outerDimStyle, /\n77\n2\n/);
  assert.match(outerDimStyle, new RegExp(`\\n5\\n${DXF_ARCH_TICK_BLOCK}\\n`));
  assert.match(innerDimStyle, /\n178\n193\n/);
  assert.match(outerDimStyle, /\n178\n193\n/);
  assert.match(namedTableRecord(dxf, 'LAYER', DXF_LAYER_NAMES.spaces), /\n62\n7\n/);
  assert.equal(parsed.entities.lwPolylines.filter((entity) => entity.layerName === DXF_LAYER_NAMES.walls).length, 0);
  assert.equal(parsed.entities.arcs.filter((arc) => arc.layerName !== '0').length, 0);
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
    const definitionOffset = Math.hypot(value(10) - value(13), value(20) - value(23));
    assert.ok(definitionOffset >= 200, `dimension line should sit well outside the wall face: ${dimension.slice(0, 260)}`);
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

  const doorInsert = parsed.entities.inserts
    .filter((insert) => insert.blockName === DXF_DOOR_BLOCK)
    .reduce<(typeof parsed.entities.inserts)[number] | null>((best, insert) => (
      !best || Math.abs(insert.xScale) > Math.abs(best.xScale) ? insert : best
    ), null);
  assert.ok(doorInsert);
  const map = floorOneMapperFromDoor(doorInsert);

  // Floor 1 is normalized then fitted into the fixed sheet: inner AB is y=240 locally.
  const inner = map(0, 240);
  const doorInnerStart = map(850, 240);
  const doorInnerEnd = map(1750, 240);
  const leftInner = map(200, 240);
  const leftInnerEnd = map(840, 240);
  const rightInner = map(1760, 240);
  const rightInnerEnd = map(2580, 240);
  const jambBottomStart = map(850, 0);
  const jambBottomEnd = map(1750, 0);
  assert.equal(
    wallLines.some((line) => lineCoversRange(line, 'x', inner.y, doorInnerStart.x, doorInnerEnd.x)),
    false,
    'door opening should break the inner wall face',
  );
  assert.ok(wallLines.some((line) => lineCoversRange(line, 'x', inner.y, leftInner.x, leftInnerEnd.x)));
  assert.ok(wallLines.some((line) => lineCoversRange(line, 'x', inner.y, rightInner.x, rightInnerEnd.x)));
  assert.ok(wallLines.some((line) => lineNearSegment(line, doorInnerStart, jambBottomStart)));
  assert.ok(wallLines.some((line) => lineNearSegment(line, doorInnerEnd, jambBottomEnd)));

  const livingInterior = map(1400, 1840);
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
  assert.match(doorBlock, /\n0\nLWPOLYLINE\n/);
  assert.match(doorBlock, /\n62\n3\n/);
  assert.match(doorBlock, /\n0\nARC\n/);
  assert.match(doorBlock, /\n50\n0(?:\.0+)?\n/);
  assert.match(doorBlock, /\n51\n90(?:\.0+)?\n/);
  assert.doesNotMatch(doorBlock, /\n51\n-/);
  assert.match(doorBlock, new RegExp(DXF_ISO_DASH_LINETYPE));
  const leafVertices = [...(doorBlock.split('0\nLWPOLYLINE\n')[1]?.matchAll(/\n10\n([-+0-9.eE]+)\n20\n([-+0-9.eE]+)/g) || [])]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  assert.ok(leafVertices.length >= 4);
  assert.ok(Math.max(...leafVertices.map((point) => point.x)) < 0.1, 'open door leaf thickness stays along X');
  assert.ok(Math.max(...leafVertices.map((point) => point.y)) > 0.9, 'open door leaf extends along +Y into the room');
  const doorArc = doorBlock.split('0\nARC\n')[1] || '';
  assert.match(doorArc, /\n62\n252\n/);

  const archTick = dxf.split('0\nBLOCK\n').slice(1).find((record) => record.includes(`\n2\n${DXF_ARCH_TICK_BLOCK}\n`)) || '';
  assert.match(archTick, /\n0\nLWPOLYLINE\n/);
  assert.doesNotMatch(archTick, /\n0\n3DFACE\n/);

  const northBlock = dxf.split('0\nBLOCK\n').slice(1).find((record) => record.includes(`\n2\n${DXF_NORTH_BLOCK}\n`)) || '';
  assert.match(northBlock, /\n62\n2\n/);
  assert.match(northBlock, /\n0\nCIRCLE\n/);
  assert.match(northBlock, /\n0\nHATCH\n/);

  const parsed = await new Parser().parse(dxf);
  assert.equal(parsed.entities.arcs.filter((arc) => arc.layerName !== '0').length, 0);
  const doorInserts = parsed.entities.inserts.filter((insert) => insert.blockName === DXF_DOOR_BLOCK);
  assert.equal(doorInserts.length, 3);

  const singleDoor = doorInserts.reduce<(typeof doorInserts)[number] | null>((best, insert) => (
    !best || Math.abs(insert.xScale) > Math.abs(best.xScale) ? insert : best
  ), null);
  assert.ok(singleDoor);
  assert.equal(singleDoor.layerName, DXF_LAYER_NAMES.doors);
  const map = floorOneMapperFromDoor(singleDoor);
  const expectedHinge = map(850, 240);
  assert.ok(Math.abs(singleDoor.x - expectedHinge.x) < 2);
  assert.ok(Math.abs(singleDoor.y - expectedHinge.y) < 2, 'hinged door inserts on the opening face, not the wall centerline');
  assert.ok(Math.abs(singleDoor.rotation) < 1);
  assert.ok(Math.abs(Math.abs(singleDoor.xScale) - Math.abs(singleDoor.yScale)) < 1);
  assert.ok(Math.abs(singleDoor.xScale) > 100, 'door leaf keeps a measurable width after sheet fit');

  const leafWidth = Math.abs(singleDoor.xScale);
  const doubleLeaves = doorInserts.filter((insert) => Math.abs(Math.abs(insert.xScale) - leafWidth * (800 / 900)) < 2);
  assert.equal(doubleLeaves.length, 2);
  assert.ok(doubleLeaves.some((insert) => insert.xScale > 0));
  assert.ok(doubleLeaves.some((insert) => insert.xScale < 0));

  const windowLines = parsed.entities.lines.filter((line) => line.layerName === DXF_LAYER_NAMES.windows);
  assert.ok(windowLines.length >= 4);
  [5040, 5080, 5120, 5160].forEach((localX) => {
    const mapped = map(localX, 1140);
    const mappedEnd = map(localX, 2340);
    assert.ok(
      windowLines.some((line) => lineCoversRange(line, 'y', mapped.x, mapped.y, mappedEnd.y)),
      `missing inset window rail at local x=${localX}`,
    );
  });
  assert.equal(
    windowLines.some((line) => {
      const mapped = map(5064, 1140);
      const mappedEnd = map(5064, 2340);
      return lineCoversRange(line, 'y', mapped.x, mapped.y, mappedEnd.y);
    }),
    false,
    'window rails should not hug the old 32%/68% pair',
  );
  assert.equal(
    windowLines.some((line) => {
      const mapped = map(5000, 1140);
      const mappedEnd = map(5000, 2340);
      return lineCoversRange(line, 'y', mapped.x, mapped.y, mappedEnd.y);
    }),
    false,
    'window rails stay off the inner wall face',
  );
  assert.equal(
    windowLines.some((line) => {
      const mapped = map(5200, 1140);
      const mappedEnd = map(5200, 2340);
      return lineCoversRange(line, 'y', mapped.x, mapped.y, mappedEnd.y);
    }),
    false,
    'window rails stay off the outer wall face',
  );
  assert.equal(
    windowLines.some((line) => {
      const mapped = map(5100, 1140);
      const mappedEnd = map(5100, 2340);
      return lineCoversRange(line, 'y', mapped.x, mapped.y, mappedEnd.y);
    }),
    false,
    'window rails stay inside the opening, not on the wall centerline',
  );

  const slidingLines = parsed.entities.lines.filter((line) => line.layerName === DXF_LAYER_NAMES.doors);
  const slideA = map(900, 3504);
  const slideAEnd = map(2100, 3504);
  const slideB = map(900, 3576);
  const slideBEnd = map(2100, 3576);
  assert.ok(slidingLines.some((line) => lineCoversRange(line, 'x', slideA.y, slideA.x, slideAEnd.x)));
  assert.ok(slidingLines.some((line) => lineCoversRange(line, 'x', slideB.y, slideB.x, slideBEnd.x)));
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
  const livingHeight = Number(living.match(/\n40\n([-+0-9.eE]+)/)?.[1]);
  assert.ok(livingHeight > 70, `room label height should follow sheet fit scale, got ${livingHeight}`);
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
  assert.match(dxf, /项目名称：/);
  assert.match(dxf, /测试户型/);
  assert.match(dxf, /测试装饰/);
  assert.match(dxf, /张工/);
  assert.match(dxf, /2026-08-20/);
  assert.match(dxf, /1:85/);
  assert.match(dxf, /\n1\nCompany\n/);
  assert.match(dxf, /\n1\nProject\n/);
  assert.match(dxf, /\n1\nDrawing Name\n/);
  assert.match(dxf, /\n1\nDesigner\n/);
  assert.match(dxf, /\n1\nDrawing Scale\n/);
  assert.match(dxf, /\n1\nDate\n/);
  const sheetLabels = [...dxf.matchAll(/\n1\n(公司名称：|项目名称：|图纸名称：|家装设计顾问：|图纸比例：|制图日期：)\n/g)].map((match) => match[1]);
  assert.deepEqual(sheetLabels.slice(0, 6), ['公司名称：', '项目名称：', '图纸名称：', '家装设计顾问：', '图纸比例：', '制图日期：']);
  // Old layout drew a mid-cell vertical at titleLeft + 38% title width (~27882); stacked labels must not.
  assert.doesNotMatch(dxf, /\n10\n27882(?:\.0+)?\n20\n520(?:\.0+)?\n30\n0\n11\n27882(?:\.0+)?\n/);
  assert.ok(
    dimensionRecords(dxf).some((dimension) => /\n1\n(?:180|200|240)\n/.test(dimension)),
    'inner chain includes wall-thickness ticks',
  );
  const parsed = await new Parser().parse(dxf);
  assert.ok(parsed.entities.inserts.some((insert) => insert.blockName === DXF_NORTH_BLOCK));
  assert.ok(parsed.entities.lines.filter((line) => line.layerName === '0').length >= 8, 'fixed sheet uses outer rounded frame arcs/lines');
  assert.match(dxf, new RegExp(`\n10\n${DXF_SHEET_WIDTH}(?:\\.0+)?\n`));
  assert.match(dxf, new RegExp(`\n20\n${DXF_SHEET_HEIGHT}(?:\\.0+)?\n`));
  const entitiesSection = dxf.split('\n2\nENTITIES\n')[1]?.split(/\n0\nENDSEC/)[0] || '';
  const sheetArcs = entitiesSection.split('\n0\nARC\n').slice(1).filter((record) => {
    if (!/\n8\n0\n/.test(record)) return false;
    const radius = Number(record.match(/\n40\n([-+0-9.eE]+)/)?.[1]);
    return Math.abs(radius - DXF_SHEET_CORNER_RADIUS) < 0.5;
  });
  assert.equal(sheetArcs.length, 4, 'outer frame uses four corner arcs');
  sheetArcs.forEach((record) => {
    const start = Number(record.match(/\n50\n([-+0-9.eE]+)/)?.[1]);
    const end = Number(record.match(/\n51\n([-+0-9.eE]+)/)?.[1]);
    const sweep = ((end - start) % 360 + 360) % 360;
    assert.ok(Math.abs(sweep - 90) < 0.01, `frame corner arc must sweep 90°, got ${start}→${end}`);
  });
});

test('fixed sheet stays constant while floor content is fitted into the draw zone', () => {
  const sheet = getFixedSheetLayout();
  assert.equal(sheet.outerRight - sheet.outerLeft, DXF_SHEET_WIDTH);
  assert.equal(sheet.outerTop - sheet.outerBottom, DXF_SHEET_HEIGHT);
  const small = fitDrawingToSheet({ minX: 0, minY: 0, maxX: 5000, maxY: 4000 }, sheet);
  assert.ok(small.scale > 1, 'small units scale up to fill the draw zone');
  assert.equal(small.plotScale, 85);
  const mappedSmall = mapSheetPoint(2500, 2000, small);
  assert.ok(mappedSmall.x > sheet.drawZone.minX && mappedSmall.x < sheet.drawZone.maxX);
  assert.ok(mappedSmall.y > sheet.drawZone.minY && mappedSmall.y < sheet.drawZone.maxY);
  const huge = fitDrawingToSheet({ minX: 0, minY: 0, maxX: 80000, maxY: 60000 }, sheet);
  assert.ok(huge.scale < 1);
  assert.equal(huge.plotScale, 85);
  const mapped = mapSheetPoint(40000, 30000, huge);
  assert.ok(mapped.x > sheet.drawZone.minX && mapped.x < sheet.drawZone.maxX);
  assert.ok(mapped.y > sheet.drawZone.minY && mapped.y < sheet.drawZone.maxY);
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
  assert.equal(
    formatDxfProjectName({
      customerName: '王先生',
      communityName: '阳光花园',
      area: '128.5',
      fallbackPlanName: '正式量房 - 20260820',
    }),
    '王先生 阳光花园 128.5㎡',
  );
  assert.equal(
    formatDxfProjectName({ fallbackPlanName: '正式量房 - 20260820' }),
    '正式量房 - 20260820',
  );
  assert.equal(
    formatDxfExportFileName({
      customerName: '王先生',
      communityName: '阳光花园',
      area: 120,
      at: new Date(2026, 7, 20, 15, 30, 45),
    }),
    '王先生 阳光花园 120㎡ 20260820153045.dxf',
  );
});

test('DXF download filename excludes unsafe path characters', () => {
  assert.equal(safeDxfFileName('户型: A/B'), '户型_ A_B.dxf');
  const disposition = dxfContentDisposition('王先生 阳光花园 120㎡ 20260820153045.dxf', '42');
  assert.match(disposition, /^attachment; filename="FloorPlan_42\.dxf"; filename\*=UTF-8''/);
  assert.equal(
    fileNameFromContentDisposition(disposition, 'fallback.dxf'),
    '王先生 阳光花园 120㎡ 20260820153045.dxf',
  );
  assert.ok([...disposition].every((character) => character.charCodeAt(0) <= 255));
});
