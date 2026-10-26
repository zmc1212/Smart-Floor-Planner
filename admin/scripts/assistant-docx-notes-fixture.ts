/** Synthetic D2 originals. These conditions are test data, never construction advice. */
import { syntheticZip } from './assistant-file-fixtures';

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
export function syntheticDocxNotesEntries() {
  return {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/></Types>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="footnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="endnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="${word}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${text('合成设备章节')}<w:r><w:endnoteReference w:id="1"/></w:r></w:p>
      <w:p>${text('合成设备应先核对原件，再讨论摆放。😀')}<w:r><w:footnoteReference w:id="1"/><w:endnoteReference w:id="2"/></w:r></w:p>
      <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p>${text('合成检查项目')}</w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p>${text('合成底座检查')}<w:r><w:endnoteReference w:id="2"/></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${text('合成子章节')}</w:p>
      <w:p>${text('子章节沿用同一适用条件。')}</w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${text('另一合成章节')}</w:p>
      <w:p>${text('此处不继承上一章节的限定。')}</w:p>
      <w:sectPr/></w:body></w:document>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${word}"><w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1" w:type="normal"><w:p>${text('合成脚注：资料不足时核实，不作验收结论。')}</w:p></w:footnote></w:footnotes>`,
    'word/endnotes.xml': `<w:endnotes xmlns:w="${word}"><w:endnote w:id="1" w:type="normal"><w:p>${text('合成章节限定：仅适用于经团队核对的样例设备。')}</w:p></w:endnote><w:endnote w:id="2"><w:p>${text('合成尾注：潮湿场景须另核厂家适用条件。')}</w:p><w:p>${text('不得从参考资料推断本项目已具备条件。😀')}</w:p></w:endnote><w:endnote w:id="3"><w:p>${text('未引用的合成备注不进入正文。')}</w:p></w:endnote></w:endnotes>`,
  };
}
export function syntheticDocxNotes() { return syntheticZip(syntheticDocxNotesEntries()); }
