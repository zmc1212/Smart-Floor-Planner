import {
  TextHorizontalAlignment,
  TextVerticalAlignment,
  point2d,
  point3d,
  type DxfWriter as DxfWriterType,
} from '@tarikjabiri/dxf';

export const DXF_NORTH_BLOCK = 'NORTH';
export const DXF_DRAWING_TITLE = '原始户型平面图';
const SHEET_LAYER = '0';

export type DxfSheetMeta = {
  planName?: string;
  enterpriseName?: string;
  designerName?: string;
  date?: string;
};

type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function formatDxfSheetDate(value?: Date | string | null) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return value.trim().slice(0, 10);
  }
  const date = value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function styleText(
  dxf: DxfWriterType,
  x: number,
  y: number,
  height: number,
  value: string,
  textStyleName: string,
  horizontalAlignment: TextHorizontalAlignment,
  verticalAlignment: TextVerticalAlignment,
) {
  const text = dxf.addText(point3d(x, y), height, value, {
    layerName: SHEET_LAYER,
    horizontalAlignment,
    verticalAlignment,
  });
  text.textStyle = textStyleName;
  return text;
}

export function estimatePlotScale(width: number, height: number) {
  const span = Math.max(width, height, 1);
  return Math.max(5, Math.round(span / 350 / 5) * 5);
}

export function addNorthArrowBlock(dxf: DxfWriterType, textStyleName: string) {
  const block = dxf.addBlock(DXF_NORTH_BLOCK);
  const inherit = { layerName: SHEET_LAYER, colorNumber: 2 };
  block.addCircle(point3d(0, 0), 1, inherit);
  block.add3dFace(
    point3d(0, 0.92),
    point3d(-0.42, -0.62),
    point3d(0, -0.22),
    point3d(0.42, -0.62),
    inherit,
  );
  block.addLWPolyline(
    [
      { point: point2d(0, 0.92) },
      { point: point2d(-0.42, -0.62) },
      { point: point2d(0, -0.22) },
      { point: point2d(0.42, -0.62) },
    ],
    { ...inherit, flags: 1 },
  );
  const north = block.addText(point3d(0, 1.18), 0.42, 'N', {
    ...inherit,
    horizontalAlignment: TextHorizontalAlignment.Center,
    verticalAlignment: TextVerticalAlignment.Bottom,
  });
  north.textStyle = textStyleName;
}

export function addModelSpaceSheet(
  dxf: DxfWriterType,
  drawing: Box,
  options: { textStyleName: string; northLayerName: string; meta?: DxfSheetMeta },
) {
  const width = Math.max(1, drawing.maxX - drawing.minX);
  const height = Math.max(1, drawing.maxY - drawing.minY);
  const span = Math.max(width, height);
  const margin = Math.max(700, span * 0.08);
  const titleWidth = Math.max(2400, Math.min(4200, span * 0.24));
  const rowHeight = Math.max(260, Math.min(400, span * 0.032));
  const framePad = Math.max(50, span * 0.008);
  const scale = estimatePlotScale(width, height);
  const rows: Array<[string, string]> = [
    ['项目名称', options.meta?.planName?.trim() || '户型'],
    ['图纸名称', DXF_DRAWING_TITLE],
    ['比例', `1:${scale}`],
    ['日期', formatDxfSheetDate(options.meta?.date)],
    ['公司', options.meta?.enterpriseName?.trim() || ''],
    ['设计师', options.meta?.designerName?.trim() || ''],
  ];
  const titleHeight = rowHeight * rows.length;
  const innerLeft = drawing.minX - margin;
  const innerBottom = drawing.minY - margin;
  const innerTop = drawing.maxY + margin;
  const innerRight = drawing.maxX + margin;
  const titleLeft = innerRight;
  const titleRight = titleLeft + titleWidth;
  const titleBottom = innerBottom;
  const titleTop = titleBottom + titleHeight;
  const contentTop = Math.max(innerTop, titleTop);
  const outerLeft = innerLeft - framePad;
  const outerBottom = innerBottom - framePad;
  const outerRight = titleRight + framePad;
  const outerTop = contentTop + framePad;
  const frame = { layerName: SHEET_LAYER };
  dxf.addRectangle(point2d(outerLeft, outerTop), point2d(outerRight, outerBottom), frame);
  dxf.addRectangle(point2d(innerLeft, contentTop), point2d(titleRight, innerBottom), frame);
  dxf.addLine(point3d(titleLeft, innerBottom), point3d(titleLeft, contentTop), frame);
  dxf.addLine(point3d(titleLeft, titleTop), point3d(titleRight, titleTop), frame);
  const labelWidth = titleWidth * 0.38;
  const textInset = Math.max(40, rowHeight * 0.16);
  const labelHeight = rowHeight * 0.34;
  const valueHeight = rowHeight * 0.38;
  rows.forEach(([label, value], index) => {
    const top = titleTop - rowHeight * index;
    const bottom = top - rowHeight;
    dxf.addLine(point3d(titleLeft, bottom), point3d(titleRight, bottom), frame);
    dxf.addLine(point3d(titleLeft + labelWidth, bottom), point3d(titleLeft + labelWidth, top), frame);
    styleText(dxf, titleLeft + textInset, (top + bottom) / 2, labelHeight, label, options.textStyleName, TextHorizontalAlignment.Left, TextVerticalAlignment.Middle);
    if (value) {
      styleText(dxf, titleLeft + labelWidth + textInset, (top + bottom) / 2, valueHeight, value, options.textStyleName, TextHorizontalAlignment.Left, TextVerticalAlignment.Middle);
    }
  });
  const titleTextHeight = Math.max(180, span * 0.028);
  styleText(
    dxf,
    (innerLeft + innerRight) / 2,
    innerBottom - titleTextHeight * 0.35,
    titleTextHeight,
    DXF_DRAWING_TITLE,
    options.textStyleName,
    TextHorizontalAlignment.Center,
    TextVerticalAlignment.Top,
  );
  const northSize = Math.max(420, Math.min(900, span * 0.07));
  dxf.addInsert(DXF_NORTH_BLOCK, point3d(innerRight - northSize * 1.2, contentTop - northSize * 1.35), {
    layerName: options.northLayerName,
    scaleFactor: { x: northSize, y: northSize, z: 1 },
  });
}
