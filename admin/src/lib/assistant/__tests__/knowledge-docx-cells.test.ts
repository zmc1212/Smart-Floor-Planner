import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellDocx, historicalCellProperties as history } from '../../../../scripts/assistant-docx-cell-fixtures';
import { fileChunks, fileContent, parseSourceFile } from '../knowledge/source-file';
import type { SourceFile } from '../contracts/source-file';

const span = (value: string) => `<w:gridSpan w:val="${value}"/>`;
const merge = (value?: string) => value === undefined ? '<w:vMerge/>' : `<w:vMerge w:val="${value}"/>`;
const original = (propertySets?: string[]) => cellDocx([
  [{ text: '材料与条件' }, { text: '示例厚度（mm）' }],
  [{ text: 'SYNTHETIC-A；仅适用合成A基层', propertySets, footnote: true }, { text: '2 mm，须核对厂家资料' }],
]);

test('historical horizontal spans do not shift current cell or following-column locators', async () => {
  const parsed = await parseSourceFile(original([history(span('2'))]), 'docx');
  assert.deepEqual(parsed.blocks.find(b => b.row === 2)?.cells?.map(c => [c.column, c.span]), [[1, 1], [2, 1]]);
});
test('historical vertical merges do not mark an unmerged current cell', async () => {
  const parsed = await parseSourceFile(original([history(merge('restart'))]), 'docx');
  assert.equal(parsed.blocks.find(b => b.row === 2)?.cells?.[0].merge, undefined);
});
test('unsupported or ambiguous historical values cannot reject valid current cells', async () => {
  const parsed = await parseSourceFile(original([history(span('13') + span('1') + merge('past'))]), 'docx');
  assert.deepEqual(parsed.blocks.find(b => b.row === 2)?.cells?.map(c => [c.column, c.span, c.merge]), [[1, 1, undefined], [2, 1, undefined]]);
});
test('current spans and vertical merge markers survive revision history without inheriting text', async () => {
  const parsed = await parseSourceFile(cellDocx([
    [{ text: '材料' }, { text: '条件' }, { text: '示例厚度（mm）' }],
    [{ text: 'SYNTHETIC-A', propertySets: [span('2') + merge('restart') + history(span('1'))] }, { text: '2 mm' }],
    [{ text: '', propertySets: [span('+02') + merge() + history(merge('restart'))] }, { text: '仅合成A基层' }],
    [{ text: '', propertySets: [span('2') + merge('continue')] }, { text: '先核对厂家资料' }],
  ]), 'docx');
  for (const row of parsed.blocks.filter(b => (b.row ?? 0) > 1)) assert.deepEqual(row.cells?.map(c => [c.column, c.span]), [[1, 2], [3, 1]]);
  assert.deepEqual(parsed.blocks.filter(b => (b.row ?? 0) > 1).map(b => b.cells?.[0].merge), ['restart', 'continue', 'continue']);
  assert.equal(parsed.blocks.find(b => b.row === 3)?.cells?.[0].text, '');
});
test('absent current cell properties keep one-column defaults', async () => {
  const parsed = await parseSourceFile(original(), 'docx');
  assert.deepEqual(parsed.blocks.find(b => b.row === 2)?.cells?.map(c => [c.column, c.span, c.merge]), [[1, 1, undefined], [2, 1, undefined]]);
});
for (const [name, propertySets] of [
  ['multiple current property sets', [span('1'), span('2')]],
  ['duplicate current spans', [span('1') + span('2')]],
  ['duplicate current merges', [merge('restart') + merge('continue')]],
] as const) test(`DOCX rejects ${name} rather than selecting one`, async () => {
  await assert.rejects(parseSourceFile(original([...propertySets]), 'docx'), /knowledge_file_invalid/);
});
for (const [name, marker] of [
  ['missing span value', '<w:gridSpan/>'], ['empty span value', span('')],
  ['exponent span', span('2e0')], ['hexadecimal span', span('0x2')], ['fractional spelling', span('2.0')],
  ['empty merge value', merge('')], ['unknown merge value', merge('past')],
] as const) test(`DOCX rejects ${name} without inventing a cell location`, async () => {
  await assert.rejects(parseSourceFile(original([marker]), 'docx'), /knowledge_file_invalid/);
});
for (const value of ['0', '13']) test(`DOCX retains its bounded-column rejection for span ${value}`, async () => {
  await assert.rejects(parseSourceFile(original([span(value)]), 'docx'), /knowledge_file_complex_table/);
});
test('current cell positions reach row citations with complete units, conditions, notes and Unicode offsets', async () => {
  const parsed = await parseSourceFile(original([history(span('2') + merge('restart'))]), 'docx');
  const file: SourceFile = { version: 1, assetId: 'synthetic-cell', hash: 'b'.repeat(64), name: '合成单元格.docx', format: 'docx', parsed,
    review: { adminId: '1', at: '2026-10-19T00:00:00Z', excluded: [] } };
  const chunks = await fileChunks(file, async text => [{ text, start: 0, end: Array.from(text).length, tokens: 100 }]);
  const row = chunks.find(c => c.file.row === 2)!;
  assert.deepEqual(row.file.columns, [1, 2]);
  assert.match(row.file.label, /表1·第2行/); assert.match(row.file.label, /列1、2$/); assert.doesNotMatch(row.file.label, /列1–2、3/);
  assert.match(row.text, /示例厚度（mm）/); assert.match(row.text, /2 mm，须核对厂家资料/);
  assert.match(row.text, /仅适用合成A基层/); assert.match(row.text, /合成脚注😀/); assert.match(row.text, /不形成验收或施工批准/);
  assert.equal(row.file.parser, 'xiaok-file-v1.3:docx:yauzl3.4.0:saxes6.0.0'); assert.equal(row.file.page, undefined);
  assert.equal(Array.from(fileContent(file).body).slice(row.start, row.end).join(''), row.text);
});
