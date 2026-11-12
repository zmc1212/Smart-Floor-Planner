// Local-only parser process. No URL inputs, HTML, macros, OCR or model rewriting.
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseXlsx } from './assistant-xlsx-parser.mjs';
import { chapterLevel, parseText } from './assistant-text-parser.mjs';

const VERSION = 'xiaok-file-v1';
const bad = code => { throw new Error(code); };
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function xml(bytes) {
  const parser = new SaxesParser({ xmlns: true }), root = { children: [] }, stack = [root];
  let nodes = 0;
  parser.on('doctype', () => bad('knowledge_file_unsafe_archive'));
  parser.on('opentag', tag => {
    if (++nodes > 50000 || stack.length > 64) bad('knowledge_file_resource_limit');
    const attributes = Object.values(tag.attributes);
    // Unrecognized namespaces cannot replace a standard coordinate/value by
    // sharing its local name. Word attributes are qualified; SpreadsheetML,
    // content-type and package-relationship attributes are unqualified.
    const node = { name: tag.local, uri: tag.uri,
      attrs: Object.fromEntries(attributes.filter(a => a.uri === (tag.uri === WORD ? WORD : '')).map(a => [a.local, a.value])),
      relationshipId: attributes.find(a => a.uri === OFFICE_REL && a.local === 'id')?.value,
      embeddedId: attributes.find(a => a.uri === OFFICE_REL && a.local === 'embed')?.value, children: [] };
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
function outlineLevel(properties) {
  const outline = properties && children(properties, 'outlineLvl')[0];
  if (!outline) return undefined;
  const raw = value(outline), level = Number(raw);
  if (typeof raw !== 'string' || !/^\s*\+?\d+\s*$/.test(raw) || !Number.isInteger(level) || level < 0 || level > 9) bad('knowledge_file_parse_failed');
  // OOXML0..8 map to heading1..9;9 explicitly means body text. Keep zero
  // distinct from absence so a direct body override does not fall back to style.
  return level === 9 ? 0 : level + 1;
}
function descendants(node) {
  return node.children.flatMap(child => typeof child === 'string' ? [] : [child, ...descendants(child)]);
}
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
async function unzip(bytes, format = 'docx') {
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
        const selected = format === 'xlsx'
          ? ['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/sharedStrings.xml','xl/styles.xml'].includes(name)
            || /^xl\/worksheets\/[\w.-]+\.xml$/.test(name) || /^xl\/worksheets\/_rels\/[\w.-]+\.xml\.rels$/.test(name)
          : ['[Content_Types].xml','docProps/core.xml','word/document.xml','word/styles.xml','word/footnotes.xml','word/endnotes.xml','word/_rels/document.xml.rels'].includes(name);
        if (!selected) return zip.readEntry();
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
  const core = files.get('docProps/core.xml');
  const titleNode = core && descendants(xml(core)).find(n => n.uri === 'http://purl.org/dc/elements/1.1/' && n.name === 'title');
  const title = titleNode && plain(titleNode).trim().slice(0, 200);
  const warnings = ['docx_no_fixed_pages'], levels = new Map(), noteParts = [], images = [];
  if (files.has('word/styles.xml')) for (const s of all(xml(files.get('word/styles.xml')), 'style')) {
    const outline = outlineLevel(children(s, 'pPr')[0]);
    if (outline !== undefined) levels.set(s.attrs.styleId, outline);
  }
  const noteId = value => {
    if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value)) bad('knowledge_file_parse_failed');
    return String(BigInt(value));
  };
  // Keep the two OOXML identity spaces separate. Never turn a dangling reference
  // into a condition-free passage, or flatten a note's unsupported layout.
  const readNotes = kind => {
    const part = files.get(`word/${kind}s.xml`), result = new Map();
    if (!part) return result;
    const root = xml(part), container = children(root, `${kind}s`);
    if (container.length !== 1) bad('knowledge_file_parse_failed');
    noteParts.push(root);
    for (const note of children(container[0], kind)) {
      if (['separator','continuationSeparator','continuationNotice'].includes(note.attrs.type)) continue;
      if (note.attrs.type && note.attrs.type !== 'normal') bad('knowledge_file_parse_failed');
      const id = noteId(note.attrs.id);
      if (result.has(id)) bad('knowledge_file_parse_failed');
      if (note.children.some(c => typeof c !== 'string' && !(c.uri === WORD && ['p','bookmarkStart','bookmarkEnd'].includes(c.name)))
        || all(note, 'footnoteReference').length || all(note, 'endnoteReference').length) bad('knowledge_file_complex_layout');
      const text = children(note, 'p').map(paragraph).filter(Boolean).join('\n');
      if (!text) bad('knowledge_file_complex_layout');
      if (text.length > 6000 || result.size >= 128) bad('knowledge_file_block_limit');
      result.set(id, text);
    }
    return result;
  };
  const footnotes = readNotes('footnote'), endnotes = readNotes('endnote');
  if (names.has('word/header1.xml') || names.has('word/footer1.xml')) warnings.push('headers_footers_not_indexed');
  if ([root,...noteParts].some(r => all(r, 'drawing').length || all(r, 'pict').length)) warnings.push('images_not_parsed');
  if ([root,...noteParts].some(r => all(r, 'ins').length || all(r, 'del').length)) warnings.push('tracked_changes_visible_text_only');
  if (files.get('word/_rels/document.xml.rels')?.toString().includes('TargetMode="External"')) warnings.push('external_links_not_fetched');
  let section = [], sectionNotes = [], para = 0, table = 0; const blocks = [], headings = [];
  const notes = n => {
    const result = [];
    const visit = node => {
      if (node.uri === WORD && ['del','moveFrom'].includes(node.name)) return;
      if (node.uri === WORD && ['footnoteReference','endnoteReference'].includes(node.name)) {
        const note = (node.name === 'footnoteReference' ? footnotes : endnotes).get(noteId(node.attrs.id));
        if (note === undefined) bad('knowledge_file_parse_failed');
        result.push(note);
      }
      for (const child of node.children) if (typeof child !== 'string') visit(child);
    };
    visit(n); return [...new Set(result)];
  };
  const push = b => {
    if (blocks.length >= 128 || b.text.length > 6000) bad('knowledge_file_block_limit');
    const attached = [...new Set([...sectionNotes.flat(),...(b.notes || [])])];
    blocks.push({ id: `b${blocks.length + 1}`, section: [...section], ...b, ...(attached.length ? { notes: attached } : {}) });
  };
  const collectImages = (node, position) => {
    for (const drawing of all(node, 'drawing')) {
      if (images.length >= 128) bad('knowledge_file_block_limit');
      const children = descendants(drawing);
      const description = children.find(n => n.uri === 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing' && n.name === 'docPr');
      const alt = [description?.attrs.title, description?.attrs.descr].filter(Boolean).join('\n').trim();
      const relationshipId = children.find(n => n.embeddedId)?.embeddedId;
      const image = { id: 'i' + (images.length + 1), part: 'word/document.xml', ...position,
        ...(alt ? { alt } : {}), ...(relationshipId ? { relationshipId } : {}) };
      images.push(image);
      if (alt) push({ kind: 'figure', text: alt, image, ...position });
    }
  };
  const nodes = body.children.filter(c => typeof c !== 'string');
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]; if (n.uri !== WORD) continue;
    if (n.name === 'p') {
      const text = paragraph(n), attached = notes(n); ++para;
      // Only current direct properties apply; pPrChange contains an older view.
      const properties = children(n, 'pPr')[0], style = value(properties && children(properties, 'pStyle')[0]) || '';
      const level = outlineLevel(properties) ?? levels.get(style) ?? Number(/^Heading([1-9])$/i.exec(style)?.[1]);
      if (level && text) {
        // A document may skip a heading level. Array positions alone would
        // incorrectly retain a previous sibling as an ancestor in that case.
        while (headings.length && headings.at(-1).level >= level) headings.pop();
        headings.push({ level, text, notes: attached });
        section = headings.map(heading => heading.text);
        sectionNotes = headings.map(heading => heading.notes);
        push({ kind: 'heading', text, paragraph: para });
      }
      else if (text || attached.length) push({ kind: 'paragraph', text, paragraph: para, ...(attached.length ? { notes: attached } : {}) });
      collectImages(n, { paragraph: para });
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
      const headerRows = parsedRows.map((r, j) => ({ ...r, isHeader: j === 0 || all(rows[j], 'tblHeader').length })).filter(r => r.isHeader);
      const headers = headerRows.map(r => r.text), headerNotes = headerRows.flatMap(r => r.notes);
      if (!all(rows[0], 'tblHeader').length) warnings.push('table_first_row_header_requires_review');
      const following = nodes[i + 1]?.name === 'p' ? paragraph(nodes[i + 1]) : '';
      for (const row of parsedRows) if (row.text.trim()) push({ ...row, headers, notes: [...headerNotes,...row.notes,
        ...(/^(?:注[：:]|说明[：:]|例外|前提)/u.test(following) ? [following,...notes(nodes[i + 1])] : [])] });
      collectImages(n, { table });
    } else if (!['sectPr','bookmarkStart','bookmarkEnd'].includes(n.name)) {
      // Do not silently flatten content controls/alternate layouts and claim completeness.
      bad('knowledge_file_complex_layout');
    }
  }
  if (!blocks.some(block => block.text.trim())) bad(images.length ? 'knowledge_file_ocr_required' : 'knowledge_file_no_text');
  if (images.some(image => image.alt)) warnings.push('image_alternative_text_requires_review');
  return { parser: VERSION + ':docx:yauzl3.4.0:saxes6.0.0:notes-v2:outline-v1' + (images.length || title ? ':metadata-v1' : ''),
    blocks, warnings: [...new Set(warnings)], ...(title ? { title } : {}), ...(images.length ? { images } : {}) };
}
/** PDF EOLs are layout lines, not paragraph boundaries. Join only adjacent
 * horizontal flow, retaining complete numbered clauses, headings and pages.
 * This is bounded text grouping, not table/column or document understanding. */
function pdfParagraphs(lines) {
  const heading = text => chapterLevel(text) || /^(?:[一二三四五六七八九十]+[、.．]|[A-Z][、.．])/.test(text);
  const numbered = text => /^(?:[（(]?\d{1,3}[、.．)）](?!\d)|[a-z][)）、.．])/.test(text);
  const adjacent = (a, b) => a && !a.rotated && !b.rotated
    && a.y > b.y && a.y - b.y <= Math.max(a.height, b.height) * 2.6
    && Math.abs(a.x - b.x) <= Math.max(a.height, b.height) * 3
    && Math.abs(a.height - b.height) <= Math.max(a.height, b.height) * 0.12;
  const paragraphs = []; let current = null;
  for (const line of lines) {
    const hard = !adjacent(current?.last, line) || heading(line.text) || heading(current?.first.text || '');
    if (current && !hard && !numbered(line.text)) {
      current.text += ' ' + line.text; current.last = line;
    } else {
      current = { text: line.text, first: line, last: line, hard };
      paragraphs.push(current);
    }
  }
  // Pack short neighboring complete clauses; never split/truncate an original
  // clause to fit. Existing file/chunk/token limits still reject oversize input.
  const packed = []; let previous = null;
  for (const paragraph of paragraphs) {
    const text = previous ? previous.text + '\n' + paragraph.text : paragraph.text;
    if (previous && !paragraph.hard && text.length <= 300) previous.text = text;
    else { previous = { text: paragraph.text }; packed.push(previous); }
  }
  return packed.map(p => p.text);
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
    const blocks = [], images = [], headings = [];
    const { info } = await document.getMetadata();
    const title = typeof info.Title === 'string' ? info.Title.trim().slice(0, 200) : '';
    const warnings = ['pdf_reading_order_requires_review','pdf_tables_not_structurally_parsed','images_not_parsed'];
    for (let page = 1; page <= document.numPages; page++) {
      const p = await document.getPage(page), content = await p.getTextContent();
      let line = '', metrics = null, paragraph = 0; const lines = [];
      const push = () => { if (line.trim()) lines.push({ text: line.trim(), ...metrics }); line = ''; metrics = null; };
      for (const item of content.items) if ('str' in item) {
        line += item.str;
        if (item.str.trim()) {
          const [a, b, c, d, x, y] = item.transform, height = Math.hypot(c, d);
          if (![a,b,c,d,x,y,height].every(Number.isFinite) || height <= 0) bad('knowledge_file_parse_failed');
          if (!metrics) metrics = { x, y, height, rotated: Math.abs(b) > 0.001 || Math.abs(c) > 0.001 };
          else { metrics.height = Math.max(metrics.height, height); metrics.rotated ||= Math.abs(b) > 0.001 || Math.abs(c) > 0.001; }
        }
        if (item.hasEOL) push();
      }
      push();
      const addBlock = (kind, text, extra) => {
        if (blocks.length >= 128 || text.length > 6000) bad('knowledge_file_block_limit');
        blocks.push({ id: `b${blocks.length + 1}`, kind, text, section: headings.map(heading => heading.text), page, ...extra });
      };
      const paragraphs = pdfParagraphs(lines);
      if (!paragraphs.length) bad('knowledge_file_ocr_required');
      for (const text of paragraphs) {
        const level = chapterLevel(text);
        if (level) {
          while (headings.length && headings.at(-1).level >= level) headings.pop();
          headings.push({ level, text });
        }
        addBlock(level ? 'heading' : 'paragraph', text, { paragraph: ++paragraph });
      }
      const structure = await p.getStructTree(), pending = structure ? [structure] : [];
      while (pending.length) {
        const item = pending.pop();
        if (item.role === 'Figure') {
          if (images.length >= 128) bad('knowledge_file_block_limit');
          const alt = typeof item.alt === 'string' ? item.alt.trim() : '';
          const image = { id: 'i' + (images.length + 1), page, ...(alt ? { alt } : {}) };
          images.push(image);
          if (alt) addBlock('figure', alt, { image });
        }
        if (item.children) pending.push(...item.children.slice().reverse());
      }
      p.cleanup();
    }
    if (!blocks.length) bad('knowledge_file_no_text');
    if (images.some(image => image.alt)) warnings.push('image_alternative_text_requires_review');
    return { parser: VERSION + ':pdf:pdfjs6.4.299:flow-paragraphs-v1' + (headings.length || images.length || title ? ':metadata-v1' : ''),
      blocks, warnings, pages: document.numPages, ...(title ? { title } : {}), ...(images.length ? { images } : {}) };
  } finally { await task.destroy(); }
}
let stdin = '';
try {
  for await (const c of process.stdin) { stdin += c; if (stdin.length > 5600000) bad('knowledge_file_resource_limit'); }
  const input = JSON.parse(stdin), bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) bad('knowledge_file_invalid');
  const result = input.format === 'docx' ? await docx(bytes) : input.format === 'pdf' ? await pdf(bytes)
    : input.format === 'xlsx' ? await parseXlsx(bytes, { unzip, xml })
      : ['txt', 'md'].includes(input.format) ? parseText(bytes, input.format) : bad('knowledge_file_invalid');
  const text = result.blocks.map(b => b.text).join('\n\n');
  if (text.includes('\0') || text.length > 16000 || Buffer.byteLength(text) > 48000) bad('knowledge_file_text_limit');
  process.stdout.write(JSON.stringify(result));
} catch (e) {
  const code = /^knowledge_file_/.test(e?.message || '') ? e.message : e?.name === 'PasswordException' ? 'knowledge_file_password' : 'knowledge_file_parse_failed';
  process.stdout.write(JSON.stringify({ error: code })); process.exitCode = 1;
}
