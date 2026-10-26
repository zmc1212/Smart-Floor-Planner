import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticDocxNotes, syntheticDocxNotesEntries } from '../../../../scripts/assistant-docx-notes-fixture';
import { syntheticZip } from '../../../../scripts/assistant-file-fixtures';
import { fileChunks, fileContent, parseSourceFile } from '../knowledge/source-file';
import type { SourceFile } from '../contracts/source-file';

test('DOCX keeps separate footnote/endnote identities, complete paragraphs and exact source locations', async () => {
  const parsed = await parseSourceFile(syntheticDocxNotes(), 'docx');
  const paragraph = parsed.blocks.find(block => block.text.startsWith('合成设备应'))!;
  assert.ok(paragraph);
  assert.match(paragraph.notes!.join('\n'), /合成脚注：资料不足时核实/);
  assert.match(paragraph.notes!.join('\n'), /合成尾注：潮湿场景/);
  assert.match(paragraph.notes!.join('\n'), /不得从参考资料推断本项目已具备条件。😀/);
  const file: SourceFile = { version: 1, assetId: '1', hash: 'a'.repeat(64), name: '合成注释.docx', format: 'docx',
    parsed, review: { adminId: '1', at: '2026-10-26T00:00:00Z', excluded: [] } };
  const chunks = await fileChunks(file, async text => [{ text, start: 0, end: Array.from(text).length, tokens: 100 }]);
  const row = chunks.find(chunk => chunk.file.row === 2)!;
  assert.match(row.text, /合成章节限定/);
  assert.match(row.text, /潮湿场景须另核厂家适用条件/);
  assert.match(row.file.label, /表1·第2行/);
  for (const chunk of chunks) assert.equal(Array.from(fileContent(file).body).slice(chunk.start, chunk.end).join(''), chunk.text);
  assert.ok(parsed.blocks.every(block => block.page === undefined));
  assert.doesNotMatch(fileContent(file).body, /未引用的合成备注/);
});

test('heading notes qualify descendants and stop at the next sibling section', async () => {
  const parsed = await parseSourceFile(syntheticDocxNotes(), 'docx');
  const first = parsed.blocks.find(block => block.text.startsWith('合成设备应'))!;
  const child = parsed.blocks.find(block => block.text.startsWith('子章节沿用'))!;
  const next = parsed.blocks.find(block => block.text.startsWith('此处不继承'))!;
  for (const block of [first, child]) assert.match(block.notes!.join('\n'), /合成章节限定/);
  assert.doesNotMatch((next.notes || []).join('\n'), /合成章节限定/);
});

test('skipped heading levels do not turn a sibling heading note into an ancestor condition', async () => {
  const entries = syntheticDocxNotesEntries();
  const sibling = '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>合成同级子章节</w:t></w:r></w:p><w:p><w:r><w:t>新同级内容。</w:t></w:r></w:p>';
  entries['word/document.xml'] = entries['word/document.xml']
    .replace('w:val="Heading2"', 'w:val="Heading3"')
    .replace('<w:t>合成子章节</w:t></w:r>', '<w:t>合成子章节</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>')
    .replace('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>另一合成章节', sibling + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>另一合成章节');
  const parsed = await parseSourceFile(syntheticZip(entries), 'docx');
  const next = parsed.blocks.find(block => block.text === '新同级内容。')!;
  assert.deepEqual(next.section, ['合成设备章节', '合成同级子章节']);
  assert.match(next.notes!.join('\n'), /合成章节限定/);
  assert.doesNotMatch(next.notes!.join('\n'), /合成脚注/);
});

test('table-header notes qualify data rows and a note-only paragraph is not silently discarded', async () => {
  const entries = syntheticDocxNotesEntries();
  entries['word/document.xml'] = entries['word/document.xml']
    .replace('<w:t>合成检查项目</w:t></w:r>', '<w:t>合成检查项目</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>')
    .replace('<w:sectPr/>', '<w:p><w:r><w:endnoteReference w:id="2"/></w:r></w:p><w:sectPr/>');
  const parsed = await parseSourceFile(syntheticZip(entries), 'docx');
  assert.match(parsed.blocks.find(block => block.row === 2)!.notes!.join('\n'), /合成脚注/);
  assert.equal(parsed.blocks.at(-1)!.text, '');
  assert.match(parsed.blocks.at(-1)!.notes!.join('\n'), /潮湿场景/);
});

test('dangling and duplicate note identities fail instead of publishing incomplete conditions', async () => {
  const entries = syntheticDocxNotesEntries();
  const variants = [
    { ...entries, 'word/endnotes.xml': entries['word/endnotes.xml'].replace('w:id="2"', 'w:id="4"') },
    { ...entries, 'word/footnotes.xml': entries['word/footnotes.xml'].replace('w:id="1"', 'w:id="4"') },
    { ...entries, 'word/endnotes.xml': entries['word/endnotes.xml'].replace('w:id="3"', 'w:id="2"') },
    { ...entries, 'word/endnotes.xml': entries['word/endnotes.xml'].replace('</w:endnote><w:endnote w:id="3">', '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:endnote><w:endnote w:id="3">') },
  ];
  for (const archive of variants) await assert.rejects(parseSourceFile(syntheticZip(archive), 'docx'), /knowledge_file_parse_failed|knowledge_file_complex_layout/);
});

test('deleted note references do not restore withdrawn text or demand a missing deleted note', async () => {
  const entries = syntheticDocxNotesEntries();
  entries['word/document.xml'] = entries['word/document.xml'].replace('<w:sectPr/>', '<w:p><w:del><w:r><w:footnoteReference w:id="999"/></w:r></w:del><w:r><w:t>合成保留正文。</w:t></w:r></w:p><w:sectPr/>');
  const parsed = await parseSourceFile(syntheticZip(entries), 'docx');
  assert.ok(parsed.warnings.includes('tracked_changes_visible_text_only'));
  assert.equal(parsed.blocks.at(-1)!.text, '合成保留正文。');
  assert.deepEqual(parsed.blocks.at(-1)!.notes || [], []);
});

test('complex or oversized notes retain the existing local parser bounds', async () => {
  const entries = syntheticDocxNotesEntries();
  for (const tail of [
    entries['word/endnotes.xml'].replace('<w:endnote w:id="2">', '<w:endnote w:id="2"><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'),
    entries['word/endnotes.xml'].replace('合成尾注：潮湿场景须另核厂家适用条件。', '界'.repeat(6001)),
  ]) await assert.rejects(parseSourceFile(syntheticZip({ ...entries, 'word/endnotes.xml': tail }), 'docx'), /knowledge_file_complex_layout|knowledge_file_block_limit/);
});
