import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticDocxOutline, syntheticDocxOutlineEntries } from '../../../../scripts/assistant-docx-outline-fixture';
import { syntheticDocxNotesEntries } from '../../../../scripts/assistant-docx-notes-fixture';
import { syntheticZip } from '../../../../scripts/assistant-file-fixtures';
import { fileChunks, fileContent, parseSourceFile } from '../knowledge/source-file';
import type { SourceFile } from '../contracts/source-file';

test('direct Word outline levels preserve chapter conditions through body/table and stop at a sibling', async () => {
  const parsed = await parseSourceFile(syntheticDocxOutline(), 'docx');
  const headings = parsed.blocks.filter(b => b.kind === 'heading');
  assert.deepEqual(headings.map(b => b.text), ['合成设备章节', '合成子章节', '另一合成章节']);
  const paragraph = parsed.blocks.find(b => b.text.startsWith('合成设备应'))!;
  const child = parsed.blocks.find(b => b.text.startsWith('子章节沿用'))!;
  const row = parsed.blocks.find(b => b.kind === 'table_row' && b.row === 2)!;
  for (const block of [paragraph, child, row]) assert.match(block.notes!.join('\n'), /合成章节限定/);
  assert.doesNotMatch((parsed.blocks.find(b => b.text.startsWith('此处不继承'))!.notes || []).join('\n'), /合成章节限定/);
  const file: SourceFile = { version: 1, assetId: '1', hash: 'b'.repeat(64), name: '合成大纲.docx', format: 'docx', parsed,
    review: { adminId: '1', at: '2026-10-27T00:00:00Z', excluded: [] } };
  for (const chunk of await fileChunks(file, async text => [{ text, start: 0, end: Array.from(text).length, tokens: 100 }])) {
    assert.equal(Array.from(fileContent(file).body).slice(chunk.start, chunk.end).join(''), chunk.text);
  }
});

test('direct no-outline level9 overrides Heading style without making paragraph notes qualify later text', async () => {
  const entries = syntheticDocxOutlineEntries();
  entries['word/document.xml'] = entries['word/document.xml'].replace(
    '<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>合成子章节',
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="9"/></w:pPr><w:r><w:endnoteReference w:id="2"/></w:r><w:r><w:t>合成子章节');
  const parsed = await parseSourceFile(syntheticZip(entries), 'docx');
  assert.equal(parsed.blocks.find(b => b.text === '合成子章节')!.kind, 'paragraph');
  const next = parsed.blocks.find(b => b.text.startsWith('子章节沿用'))!;
  assert.match(next.notes!.join('\n'), /合成章节限定/);
  assert.doesNotMatch(next.notes!.join('\n'), /合成尾注：潮湿场景/);
});

test('direct outline level takes precedence over the style outline, including skipped levels', async () => {
  const entries = syntheticDocxNotesEntries();
  entries['word/document.xml'] = entries['word/document.xml']
    .replace('<w:pStyle w:val="Heading2"/>', '<w:pStyle w:val="Heading2"/><w:outlineLvl w:val="0"/>');
  const parsed = await parseSourceFile(syntheticZip(entries), 'docx');
  const next = parsed.blocks.find(b => b.text.startsWith('子章节沿用'))!;
  assert.deepEqual(next.section, ['合成子章节']);
  assert.doesNotMatch((next.notes || []).join('\n'), /合成章节限定/);
});

test('previous paragraph-property revisions do not supply the current outline or style', async () => {
  const entries = syntheticDocxOutlineEntries();
  entries['word/document.xml'] = entries['word/document.xml'].replace('<w:pPr><w:outlineLvl w:val="1"/></w:pPr>',
    '<w:pPr><w:pPrChange w:id="7"><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr></w:pPrChange></w:pPr>');
  const parsed = await parseSourceFile(syntheticZip(entries), 'docx');
  assert.equal(parsed.blocks.find(b => b.text === '合成子章节')!.kind, 'paragraph');
  assert.match(parsed.blocks.find(b => b.text.startsWith('子章节沿用'))!.notes!.join('\n'), /合成章节限定/);
});

test('invalid direct outline metadata fails instead of publishing silently condition-free evidence', async () => {
  for (const value of ['-1', '10', 'not-a-level']) {
    const entries = syntheticDocxOutlineEntries();
    entries['word/document.xml'] = entries['word/document.xml'].replace('w:outlineLvl w:val="0"', `w:outlineLvl w:val="${value}"`);
    await assert.rejects(parseSourceFile(syntheticZip(entries), 'docx'), /knowledge_file_parse_failed/);
  }
});

test('current style no-outline overrides Heading fallback and accepts equivalent integer lexical forms', async () => {
  const entries: Record<string, string> = syntheticDocxNotesEntries();
  entries['word/styles.xml'] = '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Heading2"><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style></w:styles>';
  entries['word/document.xml'] = entries['word/document.xml'].replace('<w:pStyle w:val="Heading1"/>', '<w:pStyle w:val="Heading1"/><w:outlineLvl w:val="+00"/>');
  const parsed = await parseSourceFile(syntheticZip(entries), 'docx');
  assert.equal(parsed.blocks.find(b => b.text === '合成设备章节')!.kind, 'heading');
  assert.equal(parsed.blocks.find(b => b.text === '合成子章节')!.kind, 'paragraph');
  assert.match(parsed.blocks.find(b => b.text.startsWith('子章节沿用'))!.notes!.join('\n'), /合成章节限定/);
});
