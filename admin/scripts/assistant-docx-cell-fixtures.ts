/** Synthetic KB-2 originals. Raw property XML deliberately permits malformed test cases. */
import { syntheticZip } from './assistant-file-fixtures';

type Cell = { text: string; propertySets?: string[]; footnote?: boolean };
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function cellDocx(rows: Cell[][]) {
  const p = (text: string) => `<w:p><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`;
  const body = rows.map((cells, row) => `<w:tr>${row === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map(cell =>
    `<w:tc>${(cell.propertySets ?? []).map(properties => `<w:tcPr>${properties}</w:tcPr>`).join('')}${p(cell.text)}${cell.footnote ? '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' : ''}</w:tc>`).join('')}</w:tr>`).join('');
  return syntheticZip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>合成单元格定位</w:t></w:r></w:p><w:tbl>${body}</w:tbl>${p('注：仅合成定位示例，不形成验收或施工批准。')}<w:sectPr/></w:body></w:document>`,
    'word/footnotes.xml': '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>合成脚注😀：须先核对材料型号和实际基层。</w:t></w:r></w:p></w:footnote></w:footnotes>',
  });
}
export const historicalCellProperties = (properties: string) => `<w:tcPrChange w:id="1" w:author="synthetic"><w:tcPr>${properties}</w:tcPr></w:tcPrChange>`;
