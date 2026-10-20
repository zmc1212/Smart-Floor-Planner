// Bounded SpreadsheetML extraction inside the existing credential-free parser process.
// No formula evaluation, cached formula answers, external fetches or invented display units.
import path from 'node:path';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const bad = code => { throw new Error(code); };
const elements = n => n.children.filter(c => typeof c !== 'string');
const children = (n, name, uri = MAIN) => elements(n).filter(c => c.name === name && c.uri === uri);
const all = (n, name, uri = MAIN) => elements(n).flatMap(c => [...(c.name === name && c.uri === uri ? [c] : []), ...all(c, name, uri)]);
const plain = n => n.children.map(c => typeof c === 'string' ? c : plain(c)).join('');
const truthy = v => v === '1' || v === 'true';
const zeroSize = v => v !== undefined && Number(v) === 0;
const letter = column => String.fromCharCode(64 + column);
// Deliberately bounded number-display subset. Only explicit full-year date
// patterns and bounded 24-hour clocks are supported; implicit locale dates,
// elapsed time and formula caches fail.
// See Microsoft SpreadsheetML numFmt and xf; no workbook calculation engine.
const builtInFormats = new Map([[0,'General'],[1,'0'],[2,'0.00'],[3,'#,##0'],[4,'#,##0.00'],[9,'0%'],[10,'0.00%'],[20,'h:mm'],[21,'h:mm:ss'],[49,'@']]);
function unsigned(value, fallback = 0) {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(value) || Number(value) > 65535) bad('knowledge_file_parse_failed');
  return Number(value);
}
function displayPattern(code) {
  if (code === 'General' || code === '@') return { code };
  if (!code || code.length > 128) bad('knowledge_file_spreadsheet_number_format');
  const dateTime = /^(.*?) (hh?):mm(:ss)?$/.exec(code);
  const clock = /^(hh?):mm(:ss)?$/.exec(code);
  const dateCode = dateTime ? dateTime[1] : code;
  const date = /^yyyy([-/.])(mm?)\1(dd?)$/.exec(dateCode);
  const chineseDate = /^yyyy"年"(mm?)"月"(dd?)"日"$/.exec(dateCode);
  const time = dateTime || clock;
  if (date || chineseDate || clock) return { code, date: Boolean(date || chineseDate),
    separator: date?.[1], monthDigits: (date?.[2] || chineseDate?.[1])?.length,
    dayDigits: (date?.[3] || chineseDate?.[2])?.length,
    ...(time ? { time: true, hourDigits: time[dateTime ? 2 : 1].length, seconds: Boolean(time[dateTime ? 3 : 2]) } : {}) };
  let prefix = '', suffix = '', pattern = '', after = false;
  for (let i = 0; i < code.length;) {
    let literal;
    if (code[i] === '"') {
      const end = code.indexOf('"', i + 1);
      if (end < 0) bad('knowledge_file_spreadsheet_number_format');
      literal = code.slice(i + 1, end); i = end + 1;
    } else if (code[i] === '\\' && i + 1 < code.length) {
      literal = code[i + 1]; i += 2;
    } else if (code[i] === ' ') { literal = ' '; i++; }
    else if (!after && /[0#,.%]/.test(code[i])) {
      while (i < code.length && /[0#,.%]/.test(code[i])) pattern += code[i++];
      after = true; continue;
    } else bad('knowledge_file_spreadsheet_number_format');
    if (/[\x00-\x1f\x7f]/.test(literal)) bad('knowledge_file_spreadsheet_number_format');
    if (after) suffix += literal; else prefix += literal;
  }
  const match = /^(0{1,12}|#,##0)(?:\.(0{1,6}))?(%)?$/.exec(pattern);
  if (!match) bad('knowledge_file_spreadsheet_number_format');
  return { code, prefix, suffix, digits: (match[2] || '').length, minInteger: match[1] === '#,##0' ? 1 : match[1].length,
    group: match[1] === '#,##0', percent: Boolean(match[3]) };
}
function numberDisplay(raw, format, dateSystem) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) bad('knowledge_file_parse_failed');
  if (format.code === 'General') return raw; // Preserve the original bounded General path, independent of column width.
  if (format.code === '@' || raw.length > 128) bad('knowledge_file_spreadsheet_number_format');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  const exponent = Number(match[4] || 0), fraction = match[3] || '';
  if (Math.abs(exponent) > 308) bad('knowledge_file_spreadsheet_number_format');
  const coefficient = BigInt((match[2] + fraction) || '0');
  // Excel may serialize a clock fraction with up to 17 significant digits.
  // Keep its original decimal and round only the displayed clock to a second.
  if (coefficient.toString().replace(/0+$/, '').length > (format.time ? 17 : 15)) bad('knowledge_file_spreadsheet_number_format');
  if (format.date || format.time) {
    const shift = exponent - fraction.length;
    const divisor = shift < 0 ? 10n ** BigInt(-shift) : 1n;
    const numerator = shift < 0 ? coefficient : coefficient * 10n ** BigInt(shift);
    const serial = numerator / divisor, remainder = numerator % divisor;
    if (match[1] === '-' && coefficient !== 0n || !format.time && remainder) bad('knowledge_file_spreadsheet_number_format');
    let clock = '';
    if (format.time) {
      // Clock-only values cannot hide whole days; elapsed durations are not a
      // time of day. Reject midnight carry rather than invent a source date.
      if (!format.date && serial !== 0n) bad('knowledge_file_spreadsheet_number_format');
      const scaled = remainder * 86400n;
      const seconds = scaled / divisor + (scaled % divisor * 2n >= divisor ? 1n : 0n);
      if (seconds >= 86400n || !format.seconds && seconds % 60n !== 0n) bad('knowledge_file_spreadsheet_number_format');
      clock = `${String(seconds / 3600n).padStart(format.hourDigits, '0')}:${String(seconds / 60n % 60n).padStart(2, '0')}`;
      if (format.seconds) clock += ':' + String(seconds % 60n).padStart(2, '0');
      if (!format.date) return clock;
    }
    // Date-only formats still reject hidden time fractions. UTC avoids host
    // timezone/DST changing the source calendar; a clock has no inferred zone.
    const is1904 = dateSystem === '1904';
    // Excel's serial 60 is a fictitious 1900-02-29; never invent a real date.
    if (serial < (is1904 ? 0n : 1n) || serial > (is1904 ? 2957003n : 2958465n)
      || !is1904 && serial === 60n) bad('knowledge_file_spreadsheet_number_format');
    const epoch = is1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const days = Number(serial) - (!is1904 && serial > 60n ? 1 : 0);
    const date = new Date(epoch + days * 86400000);
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(format.monthDigits, '0');
    const day = String(date.getUTCDate()).padStart(format.dayDigits, '0');
    const calendar = format.separator ? [year, month, day].join(format.separator) : `${year}年${month}月${day}日`;
    return calendar + (format.time ? ' ' + clock : '');
  }
  const shift = exponent - fraction.length + format.digits + (format.percent ? 2 : 0);
  // Decimal integer arithmetic prevents floating point rounding from losing a
  // displayed unit/percentage boundary (e.g. 1.005 with 0.00 -> 1.01).
  let rounded;
  if (shift >= 0) rounded = coefficient * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    rounded = coefficient / divisor + (coefficient % divisor * 2n >= divisor ? 1n : 0n);
  }
  // Do not erase a nonzero negative sign at the display precision boundary.
  // Signed rounded-zero rendering is outside this verified display subset.
  if (match[1] === '-' && coefficient !== 0n && rounded === 0n) bad('knowledge_file_spreadsheet_number_format');
  const digits = rounded.toString().padStart(format.digits + 1, '0');
  let whole = (format.digits ? digits.slice(0, -format.digits) : digits).padStart(format.minInteger, '0');
  if (format.group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimal = format.digits ? '.' + digits.slice(-format.digits) : '';
  return (match[1] === '-' && rounded !== 0n ? '-' : '') + format.prefix + whole + decimal + (format.percent ? '%' : '') + format.suffix;
}
function cellRef(ref) {
  const match = /^([A-L])([1-9]\d*)$/.exec(ref || '');
  if (!match || Number(match[2]) > 64) bad('knowledge_file_complex_spreadsheet');
  return { column: match[1].charCodeAt(0) - 64, row: Number(match[2]) };
}
function rangeRef(ref) {
  const parts = (ref || '').split(':');
  if (parts.length > 2) bad('knowledge_file_complex_spreadsheet');
  const start = cellRef(parts[0]), end = cellRef(parts[1] || parts[0]);
  if (start.row > end.row || start.column > end.column) bad('knowledge_file_complex_spreadsheet');
  return { start, end, ref: parts.length === 1 ? parts[0] : parts.join(':') };
}
// Phonetic annotations are not a second occurrence of the source string.
function stringValue(n) {
  return elements(n).map(c => c.uri !== MAIN || ['rPh','phoneticPr','rPr'].includes(c.name) ? ''
    : c.name === 't' ? plain(c) : c.name === 'r' ? stringValue(c) : bad('knowledge_file_complex_spreadsheet')).join('');
}
function relationships(root) {
  const result = new Map();
  for (const n of all(root, 'Relationship', REL)) {
    if (!n.attrs.Id || result.has(n.attrs.Id)) bad('knowledge_file_parse_failed');
    result.set(n.attrs.Id, n.attrs);
  }
  return result;
}
function localTarget(rel, base) {
  if (!rel || rel.TargetMode === 'External' || /[\\?#%]|^[a-z]+:/i.test(rel.Target || '')) bad('knowledge_file_unsafe_archive');
  return rel.Target?.startsWith('/') ? path.posix.normalize(rel.Target).slice(1) : path.posix.normalize(path.posix.join(base, rel.Target || ''));
}

export async function parseXlsx(bytes, { unzip, xml }) {
  const { files, names } = await unzip(bytes, 'xlsx');
  const read = name => { if (!files.has(name)) bad('knowledge_file_parse_failed'); return xml(files.get(name)); };
  if (!files.has('[Content_Types].xml') || !files.has('xl/workbook.xml')) bad('knowledge_file_invalid');
  const contentTypes = read('[Content_Types].xml');
  const workbookType = all(contentTypes, 'Override', 'http://schemas.openxmlformats.org/package/2006/content-types')
    .find(n => n.attrs.PartName === '/xl/workbook.xml');
  if (workbookType?.attrs.ContentType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml') bad('knowledge_file_invalid');
  // Comments and calculated/connected tables can carry conditions missing from cell values.
  if ([...names].some(n => /^xl\/(?:externalLinks|pivotTables|pivotCache|queryTables|comments|threadedComments|connections|metadata)/i.test(n))) bad('knowledge_file_complex_spreadsheet');
  const packageRels = relationships(read('_rels/.rels'));
  const office = [...packageRels.values()].filter(r => r.Type === TYPE + 'officeDocument');
  if (office.length !== 1 || localTarget(office[0], '') !== 'xl/workbook.xml') bad('knowledge_file_invalid');
  const workbook = read('xl/workbook.xml'), rels = relationships(read('xl/_rels/workbook.xml.rels'));
  if (!all(workbook, 'workbook').length || all(workbook, 'externalReferences').length || all(workbook, 'extLst').length) bad('knowledge_file_complex_spreadsheet');
  const properties = children(all(workbook, 'workbook')[0], 'workbookPr');
  const date1904 = properties[0]?.attrs.date1904;
  if (properties.length > 1 || date1904 !== undefined && !['0','1','false','true'].includes(date1904)) bad('knowledge_file_parse_failed');
  const dateSystem = truthy(date1904) ? '1904' : '1900';
  for (const r of rels.values()) {
    const target = localTarget(r, 'xl');
    if (r.Type === TYPE + 'sharedStrings' && target !== 'xl/sharedStrings.xml'
      || r.Type === TYPE + 'styles' && target !== 'xl/styles.xml') bad('knowledge_file_complex_spreadsheet');
  }
  for (const part of ['sharedStrings','styles']) {
    const linked = [...rels.values()].filter(r => r.Type === TYPE + part);
    if (linked.length > 1 || files.has(`xl/${part}.xml`) !== Boolean(linked.length)) bad('knowledge_file_parse_failed');
  }
  const sheets = all(workbook, 'sheet');
  if (!sheets.length || sheets.length > 8) bad('knowledge_file_resource_limit');
  const strings = files.has('xl/sharedStrings.xml') ? all(read('xl/sharedStrings.xml'), 'si').map(stringValue) : [];
  const styleRoot = files.has('xl/styles.xml') ? read('xl/styles.xml') : null;
  const styles = styleRoot ? children(all(styleRoot, 'cellXfs')[0] || { children: [] }, 'xf') : [];
  const baseStyles = styleRoot ? children(all(styleRoot, 'cellStyleXfs')[0] || { children: [] }, 'xf') : [];
  if (styleRoot && !styles.length) bad('knowledge_file_parse_failed');
  const customFormats = new Map();
  if (styleRoot) for (const node of all(styleRoot, 'numFmt')) {
    const id = unsigned(node.attrs.numFmtId);
    if (id < 164 || customFormats.has(id) || !node.attrs.formatCode) bad('knowledge_file_spreadsheet_number_format');
    customFormats.set(id, node.attrs.formatCode);
  }
  const formats = new Map();
  const cellFormat = (cell, row, columns, column) => {
    const columnStyles = columns.filter(c => Number(c.attrs.min) <= column && Number(c.attrs.max) >= column).map(c => c.attrs.style ?? '0');
    if (new Set(columnStyles).size > 1) bad('knowledge_file_spreadsheet_number_format');
    const styleId = unsigned(cell.attrs.s ?? (truthy(row.attrs.customFormat) ? row.attrs.s : undefined) ?? columnStyles[0]);
    const style = styles[styleId];
    if ((styleId !== 0 || styles.length) && !style) bad('knowledge_file_parse_failed');
    const baseId = unsigned(style?.attrs.xfId), base = baseStyles[baseId];
    if ((baseId !== 0 || baseStyles.length) && !base) bad('knowledge_file_parse_failed');
    const inherited = unsigned(base?.attrs.numFmtId), id = unsigned(style?.attrs.numFmtId, inherited);
    // Do not guess between conflicting explicit disabled/inherited formats.
    if (id !== inherited && (['0','false'].includes(style?.attrs.applyNumberFormat)
      || inherited !== 0 && !truthy(style?.attrs.applyNumberFormat))) bad('knowledge_file_spreadsheet_number_format');
    if (!formats.has(id)) formats.set(id, displayPattern(customFormats.get(id) ?? builtInFormats.get(id)));
    return { ...formats.get(id), id };
  };
  const blocks = [], warnings = new Set(['xlsx_headers_and_notes_require_review','xlsx_formatting_not_interpreted']);
  if ([...names].some(n => /^xl\/(?:drawings|charts|media)\//.test(n))) warnings.add('images_not_parsed');
  const seenSheets = new Set(), seenPaths = new Set();
  for (const sheet of sheets) {
    const name = sheet.attrs.name, relation = rels.get(sheet.relationshipId), target = localTarget(relation, 'xl');
    if (!name || Array.from(name).length > 31 || /[\x00-\x1f\[\]*?:/\\]/u.test(name) || seenSheets.has(name.toLowerCase())) bad('knowledge_file_parse_failed');
    if (/_x[0-9a-f]{4}_/i.test(name)) bad('knowledge_file_complex_spreadsheet');
    seenSheets.add(name.toLowerCase());
    if (sheet.attrs.state && sheet.attrs.state !== 'visible') bad('knowledge_file_spreadsheet_hidden');
    if (relation.Type !== TYPE + 'worksheet' || !/^xl\/worksheets\/[\w.-]+\.xml$/.test(target) || seenPaths.has(target)) bad('knowledge_file_complex_spreadsheet');
    seenPaths.add(target);
    const root = read(target), worksheet = all(root, 'worksheet')[0];
    if (!worksheet || all(root, 'extLst').length || all(root, 'conditionalFormatting').length || all(root, 'tableParts').length) bad('knowledge_file_complex_spreadsheet');
    if (all(root, 'f').length) bad('knowledge_file_spreadsheet_formula');
    const format = all(root, 'sheetFormatPr')[0];
    if (truthy(format?.attrs.zeroHeight) || zeroSize(format?.attrs.defaultRowHeight)) bad('knowledge_file_spreadsheet_hidden');
    const columns = all(root, 'col');
    if (columns.some(c => truthy(c.attrs.hidden) || zeroSize(c.attrs.width))) bad('knowledge_file_spreadsheet_hidden');
    if (all(root, 'autoFilter').length) warnings.add('xlsx_filters_not_applied');
    const sheetRelsPath = path.posix.join(path.posix.dirname(target), '_rels', path.posix.basename(target) + '.rels');
    if (files.has(sheetRelsPath)) for (const r of relationships(read(sheetRelsPath)).values()) {
      if (r.Type !== TYPE + 'hyperlink') bad('knowledge_file_complex_spreadsheet');
      warnings.add('external_links_not_fetched');
    }
    const grid = new Map(), parsedRows = [], rowIds = new Set(); let previousRow = 0, maxColumn = 0;
    const sheetData = children(worksheet, 'sheetData');
    if (sheetData.length !== 1) bad('knowledge_file_parse_failed');
    for (const row of children(sheetData[0], 'row')) {
      const index = row.attrs.r === undefined ? previousRow + 1 : Number(row.attrs.r); previousRow = index;
      if (!Number.isInteger(index) || index < 1 || index > 64 || rowIds.has(index)) bad('knowledge_file_complex_spreadsheet');
      rowIds.add(index);
      if (truthy(row.attrs.hidden) || zeroSize(row.attrs.ht)) bad('knowledge_file_spreadsheet_hidden');
      let previousColumn = 0;
      for (const cell of children(row, 'c')) {
        const ref = cell.attrs.r || `${letter(previousColumn + 1)}${index}`, point = cellRef(ref);
        if (point.row !== index || grid.has(ref)) bad('knowledge_file_parse_failed');
        previousColumn = point.column; maxColumn = Math.max(maxColumn, point.column);
        const values = children(cell, 'v'), inline = children(cell, 'is'), type = cell.attrs.t || 'n';
        if (values.length > 1 || inline.length > 1 || values.length && inline.length) bad('knowledge_file_parse_failed');
        let text = values.length ? plain(values[0]) : '', numberFormat;
        const format = text || inline.length ? cellFormat(cell, row, columns, point.column) : null;
        if (type === 's') {
          if (!/^(?:0|[1-9]\d*)$/.test(text) || !Object.hasOwn(strings, Number(text))) bad('knowledge_file_parse_failed');
          text = strings[Number(text)];
        } else if (type === 'inlineStr') {
          if (!inline.length) bad('knowledge_file_parse_failed'); text = stringValue(inline[0]);
        } else if (type === 'n' && text) {
          if (format.code !== 'General') {
            numberFormat = { raw: text, id: format.id, code: format.code, ...(format.date ? { dateSystem } : {}) };
            if (format.date) warnings.add('xlsx_date_display_requires_review');
            if (format.time) warnings.add('xlsx_time_display_requires_review');
            if (!format.date && !format.time) warnings.add('xlsx_number_display_requires_review');
          }
          text = numberDisplay(text, format, dateSystem);
        } else if (type === 'b') {
          if (!['0','1'].includes(text)) bad('knowledge_file_parse_failed'); text = text === '1' ? 'TRUE' : 'FALSE';
        } else if (!['n','str'].includes(type)) bad('knowledge_file_complex_spreadsheet');
        // SpreadsheetML escape sequences are not literal display text. Fail this
        // bounded format rather than cite undecoded strings as the original value.
        if (/_x[0-9a-f]{4}_/i.test(text)) bad('knowledge_file_complex_spreadsheet');
        if (text.includes('\0') || text.length > 6000) bad('knowledge_file_block_limit');
        grid.set(ref, { ref, column: point.column, span: 1, text, ...(numberFormat ? { numberFormat } : {}) });
      }
      parsedRows.push(index);
    }
    const merges = all(root, 'mergeCell').map(n => rangeRef(n.attrs.ref)), occupied = new Set();
    for (const merge of merges) {
      const anchor = `${letter(merge.start.column)}${merge.start.row}`;
      if (!grid.get(anchor)?.text) bad('knowledge_file_complex_spreadsheet');
      maxColumn = Math.max(maxColumn, merge.end.column);
      for (let row = merge.start.row; row <= merge.end.row; row++) for (let col = merge.start.column; col <= merge.end.column; col++) {
        const ref = `${letter(col)}${row}`;
        if (occupied.has(ref) || ref !== anchor && grid.get(ref)?.text) bad('knowledge_file_complex_spreadsheet');
        occupied.add(ref);
        if (ref === anchor) Object.assign(grid.get(ref), { span: merge.end.column - col + 1, rowSpan: merge.end.row - row + 1, merge: 'restart' });
        else grid.set(ref, { ref, column: col, span: 1, text: '', merge: 'continue' });
      }
    }
    const rows = parsedRows.sort((a, b) => a - b).map(row => {
      const cells = Array.from({ length: maxColumn }, (_, i) => grid.get(`${letter(i + 1)}${row}`) || { ref: `${letter(i + 1)}${row}`, column: i + 1, span: 1, text: '' });
      return { row, cells, text: cells.filter(c => c.text).map(c => `${c.ref}: ${c.text}`).join(' | ') };
    }).filter(r => r.text);
    if (!rows.length) { warnings.add('xlsx_empty_sheets_not_indexed'); continue; }
    const isNote = r => /^(?:注[：:]|说明[：:]|备注[：:]|例外[：:]|前提[：:])/u.test(r.cells.find(c => c.text)?.text || '');
    const notes = rows.filter(isNote).map(r => r.text), dataRows = rows.filter(r => !isNote(r)), titles = [];
    // A full-width merged title is a section, not a guessed set of column labels.
    while (dataRows.length > 1 && merges.some(m => m.start.row === dataRows[0].row && m.end.row === m.start.row && m.start.column === 1 && m.end.column === maxColumn)) titles.push(dataRows.shift());
    const firstRow = dataRows[0]?.row;
    let headerEnd = firstRow;
    if (headerEnd) for (;;) {
      const end = Math.max(headerEnd, ...merges.filter(m => m.start.row <= headerEnd).map(m => m.end.row));
      if (end === headerEnd) break; headerEnd = end;
    }
    const headers = dataRows.filter(r => r.row <= headerEnd).map(r => r.text);
    for (const row of rows) {
      const range = `${letter(1)}${row.row}:${letter(maxColumn)}${row.row}`;
      const sharedMerges = merges.filter(m => m.start.row < row.row && m.end.row >= row.row)
        .map(m => `合并单元格 ${m.ref}: ${grid.get(`${letter(m.start.column)}${m.start.row}`).text}`);
      const text = row.text;
      if (blocks.length >= 128 || text.length > 6000) bad('knowledge_file_block_limit');
      blocks.push({ id: `b${blocks.length + 1}`, kind: titles.includes(row) ? 'heading' : isNote(row) ? 'footnote' : 'table_row',
        sheet: name, range, section: [name, ...titles.map(t => t.text)], row: row.row, cells: row.cells, text,
        headers, notes: [...notes, ...sharedMerges] });
    }
  }
  if (!blocks.length) bad('knowledge_file_no_text');
  return { parser: 'xiaok-file-v2:xlsx:yauzl3.4.0:saxes6.0.0:decimal-v1:date-v1:time-v1', blocks, warnings: [...warnings] };
}
