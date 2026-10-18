import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fail, fingerprint } from '../contracts';
import type { SourceFile, ParsedFile, FileBlock, FileLocator } from '../contracts/source-file';
import type { Chunk } from './chunk-gateway';

export const FILE_LIMIT = 4 * 1024 * 1024;
export function uploadedFile(input: Record<string, unknown>) {
  const { fileName, fileBase64, authorization } = input;
  if (typeof fileName !== 'string' || !/^[^/\\\x00-\x1f]{1,180}\.(docx|pdf)$/i.test(fileName)
    || typeof authorization !== 'string' || !authorization.trim() || authorization.includes('\0') || authorization.length > 500
    || typeof fileBase64 !== 'string' || fileBase64.length > Math.ceil(FILE_LIMIT / 3) * 4
    || fileBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(fileBase64)) fail('knowledge_file_invalid', 422);
  const data = Buffer.from(fileBase64, 'base64'), format = fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';
  if (data.toString('base64')!==fileBase64 || data.length < 5 || data.length > FILE_LIMIT || (format === 'pdf' ? data.subarray(0, 5).toString() !== '%PDF-' : data.readUInt32LE(0) !== 0x04034b50)) fail('knowledge_file_invalid', 422);
  return { data, format, name: fileName, authorization: authorization.trim(), hash: createHash('sha256').update(new Uint8Array(data)).digest('hex') };
}
export function fileQuoteSpans(text:string,quote:string,start:number) {
  const ranges:Array<{start:number;end:number}>=[];let occurrences=0,from=0;
  if(quote)for(;;){const i=text.indexOf(quote,from);if(i<0)break;occurrences++;if(ranges.length<8){const at=start+Array.from(text.slice(0,i)).length;ranges.push({start:at,end:at+Array.from(quote).length});}from=i+quote.length;}
  return {unit:'unicode_code_point_in_indexed_text',ranges,occurrences,ambiguous:occurrences>1};
}
export function fileLabel(b: FileBlock): string {
  return [b.page ? `PDF第${b.page}页` : b.section.join(' / '), b.table ? `表${b.table}·第${b.row}行` : b.paragraph ? `段落${b.paragraph}` : '', b.cells ? `列${b.cells.map(c => c.span > 1 ? `${c.column}–${c.column + c.span - 1}` : c.column).join('、')}` : ''].filter(Boolean).join(' · ');
}
export function filePassages(file: SourceFile) {
  if (!file.parsed) return [];
  const excluded = new Set(file.review?.excluded || []);
  return file.parsed.blocks.filter(b => !excluded.has(b.id)).map(b => ({ block: b,
    // Heading/table context is copied from the same parsed original, never synthesized.
    text: [b.section.join(' / '), ...(b.headers || []), b.text, ...(b.notes || [])].filter((s, i, a) => s && a.indexOf(s) === i).join('\n') }));
}
export function fileContent(file: SourceFile) {
  const body = filePassages(file).map(p => p.text).join('\n\n');
  if (body.length > 16000 || Buffer.byteLength(body) > 48000) fail('knowledge_file_text_limit', 422);
  return { body, hash: fingerprint({ source: 'file', file }), rendered: body };
}
export async function fileChunks(file: SourceFile, chunk: (s: string) => Promise<Chunk[]>) {
  if (!file.parsed || !file.review) fail('knowledge_file_review_required');
  let offset = 0;
  const result: Array<Chunk & { file: FileLocator }> = [];
  for (const { block, text } of filePassages(file)) {
    const pieces = await chunk(text);
    // First batch keeps each original passage and its conditions together.
    if (pieces.length !== 1 || !Number.isInteger(pieces[0].tokens) || pieces[0].tokens < 1 || pieces[0].tokens > 512 || pieces[0].start !== 0 || pieces[0].end !== Array.from(text).length || pieces[0].text !== text) fail('knowledge_file_block_limit', 422);
    result.push({ ...pieces[0], start: offset, end: offset + pieces[0].end, file: {
      assetId: file.assetId, sourceHash: file.hash, name: file.name, format: file.format, parser: file.parsed.parser,
      blockId: block.id, kind: block.kind, section: block.section, ...(block.page ? { page: block.page } : {}),
      ...(block.paragraph ? { paragraph: block.paragraph } : {}), ...(block.table ? { table: block.table, row: block.row, columns: block.cells?.map(c => c.column) } : {}), label: fileLabel(block),
    } });
    offset += Array.from(text).length + 2;
  }
  if (!result.length || result.length > 128) fail('knowledge_file_block_limit', 422);
  return result;
}
/** No credentials in the child environment, no client-supplied paths/URLs, bounded stdin/stdout/heap/time. */
export async function parseSourceFile(bytes: Buffer, format: string): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=192', path.resolve(process.cwd(), 'scripts/assistant-file-parser.mjs')], {
      cwd: process.cwd(), windowsHide: true, env: { NODE_ENV: 'production', SystemRoot: process.env.SystemRoot, PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('knowledge_file_timeout')); }, 20000);
    child.stdout.on('data', c => { size += c.length; if (size > 2000000) { child.kill(); reject(new Error('knowledge_file_text_limit')); } else output += c; });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('knowledge_file_parser_unavailable')); });
    child.on('close', code => {
      clearTimeout(timer);
      try { const r = JSON.parse(output); if (code || r.error) reject(new Error(r.error || 'knowledge_file_parse_failed')); else resolve(r); }
      catch { reject(new Error('knowledge_file_parse_failed')); }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({ format, base64: bytes.toString('base64') }));
  });
}
