/** Synthetic KB-2 table originals; example values are not construction standards. */
import { syntheticZip } from './assistant-file-fixtures';
type Row = { cells: string[]; header?: string; historicalHeader?: boolean; footnote?: boolean };
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const headerCells = ['材料型号', '示例厚度（mm）', '前提与例外'];
export const materialA = ['SYNTHETIC-A', '2 mm', '仅适用合成A基层，先核对厂家资料；不代表检查通过。'];
export const materialB = ['SYNTHETIC-B', '7 mm', '仅适用合成B基层，不得把A型号条件套用到B。'];
export function headerDocx(rows: Row[]) {
  const p = (s: string) => `<w:p><w:r><w:t>${esc(s)}</w:t></w:r></w:p>`;
  const content = rows.map(row => {
    const flag = row.header === undefined ? '' : row.header === 'default' ? '<w:tblHeader/>' : `<w:tblHeader w:val="${esc(row.header)}"/>`;
    const history = row.historicalHeader ? '<w:trPrChange w:id="1" w:author="synthetic"><w:trPr><w:tblHeader/></w:trPr></w:trPrChange>' : '';
    return `<w:tr><w:trPr>${flag}${history}</w:trPr>${row.cells.map((s, i) => `<w:tc>${p(s)}${row.footnote && i === 0 ? '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' : ''}</w:tc>`).join('')}</w:tr>`;
  }).join('');
  return syntheticZip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>合成材料表头保真</w:t></w:r></w:p><w:tbl>${content}</w:tbl>${p('注：示例值不是本项目检测数据，不形成验收或施工批准。')}<w:sectPr/></w:body></w:document>`,
    'word/footnotes.xml': '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>合成A脚注：保留完整适用条件😀，不得外推。</w:t></w:r></w:p></w:footnote></w:footnotes>',
  });
}
