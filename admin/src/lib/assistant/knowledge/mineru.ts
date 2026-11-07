import { createHash } from 'node:crypto';
import { SaxesParser } from 'saxes';
import { fail } from '../contracts';
import type { ExtractionLocator, FileBlock, ParsedFile } from '../contracts/source-file';

export const mineruParser = 'mineru-export-page-v2';
export const mineruReviewedParser = 'mineru-reviewed-page-v3';
export type MineruChunk = { pdf_page: number; q: string; chunkIndex: number; dataId: string };
export type MineruTableReview = { protocol: 'mineru-table-review-v1'; layoutSha256: string; pageImageSha256: string;
  tables: Array<{ chunkIndex: number; chunkSha256: string; region: [number, number, number, number]; bookPage: string; context: string[] }>;
  limitations?: string[] };
export type MineruPage = { page: number; sourceSha256: string; corpusSha256: string; chunks: MineruChunk[]; review?: MineruTableReview };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const notes = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 12
  && value.every(s => typeof s === 'string' && s.length <= 400 && !s.includes('\0'));

/** Import an already-authorized export. No URL, cloud request, arithmetic
 * correction or publication is performed here. Table rows retain their cells,
 * spans and original column headers, within the existing file chunk contract. */
export function parseMineruPage(input: MineruPage): ParsedFile {
  if (!input || !Number.isInteger(input.page) || input.page < 1 || input.page > 500
    || !hash(input.sourceSha256) || !hash(input.corpusSha256) || !Array.isArray(input.chunks)
    || input.chunks.length > 128) fail('knowledge_file_invalid', 422);
  const seen = new Set<number>(), tableHashes = new Map<number, string>();
  for (const entry of input.chunks) {
    if (!entry || entry.pdf_page !== input.page || !Number.isInteger(entry.chunkIndex) || entry.chunkIndex < 0
      || seen.has(entry.chunkIndex) || typeof entry.q !== 'string' || entry.q.length > 16000 || entry.q.includes('\0')
      || !entry.q.startsWith(`【来源:精艺装修手册 PDF第${input.page}页|`) || !entry.q.includes('\n')
      || typeof entry.dataId !== 'string') fail('knowledge_file_invalid', 422);
    seen.add(entry.chunkIndex);
    if (entry.q.slice(entry.q.indexOf('\n') + 1).includes('<table')) tableHashes.set(entry.chunkIndex, sha(entry.q));
  }
  const review = input.review;
  if (review !== undefined && (!review || review.protocol !== 'mineru-table-review-v1' || !hash(review.layoutSha256) || !hash(review.pageImageSha256)
    || !Array.isArray(review.tables) || review.tables.length > 128
    || review.tables.some(t => !t || !Number.isInteger(t.chunkIndex) || !hash(t.chunkSha256)
      || !Array.isArray(t.region) || t.region.length !== 4 || t.region.some(v => !Number.isFinite(v) || v < 0 || v > 1000)
      || t.region[0] >= t.region[2] || t.region[1] >= t.region[3] || typeof t.bookPage !== 'string' || !/^\d{1,5}$/.test(t.bookPage)
      || !notes(t.context)) || (review.limitations !== undefined && !notes(review.limitations)))) fail('knowledge_file_invalid', 422);
  const reviewedTables = new Map(review?.tables.map(t => [t.chunkIndex, t]) || []);
  if (review && (reviewedTables.size !== review.tables.length || reviewedTables.size !== tableHashes.size
    || review.tables.some(t => tableHashes.get(t.chunkIndex) !== t.chunkSha256))) fail('context_changed');
  const blocks: FileBlock[] = [];
  let table = 0, paragraph = 0;
  let context = '';
  for (const entry of input.chunks) {
    const newline = entry.q.indexOf('\n');
    const tableReview = reviewedTables.get(entry.chunkIndex);
    // The cleaned export's page-wide sample-area prefix is not printed table
    // evidence. Reviewed imports use an explicit same-original table binding;
    // no adjacent column, previous table or chapter silently supplies an area.
    const section = review ? `【来源:精艺装修手册 PDF第${input.page}页${tableReview ? '|书页' + tableReview.bookPage : ''}】`
      : entry.q.slice(0, newline), body = entry.q.slice(newline + 1).trim();
    const extraction: ExtractionLocator = { provider: 'mineru', corpusSha256: input.corpusSha256,
      sourceSha256: input.sourceSha256, pdfPage: input.page, chunkIndex: entry.chunkIndex, chunkSha256: tableHashes.get(entry.chunkIndex) ?? sha(entry.q),
      ...(tableReview && review ? { review: { protocol: review.protocol, layoutSha256: review.layoutSha256,
        pageImageSha256: review.pageImageSha256, region: tableReview.region, bookPage: tableReview.bookPage,
        contextSha256: sha(JSON.stringify(tableReview.context)) } } : {}) };
    if (!body.includes('<table')) {
      if (body) {
        // Only legacy exports use the preceding paragraph as table context.
        if (!review) context = body;
        for (const text of body.split(/\n\s*\n/u).filter(Boolean)) blocks.push({ id: `mineru-${entry.chunkIndex}-p${++paragraph}`,
          kind: 'paragraph', text, section: [section], paragraph, page: 1, extraction });
      }
      continue;
    }
    const rows: Array<Array<{ column: number; span: number; rowSpan?: number; text: string }>> = [];
    let cells: typeof rows[number] = [], cell: typeof cells[number] | undefined;
    let depth = 0, nodes = 0, rowNumber = 0, nextColumn = 1;
    const occupied = new Map<number, number>();
    const parser = new SaxesParser({ xmlns: false });
    parser.on('doctype', () => fail('knowledge_file_unsafe_archive', 422));
    parser.on('opentag', tag => {
      if (++depth > 32 || ++nodes > 10000 || !['table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'br'].includes(tag.name)) fail('knowledge_file_invalid', 422);
      if (tag.name === 'tr') { cells = []; rowNumber++; nextColumn = 1; }
      if (tag.name === 'td' || tag.name === 'th') {
        const span = Number(tag.attributes.colspan ?? 1), rowSpan = Number(tag.attributes.rowspan ?? 1);
        if (!Number.isInteger(span) || span < 1 || span > 64 || !Number.isInteger(rowSpan) || rowSpan < 1 || rowSpan > 128) fail('knowledge_file_invalid', 422);
        while ((occupied.get(nextColumn) ?? 0) >= rowNumber) nextColumn++;
        cell = { column: nextColumn, span, ...(rowSpan > 1 ? { rowSpan } : {}), text: '' };
        for (let column = nextColumn; column < nextColumn + span; column++) occupied.set(column, rowNumber + rowSpan - 1);
        nextColumn += span;
        cells.push(cell);
      }
      if (tag.name === 'br' && cell) cell.text += '\n';
    });
    parser.on('text', text => { if (cell) cell.text += text; });
    parser.on('closetag', tag => {
      depth--;
      if (tag.name === 'td' || tag.name === 'th') { if (cell) cell.text = cell.text.trim(); cell = undefined; }
      if (tag.name === 'tr') rows.push(cells);
    });
    parser.on('error', () => fail('knowledge_file_parse_failed', 422));
    const start = body.indexOf('<table'), end = body.lastIndexOf('</table>');
    if (start < 0 || end < start || body.slice(end + 8).trim() || rows.length > 128) fail('knowledge_file_invalid', 422);
    parser.write(body.slice(start, end + 8).replaceAll('&nbsp;', '&#160;')).close();
    if (!rows.length || rows.length > 128 || rows.some(row => !row.length)) fail('knowledge_file_invalid', 422);
    table++;
    const headers = rows[0].map(c => c.text).join(' | ');
    let group = '';
    for (const [index, row] of rows.entries()) {
      const text = row.map(c => c.text).join(' | '), filled = row.filter(c => c.text);
      // A band occupies only the table's leading label columns. Carry that
      // exact original row through its following records, including totals.
      // No business keywords, query terms, arithmetic or invented headings.
      if (index > 0 && filled.length > 0 && filled.length <= 2 && filled.every(c => c.column <= 2)) group = text;
      blocks.push({ id: `mineru-${entry.chunkIndex}-t${table}-r${index + 1}`,
        kind: 'table_row', text, section: [section], page: 1,
        table, row: index + 1, cells: row, headers: [...(tableReview ? tableReview.context : [context]), headers, group].filter(Boolean), extraction });
    }
  }
  if (blocks.length > 128) fail('knowledge_file_block_limit', 422);
  return { parser: review ? mineruReviewedParser : mineruParser, pages: 1, blocks, warnings: [
    'MinerU候选解析；仅用于获权员工草稿预览，未发布，不代表现行企业标准或正式报价。',
    review ? 'PDF单页为原手册对应页的保留图像副本；表题、面积与限制逐表对照原图绑定，同页或同面积不证明属于同一预算。'
      : 'PDF单页为原手册对应页的保留图像副本；原PDF页号、书页及样板面积沿提取来源定位。',
    '保留原表数字与合并单元格；原表算术差异未修正，不能据此确认合同金额。',
    ...(review?.limitations ?? []),
    ...(!blocks.length ? ['现有导出未提供可检索文字；原页可能仍有图内文字，未生成图像描述或补写正文。'] : []),
  ] };
}
