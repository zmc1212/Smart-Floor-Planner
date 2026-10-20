import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticXlsx, syntheticXlsxEntries, syntheticZip, syntheticDocx, syntheticFormattedXlsxEntries, syntheticDateXlsxEntries, syntheticTimeXlsxEntries } from '../../../../scripts/assistant-file-fixtures';
import { parseSourceFile, uploadedFile, fileChunks, fileContent, fileQuoteSpans } from '../knowledge/source-file';
import type { SourceFile } from '../contracts/source-file';

const parse = (entries = syntheticXlsxEntries()) => parseSourceFile(syntheticZip(entries), 'xlsx');
const changed = (file: string, from: string, to: string) => {
  const entries = syntheticXlsxEntries();
  assert.ok(entries[file].includes(from), 'Fixture mutation must reach the intended source');
  entries[file] = entries[file].replace(from, to); return entries;
};

test('XLSX preserves shared/rich strings, real coordinates, merged headers, units and same-sheet exceptions', async () => {
  const uploaded = uploadedFile({ fileName: '合成.XLSX', fileBase64: syntheticXlsx().toString('base64'), authorization: 'synthetic fixture' });
  assert.equal(uploaded.format, 'xlsx');
  const parsed = await parse();
  const row = parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 3)!;
  assert.ok(row); assert.equal(row.range, 'A3:D3'); assert.equal(row.table, undefined);
  assert.equal(row.cells?.find(c => c.ref === 'B3')?.text, '2');
  assert.equal(row.cells?.find(c => c.ref === 'C3')?.text, 'mm');
  assert.match(row.text, /A3: TEST-A/); assert.doesNotMatch(row.text, /not-source/);
  assert.match(row.headers!.join('\n'), /B1: 合成示例厚度与单位[\s\S]*B2: 数值 \| C2: 单位/);
  assert.match(row.notes!.join('\n'), /不据此确认验收。😀/);
  assert.equal(parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 1)?.cells?.[0].rowSpan, 2);
  assert.ok(parsed.blocks.some(b => b.sheet === '检查安排' && b.row === 2));
  assert.ok(parsed.blocks.every(b => b.page === undefined));
  const file: SourceFile = { version: 1, assetId: '1', hash: uploaded.hash, name: uploaded.name, format: 'xlsx', parsed,
    review: { adminId: '1', at: '2026-10-19T00:00:00Z', excluded: [] } };
  const chunks = await fileChunks(file, async text => [{ text, start: 0, end: Array.from(text).length, tokens: 150 }]);
  const chunk = chunks.find(c => c.file.sheet === '材料核对' && c.file.row === 3)!;
  assert.match(chunk.text, /地暖场景不能直接套用/); assert.match(chunk.text, /合成示例厚度与单位/);
  assert.match(chunk.file.label, /工作表「材料核对」.*A3:D3.*第3行/);
  assert.equal(chunk.file.range, 'A3:D3'); assert.equal(chunk.file.table, undefined);
  assert.equal(Array.from(fileContent(file).body).slice(chunk.start, chunk.end).join(''), chunk.text);
  const quote = '不据此确认验收。😀', span = fileQuoteSpans(chunk.text, quote, chunk.start).ranges[0];
  assert.equal(Array.from(fileContent(file).body).slice(span.start, span.end).join(''), quote);
  const other = chunks.find(c => c.file.sheet === '检查安排')!;
  assert.doesNotMatch(other.text, /地暖|TEST-A/, 'Never borrow headers/notes across worksheets');
  file.review!.excluded = [parsed.blocks.find(b => b.kind === 'footnote')!.id];
  assert.match(fileContent(file).body, /不据此确认验收/, 'Excluding a note block cannot strip necessary context from the table');
});

test('XLSX never executes formulas or presents stale cached answers as original numeric facts', async () => {
  for (const formula of ['<f>1+1</f><v>999</v>', '<f t="shared" si="0"/><v>2</v>', '<f>WEBSERVICE("https://example.invalid")</f>']) {
    await assert.rejects(parse(changed('xl/worksheets/sheet1.xml', '<v>2</v>', formula)), /knowledge_file_spreadsheet_formula/);
  }
});

test('XLSX refuses implicit locale dates, scientific/fraction/unknown formats instead of changing meaning', async () => {
  for (const numFmtId of ['14','11','12','165']) {
    await assert.rejects(parse(changed('xl/styles.xml', '<cellXfs count="1"><xf numFmtId="0"', `<cellXfs count="1"><xf numFmtId="${numFmtId}"`)), /knowledge_file_spreadsheet_number_format/);
  }
  await assert.rejects(parse(changed('xl/styles.xml', '<cellStyleXfs count="1"><xf numFmtId="0"', '<cellStyleXfs count="1"><xf numFmtId="14"')), /knowledge_file_spreadsheet_number_format/);
  for (const type of ['d','e']) await assert.rejects(parse(changed('xl/worksheets/sheet1.xml', '<c r="B3">', `<c r="B3" t="${type}">`)), /knowledge_file_complex_spreadsheet/);
});

test('XLSX formats percentages and explicit units, retaining raw values and exact format provenance through chunks', async () => {
  const entries = syntheticFormattedXlsxEntries(), parsed = await parse(entries);
  const row = parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 3)!;
  assert.equal(row.cells?.[1].text, '12.50%');
  assert.equal(row.cells?.[2].text, '2.35 mm');
  assert.deepEqual(row.cells?.[1].numberFormat, { raw: '0.125', id: 10, code: '0.00%' });
  assert.deepEqual(row.cells?.[2].numberFormat, { raw: '2.345', id: 164, code: '0.00" mm"' });
  assert.ok(parsed.warnings.includes('xlsx_number_display_requires_review'));
  assert.match(parsed.parser, /decimal-v1/);
  const uploaded = uploadedFile({ fileName: '合成显示.xlsx', fileBase64: syntheticZip(entries).toString('base64'), authorization: 'synthetic fixture' });
  const file: SourceFile = { version: 1, assetId: '1', hash: uploaded.hash, name: uploaded.name, format: 'xlsx', parsed,
    review: { adminId: '1', at: '2026-10-19T00:00:00Z', excluded: [] } };
  const chunks = await fileChunks(file, async text => [{ text, start: 0, end: Array.from(text).length, tokens: 150 }]);
  const chunk = chunks.find(c => c.file.row === 3)!;
  assert.match(chunk.text, /B3: 12\.50% \| C3: 2\.35 mm/);
  assert.match(chunk.text, /参考比例.*参考用量/); assert.match(chunk.text, /地暖场景不能直接套用/);
  assert.doesNotMatch(chunk.text, /0\.125|2\.345/, 'Model evidence uses displayed values; raw is review provenance only');
  const span = fileQuoteSpans(chunk.text, '12.50%', chunk.start).ranges[0];
  assert.equal(Array.from(fileContent(file).body).slice(span.start, span.end).join(''), '12.50%');
});

function numericEntries(value: string, code?: string, builtIn = 164) {
  const entries = syntheticXlsxEntries();
  const custom = code === undefined ? '' : `<numFmts count="1"><numFmt numFmtId="164" formatCode="${code.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')}"/></numFmts>`;
  entries['xl/styles.xml'] = entries['xl/styles.xml'].replace('<cellStyleXfs', custom + '<cellStyleXfs')
    .replace('<cellXfs count="1"><xf numFmtId="0" xfId="0"/></cellXfs>', `<cellXfs count="2"><xf numFmtId="0" xfId="0"/><xf numFmtId="${builtIn}" xfId="0"/></cellXfs>`);
  entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('<c r="B3"><v>2</v></c>', `<c r="B3" s="1"><v>${value}</v></c>`);
  return entries;
}
async function numeric(value: string, code?: string, id = 164) {
  return (await parse(numericEntries(value, code, id))).blocks.find(b => b.sheet === '材料核对' && b.row === 3)!.cells![1].text;
}

test('explicit full-year dates retain workbook date systems, original provenance, conditions and Unicode citations', async () => {
  for (const dateSystem of ['1900', '1904'] as const) {
    const entries = syntheticDateXlsxEntries(dateSystem), parsed = await parse(entries);
    const row = parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 3)!;
    assert.equal(row.cells![1].text, '2026-10-19'); assert.equal(row.cells![2].text, '2026年10月20日');
    assert.deepEqual(row.cells![1].numberFormat, { raw: dateSystem === '1900' ? '46314' : '44852', id: 164, code: 'yyyy-mm-dd', dateSystem });
    assert.match(parsed.parser, /decimal-v1:date-v1:time-v1$/); assert.ok(parsed.warnings.includes('xlsx_date_display_requires_review'));
    const file: SourceFile = { version: 1, assetId: '1', hash: 'synthetic', name: '合成日期.xlsx', format: 'xlsx', parsed,
      review: { adminId: '1', at: '2026-10-19T00:00:00Z', excluded: [] } };
    const chunks = await fileChunks(file, async text => [{ text, start: 0, end: Array.from(text).length, tokens: 150 }]);
    const chunk = chunks.find(c => c.file.row === 3 && c.file.sheet === '材料核对')!;
    assert.match(chunk.text, /B3: 2026-10-19 \| C3: 2026年10月20日/);
    assert.match(chunk.text, /合成参考日期/); assert.match(chunk.text, /地暖场景不能直接套用/);
    assert.doesNotMatch(chunk.text, /46314|44852|dateSystem/);
    assert.equal(chunk.file.range, 'A3:D3'); assert.equal(chunk.file.page, undefined);
    const span = fileQuoteSpans(chunk.text, '2026年10月20日', chunk.start).ranges[0];
    assert.equal(Array.from(fileContent(file).body).slice(span.start, span.end).join(''), '2026年10月20日');
  }
});

test('date displays use exact calendar boundaries including Excel leap-day discontinuity and the 1904 epoch', async () => {
  for (const [value, expected] of [['1','1900-01-01'],['59','1900-02-28'],['61','1900-03-01'],['36585','2000-02-29'],['2958465','9999-12-31'],['4.6314e4','2026-10-19'],['+46314.000','2026-10-19']]) {
    assert.equal(await numeric(value, 'yyyy-mm-dd'), expected);
  }
  for (const [value, expected] of [['0','1904-01-01'],['59','1904-02-29'],['60','1904-03-01'],['2957003','9999-12-31']]) {
    const entries = numericEntries(value, 'yyyy-mm-dd');
    entries['xl/workbook.xml'] = entries['xl/workbook.xml'].replace('<sheets>', '<workbookPr date1904="true"/><sheets>');
    assert.equal((await parse(entries)).blocks.find(b => b.row === 3)!.cells![1].text, expected);
  }
  for (const [code, expected] of [['yyyy/m/d','1900/1/1'],['yyyy.mm.dd','1900.01.01'],['yyyy-m-dd','1900-1-01'],['yyyy"年"m"月"d"日"','1900年1月1日']]) {
    assert.equal(await numeric('1', code), expected);
  }
});

test('compact date live fixture is a distinct two-row source with the complete local exception', async () => {
  const parsed = await parse(syntheticDateXlsxEntries('1904', true));
  assert.equal(parsed.blocks.length, 2);
  const row = parsed.blocks.find(b => b.row === 3)!;
  assert.equal(row.range, 'A3:D3'); assert.equal(row.cells![1].text, '2026-10-19');
  assert.equal(row.cells![1].numberFormat!.dateSystem, '1904');
  assert.match(row.text, /不代表项目安排或检查结果；地暖场景不能直接套用/);
  assert.match(row.headers!.join('\n'), /参考日期一.*参考日期二/);
});

test('date-only parsing rejects time fractions, false leap days, underflow, implicit locales and out-of-range dates', async () => {
  assert.equal(await numeric('46314', undefined, 0), '46314', 'General values never become inferred dates');
  for (const value of ['0','60','-1','46314.5','46314.00000000000001','1e-309','2958466']) {
    await assert.rejects(parse(numericEntries(value, 'yyyy-mm-dd')), /knowledge_file_spreadsheet_number_format/, value);
  }
  for (const value of ['-1','1e-309','2957004']) {
    const entries = numericEntries(value, 'yyyy-mm-dd');
    entries['xl/workbook.xml'] = entries['xl/workbook.xml'].replace('<sheets>', '<workbookPr date1904="1"/><sheets>');
    await assert.rejects(parse(entries), /knowledge_file_spreadsheet_number_format/);
  }
  for (const code of ['yy-mm-dd','mm-dd','m/d/yyyy','yyyy-mm-dd h:mm AM/PM','[$-804]yyyy-mm-dd','yyyy-mm-dd;@','yyyy-mmm-dd','yyyy-mm-dd"hidden"']) {
    await assert.rejects(parse(numericEntries('46314', code)), /knowledge_file_spreadsheet_number_format/, code);
  }
  for (const property of ['<workbookPr date1904="yes"/>','<workbookPr date1904="1"/><workbookPr date1904="0"/>']) {
    const entries = numericEntries('46314', 'yyyy-mm-dd'); entries['xl/workbook.xml'] = entries['xl/workbook.xml'].replace('<sheets>', property + '<sheets>');
    await assert.rejects(parse(entries), /knowledge_file_parse_failed/);
  }
  const iso = numericEntries('46314', 'yyyy-mm-dd');
  iso['xl/worksheets/sheet1.xml'] = iso['xl/worksheets/sheet1.xml'].replace('<c r="B3" s="1"><v>46314</v></c>', '<c r="B3" t="d"><v>2026-10-19</v></c>');
  await assert.rejects(parse(iso), /knowledge_file_complex_spreadsheet/, 'ISO date cell storage is outside this numeric-serial subset');
});

test('24-hour clocks preserve explicit hour padding and accepted whole-minute displays', async () => {
  for (const [value, code, expected] of [
    ['0','hh:mm:ss','00:00:00'],['0.375','h:mm','9:00'],['0.375','hh:mm','09:00'],
    ['0.3958333333333333','hh:mm','09:30'],['.5625','hh:mm:ss','13:30:00'],
    ['3.75e-1','h:mm:ss','9:00:00'],['+0.5000','hh:mm:ss','12:00:00'],
  ]) assert.equal(await numeric(value, code), expected);
  assert.equal(await numeric('0.375', undefined, 20), '9:00');
  assert.equal(await numeric('0.5625', undefined, 21), '13:30:00');
  assert.equal(await numeric('0.375', undefined, 0), '0.375', 'General numbers never become inferred clocks');
});

test('clock second rounding is decimal, with safe carry inside the same day only', async () => {
  for (const [value, expected] of [
    ['0.000005','00:00:00'],['0.000006','00:00:01'],['0.00125','00:01:48'],
    ['0.0416666666666667','01:00:00'],['0.999988425925926','23:59:59'],
  ]) assert.equal(await numeric(value, 'hh:mm:ss'), expected);
  assert.equal(await numeric('0.000005787037037037','hh:mm:ss'), '00:00:00');
  assert.equal(await numeric('0.0000057870370370371','hh:mm:ss'), '00:00:01');
});

test('explicit full dates and clocks preserve both epochs, original values, conditions and Unicode spans', async () => {
  for (const dateSystem of ['1900','1904'] as const) {
    const parsed = await parse(syntheticTimeXlsxEntries(dateSystem));
    const row = parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 3)!;
    assert.equal(row.cells![1].text, '2026-10-19 09:30:00');
    assert.equal(row.cells![2].text, '13:30:00');
    assert.deepEqual(row.cells![1].numberFormat, {raw: `${dateSystem === '1900' ? 46314 : 44852}.395833333336`, id: 164, code: 'yyyy-mm-dd hh:mm:ss', dateSystem});
    assert.deepEqual(row.cells![2].numberFormat, {raw:'0.5625', id:165, code:'hh:mm:ss'});
    assert.ok(parsed.warnings.includes('xlsx_date_display_requires_review'));
    assert.ok(parsed.warnings.includes('xlsx_time_display_requires_review'));
    assert.equal(parsed.blocks.length, 7, 'Retain the full two-sheet fixture');
    const file: SourceFile = { version: 1, assetId:'1', hash:'synthetic', name:'合成时刻.xlsx', format:'xlsx', parsed,
      review:{adminId:'1',at:'2026-10-19T00:00:00Z',excluded:[]} };
    const chunks = await fileChunks(file, async text => [{text,start:0,end:Array.from(text).length,tokens:150}]);
    const chunk = chunks.find(c => c.file.sheet === '材料核对' && c.file.row === 3)!;
    assert.match(chunk.text, /2026-10-19 09:30:00 \| C3: 13:30:00/);
    assert.match(chunk.text, /地暖场景不能直接套用/); assert.doesNotMatch(chunk.text, /395833333336|0\.5625|dateSystem/);
    const span = fileQuoteSpans(chunk.text,'2026-10-19 09:30:00',chunk.start).ranges[0];
    assert.equal(Array.from(fileContent(file).body).slice(span.start,span.end).join(''), '2026-10-19 09:30:00');
  }
  assert.equal(await numeric('46314.375','yyyy"年"m"月"d"日" h:mm'), '2026年10月19日 9:00');
  assert.equal(await numeric('59.5','yyyy/mm/dd hh:mm:ss'), '1900/02/28 12:00:00');
  assert.equal(await numeric('61.5','yyyy.mm.dd hh:mm:ss'), '1900.03.01 12:00:00');
});

test('unsupported or misleading clocks fail instead of hiding days, seconds, invalid dates or zones', async () => {
  for (const value of ['-0.5','1','1.5','0.9999999999999999','1e-309','0.123456789012345678']) {
    await assert.rejects(parse(numericEntries(value,'hh:mm:ss')), /knowledge_file_spreadsheet_number_format/, value);
  }
  for (const value of ['0.00035','0.5001']) await assert.rejects(parse(numericEntries(value,'hh:mm')), /knowledge_file_spreadsheet_number_format/, 'Do not silently hide nonzero seconds');
  for (const value of ['0.5','60.5','46314.9999999999','2958466','-1']) await assert.rejects(parse(numericEntries(value,'yyyy-mm-dd hh:mm:ss')), /knowledge_file_spreadsheet_number_format/, value);
  for (const code of ['[h]:mm:ss','mm:ss','h:mm AM/PM','hh:mm:ss.000','[$-804]hh:mm','yyyy-mm-ddThh:mm:ss','hh:mm:ss"Z"','hh:mm:ss;@','yyyy-mm-dd  hh:mm']) {
    await assert.rejects(parse(numericEntries('0.5',code)), /knowledge_file_spreadsheet_number_format/, code);
  }
  const entries = numericEntries('0.5', 'yyyy-mm-dd hh:mm:ss');
  entries['xl/workbook.xml'] = entries['xl/workbook.xml'].replace('<sheets>', '<workbookPr date1904="1"/><sheets>');
  assert.equal((await parse(entries)).blocks.find(b=>b.row===3)!.cells![1].text, '1904-01-01 12:00:00');
});

test('supported built-in formats preserve precision, grouping and percentage scaling', async () => {
  for (const [id,value,expected] of [[1,'2.5','3'],[2,'1.005','1.01'],[3,'12345.5','12,346'],[4,'12345.678','12,345.68'],[9,'0.125','13%'],[10,'0.125','12.50%']] as const) {
    assert.equal(await numeric(value, undefined, id), expected);
  }
});

test('custom quoted/escaped literals and decimal rounding never use binary floating point arithmetic', async () => {
  const cases = [
    ['-1.005','0.00','-1.01'],['0.00005','0.00%','0.01%'],['2.675','0.00" mm"','2.68 mm'],
    ['1234.5','"¥"#,##0.00','¥1,234.50'],['1.2e3','0.00','1200.00'],['7','00000','00007'],
    ['0','0.000','0.000'],['-0','0.00','0.00'],
    ['2.345','0.00\\m\\m','2.35mm'],['0.125','0.000"%"','0.125%'],['0.125','0.000\\%','0.125%'],
    ['123456789012345','0','123456789012345'],['999.995','#,##0.00','1,000.00'],
  ];
  for (const [value,code,expected] of cases) assert.equal(await numeric(value, code), expected, `${value} / ${code}`);
});

test('numeric cells inherit unambiguous cell, row, column and base styles without changing precedence', async () => {
  for (const target of ['row','column','base']) {
    const entries = numericEntries('0.125', undefined, 10);
    entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('r="B3" s="1"', 'r="B3"');
    if (target === 'row') entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('<row r="3">', '<row r="3" s="1" customFormat="1">');
    else if (target === 'column') entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('<sheetData>', '<cols><col min="2" max="2" style="1"/></cols><sheetData>');
    else entries['xl/styles.xml'] = entries['xl/styles.xml'].replace('<cellStyleXfs count="1"><xf numFmtId="0"', '<cellStyleXfs count="1"><xf numFmtId="10"').replace('<cellXfs count="2"><xf numFmtId="0"', '<cellXfs count="2"><xf');
    assert.equal((await parse(entries)).blocks.find(b => b.sheet === '材料核对' && b.row === 3)!.cells![1].text, '12.50%');
  }
  const explicit = numericEntries('0.125', undefined, 10);
  explicit['xl/worksheets/sheet1.xml'] = explicit['xl/worksheets/sheet1.xml'].replace('<row r="3">','<row r="3" s="0" customFormat="1">');
  assert.equal((await parse(explicit)).blocks.find(b => b.row === 3)!.cells![1].text, '12.50%');
});

test('conditional, locale, hidden and multi-section display codes fail without losing conditions or units', async () => {
  for (const code of ['0.00;[Red](0.00)',';;;','0.00,','[>=100]0.0','[$-804]0.00','0.0E+00','# ?/?','yyyy-mm-dd hh:mm','0.00_);(0.00)','0.00* ','0.#######','0.0000000','"hidden"','0.00"unterminated','0.00%0']) {
    await assert.rejects(parse(numericEntries('1.005', code)), /knowledge_file_spreadsheet_number_format/, code);
  }
  const text = numericEntries('2', '0;0;0;"suppressed"');
  text['xl/worksheets/sheet1.xml'] = text['xl/worksheets/sheet1.xml'].replace('<c r="B3" s="1"><v>2</v></c>', '<c r="B3" s="1" t="inlineStr"><is><t>necessary condition</t></is></c>');
  await assert.rejects(parse(text), /knowledge_file_spreadsheet_number_format/);
});

test('ambiguous style inheritance, invalid style references and duplicate custom formats fail explicitly', async () => {
  const variants = [
    ['<xf numFmtId="10" xfId="0"/>','<xf numFmtId="10" xfId="0" applyNumberFormat="0"/>'],
    ['<xf numFmtId="10" xfId="0"/>','<xf numFmtId="10" xfId="9"/>'],
    ['<xf numFmtId="10" xfId="0"/>','<xf numFmtId="-1" xfId="0"/>'],
  ];
  for (const [from,to] of variants) {
    const entries = numericEntries('0.125', undefined, 10); entries['xl/styles.xml'] = entries['xl/styles.xml'].replace(from,to);
    await assert.rejects(parse(entries), /knowledge_file_spreadsheet_number_format|knowledge_file_parse_failed/);
  }
  const duplicate = numericEntries('2','0.00'); duplicate['xl/styles.xml'] = duplicate['xl/styles.xml'].replace('</numFmts>','<numFmt numFmtId="164" formatCode="0%"/></numFmts>');
  await assert.rejects(parse(duplicate), /knowledge_file_spreadsheet_number_format/);
  await assert.rejects(parse(numericEntries('1e-309','0.00')), /knowledge_file_spreadsheet_number_format/);
  await assert.rejects(parse(numericEntries('9007199254740993','0')), /knowledge_file_spreadsheet_number_format/);
  await assert.rejects(parse(numericEntries('-0.004','0.00')), /knowledge_file_spreadsheet_number_format/);
});

test('hidden workbook content is an explicit failure, including zero-size rows/columns', async () => {
  const variants = [
    changed('xl/workbook.xml', 'name="检查安排"', 'name="检查安排" state="veryHidden"'),
    changed('xl/worksheets/sheet1.xml', '<row r="3">', '<row r="3" hidden="1">'),
    changed('xl/worksheets/sheet1.xml', '<row r="3">', '<row r="3" ht="0">'),
    changed('xl/worksheets/sheet1.xml', '<row r="3">', '<row r="3" ht="0.00">'),
    changed('xl/worksheets/sheet1.xml', '<sheetData>', '<cols><col min="1" max="4" hidden="true"/></cols><sheetData>'),
    changed('xl/worksheets/sheet1.xml', '<sheetData>', '<cols><col min="1" max="4" width="0.0"/></cols><sheetData>'),
    changed('xl/worksheets/sheet1.xml', '<sheetData>', '<sheetFormatPr zeroHeight="1"/><sheetData>'),
  ];
  for (const entries of variants) await assert.rejects(parse(entries), /knowledge_file_spreadsheet_hidden/);
});

test('unknown formats, malformed relationships/shared strings and lost annotation structures do not silently parse', async () => {
  await assert.rejects(parseSourceFile(syntheticDocx(), 'xlsx'), /knowledge_file_invalid/);
  await assert.rejects(parse(changed('[Content_Types].xml', 'spreadsheetml.sheet.main+xml', 'ms-excel.sheet.macroEnabled.main+xml')), /knowledge_file_invalid/);
  await assert.rejects(parse(changed('xl/worksheets/sheet1.xml', '<v>0</v>', '<v>999</v>')), /knowledge_file_parse_failed/);
  await assert.rejects(parse(changed('xl/_rels/workbook.xml.rels', 'Target="worksheets/sheet1.xml"', 'Target="https://example.invalid/sheet.xml" TargetMode="External"')), /knowledge_file_unsafe_archive/);
  for (const name of ['xl/comments1.xml','xl/externalLinks/externalLink1.xml','xl/pivotTables/pivotTable1.xml','xl/embeddings/object.bin','xl/vbaProject.bin']) {
    await assert.rejects(parse({ ...syntheticXlsxEntries(), [name]: 'unsupported' }), /knowledge_file_complex_spreadsheet|knowledge_file_unsafe_archive/);
  }
  await assert.rejects(parse(changed('xl/worksheets/sheet1.xml', '<worksheet ', '<!DOCTYPE worksheet><worksheet ')), /knowledge_file_unsafe_archive/);
  const entries = changed('xl/worksheets/sheet1.xml', '<sheetData>', '<tableParts count="1"/><sheetData>');
  await assert.rejects(parse(entries), /knowledge_file_complex_spreadsheet/);
});

test('cell/range limits and conflicting merges fail without truncating necessary original conditions', async () => {
  for (const [from,to] of [['r="B3"','r="M3"'],['r="B3"','r="B65"'],['ref="A1:A2"','ref="A1:M2"'],['ref="B1:C1"','ref="A1:C1"'],['ref="B1:C1"','ref="B1:D1"']]) {
    await assert.rejects(parse(changed('xl/worksheets/sheet1.xml', from, to)), /knowledge_file_complex_spreadsheet|knowledge_file_parse_failed/);
  }
  const entries = changed('xl/workbook.xml', '</sheets>', Array.from({length:7},(_,i)=>`<sheet name="多余${i}" sheetId="${i+3}" r:id="extra${i}"/>`).join('')+'</sheets>');
  await assert.rejects(parse(entries), /knowledge_file_resource_limit/);
});

test('orphaned or duplicate shared-string/style relationships cannot invent visible workbook facts', async () => {
  await assert.rejects(parse(changed('xl/_rels/workbook.xml.rels', 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"', 'Type="unrecognized"')), /knowledge_file_parse_failed/);
  const entries = changed('xl/_rels/workbook.xml.rels', '</Relationships>', '<Relationship Id="duplicate" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  await assert.rejects(parse(entries), /knowledge_file_parse_failed/);
});

test('unknown namespaced attributes cannot spoof a visible cell coordinate or worksheet relationship', async () => {
  const entries = changed('xl/worksheets/sheet1.xml', '<worksheet ', '<worksheet xmlns:extra="urn:synthetic-ignored" ');
  entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('<c r="B3">', '<c r="B3" extra:r="L3">');
  entries['xl/workbook.xml'] = entries['xl/workbook.xml'].replace('<workbook ', '<workbook xmlns:extra="urn:synthetic-ignored" ').replace('r:id="one"', 'r:id="one" extra:id="two"');
  const parsed = await parse(entries), row = parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 3)!;
  assert.equal(row.range, 'A3:D3'); assert.equal(row.cells?.find(c => c.ref === 'B3')?.text, '2');
  assert.ok(parsed.blocks.some(b => b.sheet === '检查安排' && b.row === 2));
});

test('unsupported SpreadsheetML escapes fail instead of becoming literal source text or false sheet names', async () => {
  await assert.rejects(parse(changed('xl/sharedStrings.xml', '地暖场景', '_x5730_暖场景')), /knowledge_file_complex_spreadsheet/);
  await assert.rejects(parse(changed('xl/workbook.xml', 'name="材料核对"', 'name="_x6750_料核对"')), /knowledge_file_complex_spreadsheet/);
});

test('sparse cells retain actual row/column identity and merged body conditions identify their original anchor', async () => {
  const entries = changed('xl/worksheets/sheet2.xml', '<row r="2">', '<row r="7">');
  entries['xl/worksheets/sheet2.xml'] = entries['xl/worksheets/sheet2.xml'].replaceAll('r="A2"','r="A7"').replaceAll('r="B2"','r="C7"');
  const parsed = await parse(entries), row = parsed.blocks.find(b => b.sheet === '检查安排' && b.row === 7)!;
  assert.equal(row.range, 'A7:C7'); assert.equal(row.cells![1].text, ''); assert.match(row.text, /C7: 合成资料/);
  const merged = changed('xl/worksheets/sheet1.xml', '<mergeCells count="4">', '<mergeCells count="5"><mergeCell ref="A3:A4"/>');
  merged['xl/worksheets/sheet1.xml'] = merged['xl/worksheets/sheet1.xml'].replace('<c r="A4" t="s"><v>7</v></c>', '');
  const fourth = (await parse(merged)).blocks.find(b => b.sheet === '材料核对' && b.row === 4)!;
  assert.match(fourth.notes!.join('\n'), /合并单元格 A3:A4: TEST-A/); assert.equal(fourth.cells![0].text, '');
});
