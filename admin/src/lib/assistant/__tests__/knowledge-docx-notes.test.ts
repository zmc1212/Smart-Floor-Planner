import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headerNote, noteDocx, rowANote, rowBNote, secondHeaderNote, tableNote } from '../../../../scripts/assistant-docx-note-fixtures';
import { fileChunks, fileContent, parseSourceFile } from '../knowledge/source-file';
import type { SourceFile } from '../contracts/source-file';

const heading = (notes: string[] = ['1']) => ({ header: true, cells: [{ text: '材料型号', notes }, { text: '示例厚度（mm）' }] });
const materialA = (notes?: string[]) => ({ cells: [{ text: 'SYNTHETIC-A；先核对实际材料', notes }, { text: '2 mm' }] });
const materialB = (notes?: string[]) => ({ cells: [{ text: 'SYNTHETIC-B；不得套用A条件', notes }, { text: '7 mm' }] });

test('each data row retains the leading table header footnote as original context', async () => {
  const parsed = await parseSourceFile(noteDocx([heading(), materialA(), materialB()]), 'docx');
  for (const row of parsed.blocks.filter(b => (b.row ?? 0) > 1)) assert.deepEqual(row.notes, [headerNote, tableNote]);
});
test('all contiguous leading header notes survive in source order', async () => {
  const parsed = await parseSourceFile(noteDocx([heading(), { header: true, cells: [{ text: '适用前提', notes: ['2'] }, { text: '单位 mm' }] }, materialA(['3'])]), 'docx');
  const row = parsed.blocks.find(b => b.row === 3)!;
  assert.deepEqual(row.headers, ['材料型号 | 示例厚度（mm）', '适用前提 | 单位 mm']);
  assert.deepEqual(row.notes, [headerNote, secondHeaderNote, rowANote, tableNote]);
});
for (const marker of [undefined, false]) test(`inferred-first-row context retains its notes and review warning with marker ${marker}`, async () => {
  const parsed = await parseSourceFile(noteDocx([{ ...heading(), header: marker }, materialA()]), 'docx');
  assert.ok(parsed.warnings.includes('table_first_row_header_requires_review'));
  assert.deepEqual(parsed.blocks.find(b => b.row === 2)?.notes, [headerNote, tableNote]);
});
test('body-row and later marked-row footnotes remain local after the leading header prefix', async () => {
  const parsed = await parseSourceFile(noteDocx([heading(), materialA(['3']), { ...materialB(['4']), header: true }, materialA()]), 'docx');
  assert.deepEqual(parsed.blocks.find(b => b.row === 2)?.notes, [headerNote, rowANote, tableNote]);
  assert.deepEqual(parsed.blocks.find(b => b.row === 3)?.notes, [headerNote, rowBNote, tableNote]);
  assert.deepEqual(parsed.blocks.find(b => b.row === 4)?.notes, [headerNote, tableNote]);
});
test('repeated references do not duplicate shared header or row footnotes', async () => {
  const parsed = await parseSourceFile(noteDocx([heading(['1', '1']), materialA(['1', '3', '3'])]), 'docx');
  assert.deepEqual(parsed.blocks.find(b => b.row === 2)?.notes, [headerNote, rowANote, tableNote]);
});
test('tables without header notes keep ordinary body notes local', async () => {
  const parsed = await parseSourceFile(noteDocx([heading([]), materialA(['3']), materialB(['4'])]), 'docx');
  assert.deepEqual(parsed.blocks.find(b => b.row === 2)?.notes, [rowANote, tableNote]);
  assert.deepEqual(parsed.blocks.find(b => b.row === 3)?.notes, [rowBNote, tableNote]);
});
test('data-row chunks retain header conditions, own notes and exact Unicode ranges without mixing materials', async () => {
  const parsed = await parseSourceFile(noteDocx([heading(), materialA(['3']), materialB(['4'])]), 'docx');
  const file: SourceFile = { version: 1, assetId: 'synthetic-notes', hash: 'c'.repeat(64), name: '合成表头脚注.docx', format: 'docx', parsed,
    review: { adminId: '1', at: '2026-10-19T03:00:00Z', excluded: [] } };
  const chunks = await fileChunks(file, async text => [{ text, start: 0, end: Array.from(text).length, tokens: 100 }]);
  for (const [row, ownNote, otherNote, value] of [[2, rowANote, rowBNote, '2 mm'], [3, rowBNote, rowANote, '7 mm']] as const) {
    const chunk = chunks.find(c => c.file.row === row)!;
    assert.ok(chunk.text.includes(headerNote)); assert.ok(chunk.text.includes(ownNote)); assert.ok(!chunk.text.includes(otherNote));
    assert.ok(chunk.text.includes(value)); assert.ok(chunk.text.includes(tableNote));
    assert.deepEqual(chunk.file.columns, [1, 2]); assert.match(chunk.file.label, new RegExp(`表1·第${row}行`));
    assert.equal(chunk.file.parser, 'xiaok-file-v1.3:docx:yauzl3.4.0:saxes6.0.0'); assert.equal(chunk.file.page, undefined);
    assert.equal(Array.from(fileContent(file).body).slice(chunk.start, chunk.end).join(''), chunk.text);
  }
});
