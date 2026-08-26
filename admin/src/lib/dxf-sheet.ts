import {
  HatchBoundaryPaths,
  HatchPolylineBoundary,
  HatchPredefinedPatterns,
  LWPolylineFlags,
  MTextAttachmentPoint,
  TextHorizontalAlignment,
  TextVerticalAlignment,
  pattern,
  point2d,
  point3d,
  vertex,
  type DxfWriter as DxfWriterType,
} from '@tarikjabiri/dxf';

export const DXF_NORTH_BLOCK = 'NORTH';
export const DXF_DRAWING_TITLE = '原始户型平面图';
const SHEET_LAYER = '0';
const SHEET_ROW_COUNT = 6;

/** Fixed landscape sheet matching the reference CAD template (≈ A1 × 36.43). */
export const DXF_SHEET_WIDTH = 30640;
export const DXF_SHEET_HEIGHT = 21660;
export const DXF_SHEET_FRAME_PAD = 520;
export const DXF_SHEET_TITLE_WIDTH = 3610;
export const DXF_SHEET_BOTTOM_TITLE_BAND = 980;
export const DXF_SHEET_CONTENT_PAD = 900;
export const DXF_SHEET_CORNER_RADIUS = 95;

export type DxfSheetMeta = {
  planName?: string;
  enterpriseName?: string;
  designerName?: string;
  date?: string;
};

type Box = { minX: number; minY: number; maxX: number; maxY: number };

export type SheetFitTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  plotScale: number;
  sheet: FixedSheetLayout;
};

export type FixedSheetLayout = {
  outerLeft: number;
  outerBottom: number;
  outerRight: number;
  outerTop: number;
  innerLeft: number;
  innerBottom: number;
  innerRight: number;
  innerTop: number;
  titleLeft: number;
  titleRight: number;
  titleBottom: number;
  titleTop: number;
  rowHeight: number;
  drawZone: Box;
  cornerRadius: number;
};

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

function styleMText(
  dxf: DxfWriterType,
  x: number,
  y: number,
  height: number,
  width: number,
  value: string,
  textStyleName: string,
  attachmentPoint: MTextAttachmentPoint,
) {
  const text = dxf.addMText(point3d(x, y), height, value, {
    layerName: SHEET_LAYER,
    attachmentPoint,
    width,
  });
  text.textStyle = textStyleName;
  return text;
}

export function getFixedSheetLayout(): FixedSheetLayout {
  const outerLeft = 0;
  const outerBottom = 0;
  const outerRight = DXF_SHEET_WIDTH;
  const outerTop = DXF_SHEET_HEIGHT;
  const innerLeft = DXF_SHEET_FRAME_PAD;
  const innerBottom = DXF_SHEET_FRAME_PAD;
  const innerRight = DXF_SHEET_WIDTH - DXF_SHEET_FRAME_PAD;
  const innerTop = DXF_SHEET_HEIGHT - DXF_SHEET_FRAME_PAD;
  const titleRight = innerRight;
  const titleLeft = titleRight - DXF_SHEET_TITLE_WIDTH;
  const titleBottom = innerBottom;
  const titleTop = innerTop;
  const rowHeight = (titleTop - titleBottom) / SHEET_ROW_COUNT;
  const drawZone = {
    minX: innerLeft + DXF_SHEET_CONTENT_PAD,
    minY: innerBottom + DXF_SHEET_BOTTOM_TITLE_BAND,
    maxX: titleLeft - DXF_SHEET_CONTENT_PAD,
    maxY: innerTop - DXF_SHEET_CONTENT_PAD,
  };
  return {
    outerLeft,
    outerBottom,
    outerRight,
    outerTop,
    innerLeft,
    innerBottom,
    innerRight,
    innerTop,
    titleLeft,
    titleRight,
    titleBottom,
    titleTop,
    rowHeight,
    drawZone,
    cornerRadius: DXF_SHEET_CORNER_RADIUS,
  };
}

export function estimatePlotScale(width: number, height: number) {
  const span = Math.max(width, height, 1);
  // Match the reference CAD title scale (~1:85 on a 30640-wide sheet).
  return Math.max(5, Math.round(span / 360 / 5) * 5);
}

/** Title-block plot scale for the fixed sheet template (independent of unit size). */
export function estimateFixedSheetPlotScale(sheet: FixedSheetLayout = getFixedSheetLayout()) {
  return estimatePlotScale(sheet.outerRight - sheet.outerLeft, sheet.outerTop - sheet.outerBottom);
}

/**
 * Exterior dimension standoff from the wall AABB (millimetres, pre-fit).
 * Kept deliberately larger than canvas preview gaps so CAD reads like the
 * reference sheet (first lane well clear of the plan).
 */
export function estimateDimensionLaneGaps(span: number) {
  const safeSpan = Math.max(span, 1);
  return {
    baseGap: Math.max(600, safeSpan * 0.14),
    laneGap: Math.max(400, safeSpan / 16) * 2,
  };
}

/**
 * Estimate how far exterior dimensions stick out beyond the wall AABB so the
 * fixed sheet can reserve space before the floor plan is written.
 */
export function estimateDimensionPadding(contentWidth: number, contentHeight: number) {
  const span = Math.max(contentWidth, contentHeight, 1);
  const { baseGap, laneGap } = estimateDimensionLaneGaps(span);
  return Math.max(2800, baseGap + laneGap * 3 + 800);
}

/** Leave a thin margin so dims/north/title band do not kiss the frame. */
export const DXF_SHEET_FIT_FILL = 0.9;

/**
 * Fit millimetre floor-plan content into the fixed sheet drawing zone.
 * Scales up or down so walls+dimensions fill most of the left draw zone
 * (reference-sized frame stays fixed; unit size does not shrink-wrap the frame).
 */
export function fitDrawingToSheet(content: Box, sheet: FixedSheetLayout = getFixedSheetLayout()): SheetFitTransform {
  const zone = sheet.drawZone;
  const zoneW = Math.max(1, zone.maxX - zone.minX);
  const zoneH = Math.max(1, zone.maxY - zone.minY);
  const contentW = Math.max(1, content.maxX - content.minX);
  const contentH = Math.max(1, content.maxY - content.minY);
  const scale = Math.min(zoneW / contentW, zoneH / contentH) * DXF_SHEET_FIT_FILL;
  const contentCx = (content.minX + content.maxX) / 2;
  const contentCy = (content.minY + content.maxY) / 2;
  const zoneCx = (zone.minX + zone.maxX) / 2;
  const zoneCy = (zone.minY + zone.maxY) / 2;
  return {
    scale,
    offsetX: zoneCx - contentCx * scale,
    offsetY: zoneCy - contentCy * scale,
    plotScale: estimateFixedSheetPlotScale(sheet),
    sheet,
  };
}

export function mapSheetPoint(x: number, y: number, fit: SheetFitTransform) {
  return {
    x: x * fit.scale + fit.offsetX,
    y: y * fit.scale + fit.offsetY,
  };
}

/** @deprecated Prefer getFixedSheetLayout + fitDrawingToSheet. */
export function computeSheetLayout(drawing: Box) {
  const sheet = getFixedSheetLayout();
  const fit = fitDrawingToSheet(drawing, sheet);
  return {
    ...sheet,
    width: drawing.maxX - drawing.minX,
    height: drawing.maxY - drawing.minY,
    span: Math.max(drawing.maxX - drawing.minX, drawing.maxY - drawing.minY),
    centerShift: { x: fit.offsetX, y: fit.offsetY },
    fit,
  };
}

function addRoundedRectangle(
  dxf: DxfWriterType,
  left: number,
  bottom: number,
  right: number,
  top: number,
  radius: number,
  options: { layerName: string },
) {
  const r = Math.max(0, Math.min(radius, (right - left) / 2, (top - bottom) / 2));
  if (r <= 1) {
    dxf.addRectangle(point2d(left, top), point2d(right, bottom), options);
    return;
  }
  // DXF arcs are always CCW. Each corner must sweep 90°, not 270°.
  dxf.addLine(point3d(left + r, top), point3d(right - r, top), options);
  dxf.addArc(point3d(right - r, top - r), r, 0, 90, options);
  dxf.addLine(point3d(right, top - r), point3d(right, bottom + r), options);
  dxf.addArc(point3d(right - r, bottom + r), r, 270, 360, options);
  dxf.addLine(point3d(right - r, bottom), point3d(left + r, bottom), options);
  dxf.addArc(point3d(left + r, bottom + r), r, 180, 270, options);
  dxf.addLine(point3d(left, bottom + r), point3d(left, top - r), options);
  dxf.addArc(point3d(left + r, top - r), r, 90, 180, options);
}

export function addNorthArrowBlock(dxf: DxfWriterType, textStyleName: string) {
  const block = dxf.addBlock(DXF_NORTH_BLOCK);
  const inherit = { layerName: SHEET_LAYER, colorNumber: 2 };
  block.addCircle(point3d(0, 0), 1, inherit);
  const boundary = new HatchBoundaryPaths();
  boundary.addPolylineBoundary(new HatchPolylineBoundary([
    vertex(0, 0.92),
    vertex(-0.42, -0.62),
    vertex(0, -0.22),
    vertex(0.42, -0.62),
  ]));
  block.addHatch(boundary, pattern({ name: HatchPredefinedPatterns.SOLID }), inherit);
  block.addLWPolyline(
    [
      { point: point2d(0, 0.92) },
      { point: point2d(-0.42, -0.62) },
      { point: point2d(0, -0.22) },
      { point: point2d(0.42, -0.62) },
    ],
    { ...inherit, flags: LWPolylineFlags.Closed },
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
  _drawing: Box,
  options: {
    textStyleName: string;
    northLayerName: string;
    meta?: DxfSheetMeta;
    plotScale?: number;
    sheet?: FixedSheetLayout;
  },
) {
  const metrics = options.sheet || getFixedSheetLayout();
  const scale = options.plotScale ?? estimatePlotScale(
    metrics.drawZone.maxX - metrics.drawZone.minX,
    metrics.drawZone.maxY - metrics.drawZone.minY,
  );
  // Reference CAD: no vertical label/value split — Chinese, English, then value.
  const rows: Array<{ zh: string; en: string; value: string }> = [
    { zh: '公司名称：', en: 'Company', value: options.meta?.enterpriseName?.trim() || '' },
    { zh: '项目名称：', en: 'Project', value: options.meta?.planName?.trim() || '户型' },
    { zh: '图纸名称：', en: 'Drawing Name', value: DXF_DRAWING_TITLE },
    { zh: '家装设计顾问：', en: 'Designer', value: options.meta?.designerName?.trim() || '' },
    { zh: '图纸比例：', en: 'Drawing Scale', value: `1:${scale}` },
    { zh: '制图日期：', en: 'Date', value: formatDxfSheetDate(options.meta?.date) },
  ];
  const frame = { layerName: SHEET_LAYER };
  addRoundedRectangle(
    dxf,
    metrics.outerLeft,
    metrics.outerBottom,
    metrics.outerRight,
    metrics.outerTop,
    metrics.cornerRadius,
    frame,
  );
  dxf.addRectangle(
    point2d(metrics.innerLeft, metrics.innerTop),
    point2d(metrics.innerRight, metrics.innerBottom),
    frame,
  );
  dxf.addLine(
    point3d(metrics.titleLeft, metrics.innerBottom),
    point3d(metrics.titleLeft, metrics.innerTop),
    frame,
  );
  const titleWidth = metrics.titleRight - metrics.titleLeft;
  const textInset = Math.max(48, metrics.rowHeight * 0.1);
  const zhHeight = Math.min(metrics.rowHeight * 0.16, 220);
  const enHeight = Math.min(metrics.rowHeight * 0.12, 170);
  const valueHeight = Math.min(metrics.rowHeight * 0.2, 260);
  const valueWidth = titleWidth - textInset * 2;
  rows.forEach((row, index) => {
    const top = metrics.titleTop - metrics.rowHeight * index;
    const bottom = top - metrics.rowHeight;
    dxf.addLine(point3d(metrics.titleLeft, bottom), point3d(metrics.titleRight, bottom), frame);
    const left = metrics.titleLeft + textInset;
    styleText(
      dxf,
      left,
      top - textInset,
      zhHeight,
      row.zh,
      options.textStyleName,
      TextHorizontalAlignment.Left,
      TextVerticalAlignment.Top,
    );
    styleText(
      dxf,
      left,
      top - textInset - zhHeight * 1.35,
      enHeight,
      row.en,
      options.textStyleName,
      TextHorizontalAlignment.Left,
      TextVerticalAlignment.Top,
    );
    if (row.value) {
      styleMText(
        dxf,
        left,
        top - textInset - zhHeight * 1.35 - enHeight * 1.45,
        valueHeight,
        valueWidth,
        row.value,
        options.textStyleName,
        MTextAttachmentPoint.TopLeft,
      );
    }
  });
  const titleTextHeight = Math.max(220, DXF_SHEET_BOTTOM_TITLE_BAND * 0.32);
  styleText(
    dxf,
    (metrics.innerLeft + metrics.titleLeft) / 2,
    metrics.innerBottom + DXF_SHEET_BOTTOM_TITLE_BAND * 0.35,
    titleTextHeight,
    DXF_DRAWING_TITLE,
    options.textStyleName,
    TextHorizontalAlignment.Center,
    TextVerticalAlignment.Middle,
  );
  const northSize = Math.max(520, Math.min(900, (metrics.drawZone.maxX - metrics.drawZone.minX) * 0.035));
  dxf.addInsert(
    DXF_NORTH_BLOCK,
    point3d(metrics.drawZone.maxX - northSize * 0.2, metrics.drawZone.maxY - northSize * 1.35),
    {
      layerName: options.northLayerName,
      scaleFactor: { x: northSize, y: northSize, z: 1 },
    },
  );
}
