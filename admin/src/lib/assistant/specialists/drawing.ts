import { createHash } from 'node:crypto';
import { fingerprint } from '../contracts';
import { sharedMaterialMedia, sharedMaterials } from '@/lib/construction/site-materials';

/** I7.0 drawing contract. Design content is never treated as installed work. */
export type ElectricalDrawingElement = {
  elementId: string;
  kind: 'distribution_box' | 'circuit' | 'lighting' | 'socket' | 'switch' | 'weak_current'
    | 'water_supply' | 'drainage' | 'floor_drain' | 'other';
  label: string;
  roomName: string | null;
  pageNumber: number;
  coordinateReference: string;
};

export type ElectricalDrawing = {
  projectId: string;
  roomId: string;
  drawingId: string;
  drawingType: 'electrical_layout' | 'water_supply_drainage' | 'floor_plan' | 'unknown';
  drawingVersion: string;
  revision: string;
  sourceHash: string;
  pageNumber: number | null;
  coordinateReference: string;
  extractedElements: ElectricalDrawingElement[];
  uncertainty: string[];
  verificationStatus: 'extracted' | 'text_only' | 'unreadable' | 'not_provided';
};

export type ElectricalDrawingRead = {
  status: 'ready' | 'empty' | 'unavailable' | 'not_provided';
  drawings: ElectricalDrawing[];
  version: string;
  failures: string[];
};

const emptyRead = (status: ElectricalDrawingRead['status'], failure?: string): ElectricalDrawingRead => ({
  status, drawings: [], version: fingerprint({ status, failure: failure ?? null }), failures: failure ? [failure] : [],
});

const roomNames = ['客厅', '卧室', '主卧', '次卧', '厨房', '卫生间', '洗手间', '阳台', '书房', '餐厅', '玄关', '儿童房', '衣帽间'];
const maxPages = 20;
const maxElementsPerPage = 40;
const maxTextLength = 200_000;
const maxPdfBytes = 20 * 1024 * 1024;

type PdfTextItem = { str?: string; transform?: number[] };

function elementKind(line: string): ElectricalDrawingElement['kind'] | null {
  if (/地漏|存水弯|雨水斗/u.test(line)) return 'floor_drain';
  if (/排水|污水|废水|下水/u.test(line)) return 'drainage';
  if (/给水|冷水|热水|水表|水压|用水设备|水嘴|角阀/u.test(line)) return 'water_supply';
  if (/弱电|网络|网线|电视|智能家居|弱电箱|光纤|电话|门禁|监控/u.test(line)) return 'weak_current';
  if (/配电箱|配电柜|电箱|总开|空开|漏电保护|断路器/u.test(line)) return 'distribution_box';
  if (/回路|专线/u.test(line)) return 'circuit';
  if (/插座/u.test(line)) return 'socket';
  if (/开关/u.test(line)) return 'switch';
  if (/照明|灯具|灯位/u.test(line)) return 'lighting';
  if (/强电|空调|厨电/u.test(line)) return 'other';
  return null;
}

function drawingTypeOf(text: string): ElectricalDrawing['drawingType'] {
  if (/给排水|给水|排水|水施/u.test(text)) return 'water_supply_drainage';
  if (/强电|弱电|电气|配电|照明|插座/u.test(text)) return 'electrical_layout';
  if (/平面|布置图|户型/u.test(text)) return 'floor_plan';
  return 'unknown';
}

export function extractDrawingPage(page: number, lines: Array<{ text: string; page: number; x: number; y: number }>,
  base: { projectId: string; roomId: string; drawingId: string; drawingVersion: string; sourceHash: string; revision: string }): ElectricalDrawing {
  const pageText = lines.map(line => line.text).join('\n');
  const elements: ElectricalDrawingElement[] = [];
  for (const line of lines) {
    if (elements.length >= maxElementsPerPage) break;
    const kind = elementKind(line.text);
    if (!kind) continue;
    const room = roomNames.find(name => line.text.includes(name)) ?? null;
    elements.push({
      elementId: `p${page}:${line.x}:${line.y}:${elements.length}`,
      kind, label: line.text.slice(0, 120), roomName: room,
      pageNumber: page, coordinateReference: `page:${page}:x:${line.x}:y:${line.y}`,
    });
  }
  const uncertainty: string[] = [];
  if (!pageText.trim()) uncertainty.push('该页没有可提取文本');
  if (!elements.length && pageText.trim()) uncertainty.push('该页未识别出明确的水电点位，需人工核对图纸');
  return { ...base, drawingType: drawingTypeOf(pageText), pageNumber: page,
    coordinateReference: `page:${page}`, extractedElements: elements, uncertainty,
    verificationStatus: elements.length ? 'extracted' : 'text_only' };
}

function linesFromItems(items: readonly PdfTextItem[], page: number) {
  const pieces = items.flatMap(item => {
    const value = typeof item.str === 'string' ? item.str.trim() : '';
    const transform = Array.isArray(item.transform) ? item.transform : [];
    if (!value) return [];
    return [{ value, x: Number(transform[4] ?? 0), y: Number(transform[5] ?? 0) }];
  }).sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: Array<{ text: string; page: number; x: number; y: number }> = [];
  let current: { text: string; page: number; x: number; y: number } | null = null;
  for (const piece of pieces) {
    if (current && Math.abs(current.y - piece.y) <= 2) {
      current.text = `${current.text} ${piece.value}`.trim();
      continue;
    }
    if (current) lines.push(current);
    current = { text: piece.value, page, x: Math.round(piece.x), y: Math.round(piece.y) };
  }
  if (current) lines.push(current);
  return lines;
}

async function pdfPages(data: Buffer): Promise<{ pages: Array<{ page: number; lines: Array<{ text: string; page: number; x: number; y: number }> }>; failures: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false,
    disableFontFace: true, verbosity: 0 });
  const document = await loading.promise;
  const pages: Array<{ page: number; lines: Array<{ text: string; page: number; x: number; y: number }> }> = [];
  const failures: string[] = [];
  try {
    const count = Math.min(document.numPages, maxPages);
    if (document.numPages > maxPages) failures.push(`drawing_page_limit:${document.numPages}`);
    let total = 0;
    for (let page = 1; page <= count; page++) {
      const pdfPage = await document.getPage(page);
      const content = await pdfPage.getTextContent();
      const lines = linesFromItems(content.items as PdfTextItem[], page);
      total += lines.reduce((sum, line) => sum + line.text.length, 0);
      if (total > maxTextLength) {
        failures.push('drawing_text_limit');
        break;
      }
      pages.push({ page, lines });
    }
  } finally {
    await loading.destroy();
  }
  return { pages, failures };
}

/** Pure parser for a drawing original. Kept separate from authorization so the
 * text extraction, page locations and element identity stay testable. */
export async function parseDrawingBytes(media: { data: Buffer; mime: string }, base: {
  projectId: string; roomId: string; drawingId: string; drawingVersion: string; sourceHash: string;
}): Promise<ElectricalDrawingRead> {
  const fingerprintBase = { drawingVersion: base.drawingVersion, sourceHash: base.sourceHash };
  const revision = createHash('sha256').update(base.sourceHash).digest('hex');
  const drawingBase = { ...base, revision };
  if (media.data.length > maxPdfBytes) return emptyRead('unavailable', 'drawing_original_too_large');
  const pdf = media.mime === 'application/pdf' || media.data.subarray(0, 4).toString() === '%PDF';
  if (!pdf) {
    return {
      status: 'empty',
      version: fingerprint({ ...fingerprintBase, kind: 'image', bytes: media.data.length }),
      failures: ['drawing_image_text_not_extracted'],
      drawings: [{ ...drawingBase, drawingType: 'unknown', pageNumber: null, coordinateReference: 'unknown',
        extractedElements: [], uncertainty: ['图片图纸未做文字识别，点位和尺寸需现场核实'],
        verificationStatus: 'unreadable' }],
    };
  }
  let parsed: Awaited<ReturnType<typeof pdfPages>>;
  try {
    parsed = await pdfPages(media.data);
  } catch {
    return {
      status: 'unavailable',
      version: fingerprint({ ...fingerprintBase, kind: 'pdf_parse_failed' }),
      failures: ['drawing_pdf_unreadable'],
      drawings: [{ ...drawingBase, drawingType: 'unknown', pageNumber: null, coordinateReference: 'unknown',
        extractedElements: [], uncertainty: ['图纸 PDF 未能读取，需提供可读版本或现场核实'],
        verificationStatus: 'unreadable' }],
    };
  }
  const drawings = parsed.pages.map(page => extractDrawingPage(page.page, page.lines, drawingBase));
  if (!drawings.length) return emptyRead('unavailable', 'drawing_no_pages');
  const hasText = drawings.some(drawing => drawing.verificationStatus === 'extracted' || drawing.verificationStatus === 'text_only');
  return { status: hasText ? 'ready' : 'empty', drawings, failures: parsed.failures,
    version: fingerprint(drawings.map(drawing => ({ id: drawing.drawingId, hash: drawing.sourceHash,
      page: drawing.pageNumber, elements: drawing.extractedElements.map(element => element.elementId) }))) };
}

/** Only the latest authorized drawing grant for this exact project and room is
 * readable. A revoked, replaced or unrelated grant yields no drawing. */
export async function readElectricalDrawings(tx: Parameters<typeof sharedMaterials>[0], input: {
  enterpriseId: string; projectId: string; roomId: string;
}): Promise<ElectricalDrawingRead> {
  const materials = await sharedMaterials(tx, input.enterpriseId, input.projectId, input.roomId);
  const grant = materials.sources.find(source => source.kind === 'drawing');
  if (!grant) return emptyRead('not_provided');
  if (!grant.mediaId) return emptyRead('unavailable', 'drawing_original_missing');
  let media: { data: Buffer; mime: string };
  try {
    media = await sharedMaterialMedia(tx, input.enterpriseId, input.projectId, grant.id, grant.mediaId);
  } catch {
    return emptyRead('unavailable', 'drawing_original_unavailable');
  }
  return parseDrawingBytes(media, { projectId: input.projectId, roomId: input.roomId, drawingId: grant.id,
    drawingVersion: grant.id, sourceHash: grant.mediaHash ?? grant.sourceHash });
}

export function drawingChecks(read: ElectricalDrawingRead | undefined, roomId: string) {
  const refs: Array<{ drawing: ElectricalDrawing; element: ElectricalDrawingElement }> = [];
  for (const drawing of read?.drawings ?? []) {
    for (const element of drawing.extractedElements) refs.push({ drawing, element });
  }
  return refs.map(({ drawing, element }) => ({ ...element, drawing, roomId }));
}
