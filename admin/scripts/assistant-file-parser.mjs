// Local-only parser process. No URL inputs, HTML, macros, OCR or model rewriting.
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const VERSION = 'xiaok-file-v1';
const bad = code => { throw new Error(code); };
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function xml(bytes) {
  const parser = new SaxesParser({ xmlns: true }), root = { children: [] }, stack = [root];
  let nodes = 0;
  parser.on('doctype', () => bad('knowledge_file_unsafe_archive'));
  parser.on('opentag', tag => {
    if (++nodes > 50000 || stack.length > 64) bad('knowledge_file_resource_limit');
    const node = { name: tag.local, uri: tag.uri, attrs: Object.fromEntries(Object.values(tag.attributes).map(a => [a.local, a.value])), children: [] };
    stack.at(-1).children.push(node); stack.push(node);
  });
  parser.on('text', text => stack.at(-1).children.push(text));
  parser.on('closetag', () => stack.pop());
  parser.on('error', () => bad('knowledge_file_parse_failed'));
  parser.write(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).close();
  return root;
}
const children = (n, name) => n.children.filter(c => typeof c !== 'string' && c.name === name && c.uri === WORD);
function all(n, name) { return n.children.flatMap(c => typeof c === 'string' ? [] : [...(c.name === name && c.uri === WORD ? [c] : []), ...all(c, name)]); }
const value = n => n?.attrs.val;
function plain(n) { return n.children.map(c => typeof c === 'string' ? c : plain(c)).join(''); }
function paragraph(n) {
  function read(node) {
    if (node.uri === WORD && ['del','moveFrom'].includes(node.name)) return '';
    if (node.uri === WORD && node.name === 't') return plain(node);
    if (node.uri === WORD && node.name === 'tab') return '\t';
    if (node.uri === WORD && ['br','cr'].includes(node.name)) return '\n';
    return node.children.filter(c => typeof c !== 'string').map(read).join('');
  }
  return read(n).trim();
}
async function unzip(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(new Error('knowledge_file_parse_failed'));
      const files = new Map(), names = new Set(); let expanded = 0, count = 0;
      const stop = code => { zip.close(); reject(new Error(code)); };
      zip.on('error', () => stop('knowledge_file_parse_failed'));
      zip.on('entry', entry => {
        const name = entry.fileName;
        if (++count > 1000 || names.has(name) || name.includes('..') || name.startsWith('/') || /vbaProject|embeddings\//i.test(name)
          || entry.generalPurposeBitFlag & 1) return stop('knowledge_file_unsafe_archive');
        names.add(name); expanded += entry.uncompressedSize;
        if (expanded > 24 * 1024 * 1024 || entry.uncompressedSize > 8 * 1024 * 1024
          || entry.uncompressedSize > Math.max(65536, entry.compressedSize * 200)) return stop('knowledge_file_resource_limit');
        if (!['[Content_Types].xml','word/document.xml','word/styles.xml','word/footnotes.xml','word/_rels/document.xml.rels'].includes(name)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return stop('knowledge_file_parse_failed');
          const chunks = []; let length = 0;
          stream.on('data', c => { length += c.length; if (length > 8 * 1024 * 1024) { stream.destroy(); stop('knowledge_file_resource_limit'); } else chunks.push(c); });
          stream.on('error', () => stop('knowledge_file_parse_failed'));
          stream.on('end', () => { const data=Buffer.concat(chunks);if(crc32(data)!==entry.crc32)return stop('knowledge_file_parse_failed');files.set(name, data); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve({ files, names })); zip.readEntry();
    });
  });
}
async function docx(bytes) {
  const { files, names } = await unzip(bytes);
  if (!files.has('word/document.xml') || !files.has('[Content_Types].xml') || !files.get('[Content_Types].xml').toString().includes('wordprocessingml.document.main+xml')) bad('knowledge_file_invalid');
  const root = xml(files.get('word/document.xml')), body = all(root, 'body')[0];
  if (!body) bad('knowledge_file_parse_failed');
  const warnings = ['docx_no_fixed_pages'], levels = new Map(), footnotes = new Map();
  if (files.has('word/styles.xml')) for (const s of all(xml(files.get('word/styles.xml')), 'style')) {
    const outline = Number(value(all(s, 'outlineLvl')[0]));
    if (Number.isInteger(outline) && outline >= 0 && outline <= 8) levels.set(s.attrs.styleId, outline + 1);
  }
  if (files.has('word/footnotes.xml')) for (const f of all(xml(files.get('word/footnotes.xml')), 'footnote')) {
    if (!f.attrs.type) footnotes.set(f.attrs.id, all(f, 'p').map(paragraph).filter(Boolean).join('\n'));
  }
  if (names.has('word/header1.xml') || names.has('word/footer1.xml')) warnings.push('headers_footers_not_indexed');
  if (all(root, 'drawing').length || all(root, 'pict').length) warnings.push('images_not_parsed');
  if (all(root, 'ins').length || all(root, 'del').length) warnings.push('tracked_changes_visible_text_only');
  if (files.get('word/_rels/document.xml.rels')?.toString().includes('TargetMode="External"')) warnings.push('external_links_not_fetched');
  let section = [], para = 0, table = 0; const blocks = [];
  const notes = n => all(n, 'footnoteReference').map(f => footnotes.get(f.attrs.id)).filter(Boolean);
  const push = b => { if (blocks.length >= 128 || b.text.length > 6000) bad('knowledge_file_block_limit'); blocks.push({ id: `b${blocks.length + 1}`, section: [...section], ...b }); };
  const nodes = body.children.filter(c => typeof c !== 'string');
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]; if (n.uri !== WORD) continue;
    if (n.name === 'p') {
      const text = paragraph(n); ++para; if (!text) continue;
      const style = value(all(n, 'pStyle')[0]) || '', level = levels.get(style) || Number(/^Heading([1-9])$/i.exec(style)?.[1]);
      if (level) { section = [...section.slice(0, level - 1), text]; push({ kind: 'heading', text, paragraph: para }); }
      else push({ kind: 'paragraph', text, paragraph: para, ...(notes(n).length ? { notes: notes(n) } : {}) });
    } else if (n.name === 'tbl') {
      ++table; const rows = children(n, 'tr'); if (!rows.length || rows.length > 64 || all(n, 'tbl').length) bad('knowledge_file_complex_table');
      const parsedRows = rows.map((row, index) => {
        let column = 1;
        const cells = children(row, 'tc').map(cell => {
          const span = Number(value(all(cell, 'gridSpan')[0]) || 1), merge = all(cell, 'vMerge')[0];
          if (!Number.isInteger(span) || span < 1 || span > 12 || column + span > 13) bad('knowledge_file_complex_table');
          const c = { column, span, text: all(cell, 'p').map(paragraph).filter(Boolean).join('\n'), ...(merge ? { merge: value(merge) || 'continue' } : {}) }; column += span; return c;
        });
        return { kind: 'table_row', table, row: index + 1, cells, text: cells.map(c => c.text).join(' | '), notes: notes(row) };
      });
      const headers = parsedRows.filter((_, j) => j === 0 || all(rows[j], 'tblHeader').length).map(r => r.text);
      if (!all(rows[0], 'tblHeader').length) warnings.push('table_first_row_header_requires_review');
      const following = nodes[i + 1]?.name === 'p' ? paragraph(nodes[i + 1]) : '';
      for (const row of parsedRows) if (row.text.trim()) push({ ...row, headers, notes: [...row.notes, ...(/^(?:注[：:]|说明[：:]|例外|前提)/u.test(following) ? [following] : [])] });
    } else if (!['sectPr','bookmarkStart','bookmarkEnd'].includes(n.name)) {
      // Do not silently flatten content controls/alternate layouts and claim completeness.
      bad('knowledge_file_complex_layout');
    }
  }
  if (!blocks.length) bad('knowledge_file_no_text');
  return { parser: VERSION + ':docx:yauzl3.4.0:saxes6.0.0', blocks, warnings: [...new Set(warnings)] };
}
async function pdf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    useWorkerFetch: false, stopAtErrors: true, maxImageSize: 1, verbosity: 0,
    cMapUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/cmaps/',import.meta.url)).replaceAll('\\','/'),cMapPacked:true,
    standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/') });
  // Neither viewer nor scripting manager is loaded. PDF actions/attachments are never executed/fetched.
  try {
    const document = await task.promise;
    if (document.numPages > 50) bad('knowledge_file_resource_limit');
    const blocks = [], warnings = ['pdf_reading_order_requires_review','pdf_tables_not_structurally_parsed','images_not_parsed'];
    for (let page = 1; page <= document.numPages; page++) {
      const p = await document.getPage(page), content = await p.getTextContent();
      let line = '', paragraph = 0;
      const push = () => { if (line.trim()) { if (blocks.length >= 128 || line.length > 6000) bad('knowledge_file_block_limit'); blocks.push({ id: `b${blocks.length + 1}`, kind: 'paragraph', text: line.trim(), section: [], page, paragraph: ++paragraph }); } line = ''; };
      for (const item of content.items) if ('str' in item) { line += item.str; if (item.hasEOL) push(); }
      push(); p.cleanup();
      if (!blocks.some(b => b.page === page)) bad('knowledge_file_ocr_required');
    }
    if (!blocks.length) bad('knowledge_file_no_text');
    return { parser: VERSION + ':pdf:pdfjs6.4.299', blocks, warnings, pages: document.numPages };
  } finally { await task.destroy(); }
}
let stdin = '';
try {
  for await (const c of process.stdin) { stdin += c; if (stdin.length > 5600000) bad('knowledge_file_resource_limit'); }
  const input = JSON.parse(stdin), bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) bad('knowledge_file_invalid');
  const result = input.format === 'docx' ? await docx(bytes) : input.format === 'pdf' ? await pdf(bytes) : bad('knowledge_file_invalid');
  const text = result.blocks.map(b => b.text).join('\n\n');
  if (text.includes('\0') || text.length > 16000 || Buffer.byteLength(text) > 48000) bad('knowledge_file_text_limit');
  process.stdout.write(JSON.stringify(result));
} catch (e) {
  const code = /^knowledge_file_/.test(e?.message || '') ? e.message : e?.name === 'PasswordException' ? 'knowledge_file_password' : 'knowledge_file_parse_failed';
  process.stdout.write(JSON.stringify({ error: code })); process.exitCode = 1;
}
