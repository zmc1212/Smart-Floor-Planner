/** Synthetic table notes only; example values are not construction standards. */
import { syntheticZip } from './assistant-file-fixtures';

type Cell = { text: string; notes?: string[] };
type Row = { cells: Cell[]; header?: boolean };
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const tableNote = '注：仅合成定位数据，不形成验收或施工批准。';
export const headerNote = '合成表头脚注😀：单位为 mm；先核对材料型号与实际基层，不得外推。';
export const secondHeaderNote = '合成次级表头脚注：示例值不代表本项目检测结果。';
export const rowANote = '合成A行脚注：仅适用合成A条件。';
export const rowBNote = '合成B行脚注：仅适用合成B条件。';
export const noteDefinitions = { '1': headerNote, '2': secondHeaderNote, '3': rowANote, '4': rowBNote };
export function noteDocx(rows: Row[], definitions: Record<string, string> = noteDefinitions) {
  const p = (text: string) => `<w:p><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`;
  const table = rows.map(row => `<w:tr>${row.header === undefined ? '' : `<w:trPr><w:tblHeader w:val="${row.header ? 'on' : 'off'}"/></w:trPr>`}${row.cells.map(cell =>
    `<w:tc><w:p><w:r><w:t>${esc(cell.text)}</w:t>${(cell.notes ?? []).map(id => `<w:footnoteReference w:id="${esc(id)}"/>`).join('')}</w:r></w:p></w:tc>`).join('')}</w:tr>`).join('');
  return syntheticZip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>合成表头脚注保真</w:t></w:r></w:p><w:tbl>${table}</w:tbl>${p(tableNote)}<w:sectPr/></w:body></w:document>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${Object.entries(definitions).map(([id, text]) => `<w:footnote w:id="${esc(id)}">${p(text)}</w:footnote>`).join('')}</w:footnotes>`,
  });
}
