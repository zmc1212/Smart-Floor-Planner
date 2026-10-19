import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headerDocx, headerCells, materialA, materialB } from '../../../../scripts/assistant-docx-header-fixtures';
import { parseSourceFile, fileContent, fileChunks } from '../knowledge/source-file';
import type { SourceFile } from '../contracts/source-file';

for (const header of ['default', 'on', 'true', '1']) test(`DOCX keeps the contiguous leading headers enabled by ${header}`, async () => {
  const parsed = await parseSourceFile(headerDocx([{ cells: headerCells, header }, { cells: ['型号', '单位 mm', '必须核对原件'], header }, { cells: materialA }]), 'docx');
  const row = parsed.blocks.find(b => b.row === 3)!;
  assert.deepEqual(row.headers, [headerCells.join(' | '), '型号 | 单位 mm | 必须核对原件']);
  assert.ok(!parsed.warnings.includes('table_first_row_header_requires_review'));
});
for (const header of ['off', 'false', '0']) test(`DOCX disabled ${header} rows never become copied headers`, async () => {
  const parsed = await parseSourceFile(headerDocx([{ cells: headerCells, header: 'default' }, { cells: materialA, header }, { cells: materialB }]), 'docx');
  for (const row of parsed.blocks.filter(b => b.table)) assert.deepEqual(row.headers, [headerCells.join(' | ')]);
  assert.equal(parsed.blocks.find(b => b.row === 2)?.text, materialA.join(' | '));
  assert.equal(parsed.blocks.find(b => b.row === 3)?.text, materialB.join(' | '));
});
test('DOCX does not promote a later marked row after the leading header sequence ended', async () => {
  const parsed = await parseSourceFile(headerDocx([{ cells: headerCells, header: 'default' }, { cells: materialA }, { cells: materialB, header: 'on' }]), 'docx');
  for (const row of parsed.blocks.filter(b => b.table)) assert.deepEqual(row.headers, [headerCells.join(' | ')]);
});
test('historical row properties cannot promote the current body row into a header', async () => {
  const parsed = await parseSourceFile(headerDocx([{ cells: headerCells, header: 'default' }, { cells: materialA, historicalHeader: true }, { cells: materialB }]), 'docx');
  assert.deepEqual(parsed.blocks.find(b => b.row === 3)?.headers, [headerCells.join(' | ')]);
});
test('a disabled first-row marker retains the existing inferred-first-row review warning', async () => {
  const parsed = await parseSourceFile(headerDocx([{ cells: headerCells, header: 'off' }, { cells: materialA }]), 'docx');
  assert.ok(parsed.warnings.includes('table_first_row_header_requires_review'));
  assert.deepEqual(parsed.blocks.find(b => b.row === 2)?.headers, [headerCells.join(' | ')]);
});
test('an unrecognized explicit header value fails honestly rather than inventing a header', async () => {
  await assert.rejects(parseSourceFile(headerDocx([{ cells: headerCells, header: 'perhaps' }, { cells: materialA }]), 'docx'), /knowledge_file_invalid/);
});
test('correct headers prevent another material from entering a row passage while retaining units, notes and locators', async () => {
  const parsed = await parseSourceFile(headerDocx([{ cells: headerCells, header: 'default' }, { cells: materialA, header: 'off', footnote: true }, { cells: materialB, header: 'off' }]), 'docx');
  assert.equal(parsed.parser, 'xiaok-file-v1.3:docx:yauzl3.4.0:saxes6.0.0');
  const file: SourceFile = { version: 1, assetId: 'synthetic', hash: 'a'.repeat(64), name: '合成材料.docx', format: 'docx', parsed,
    review: { adminId: '1', at: '2026-10-18T00:00:00Z', excluded: [] } };
  const chunks = await fileChunks(file, async text => [{ text, start: 0, end: Array.from(text).length, tokens: 100 }]);
  const a = chunks.find(c => c.file.row === 2)!, b = chunks.find(c => c.file.row === 3)!;
  assert.match(a.text, /材料型号.*示例厚度（mm）.*前提与例外/); assert.match(a.text, /SYNTHETIC-A.*2 mm/);
  assert.doesNotMatch(a.text, /SYNTHETIC-B|7 mm|合成B基层/); assert.doesNotMatch(b.text, /SYNTHETIC-A|2 mm|合成A脚注/);
  assert.match(a.text, /合成A脚注.*😀/); assert.match(a.text, /不形成验收或施工批准/); assert.match(b.text, /不形成验收或施工批准/);
  assert.equal(a.file.parser, parsed.parser); assert.equal(a.file.blockId, parsed.blocks.find(p => p.row === 2)!.id);
  assert.deepEqual(a.file.columns, [1, 2, 3]); assert.match(a.file.label, /表1·第2行/); assert.equal(a.file.page, undefined);
  const original = Array.from(fileContent(file).body); for (const c of chunks) assert.equal(original.slice(c.start, c.end).join(''), c.text);
});
