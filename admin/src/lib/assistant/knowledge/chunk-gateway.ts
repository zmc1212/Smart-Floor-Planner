import { fail } from '../contracts';
import { EMBEDDING_PROFILE, configuredEmbeddingProfile } from '../infrastructure/embedding-gateway';
export type Chunk = { text: string; start: number; end: number; tokens: number };
/** Offsets are Unicode code points, not JavaScript UTF-16 code units. */
export async function chunkDocument(text: string): Promise<Chunk[]> {
  if ('provider' in configuredEmbeddingProfile()) return chunkWholeParagraphs(text);
  const endpoint = new URL(process.env.ASSISTANT_EMBEDDING_URL || 'http://invalid');
  const key = process.env.ASSISTANT_EMBEDDING_API_KEY;
  if (!key || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))) fail('retrieval_unavailable',503);
  const response = await fetch(new URL('/v1/chunks',endpoint), {method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
    body:JSON.stringify({text,profile:EMBEDDING_PROFILE.id}),signal:AbortSignal.timeout(30000),redirect:'error'});
  if (!response.ok) fail('retrieval_unavailable',503);
  const result = await response.json(), points = Array.from(text);
  if (result.profile !== EMBEDDING_PROFILE.id || result.revision !== EMBEDDING_PROFILE.revision || !Array.isArray(result.chunks) || !result.chunks.length || result.chunks.length>128) fail('retrieval_unavailable',503);
  let covered = 0;
  for (const c of result.chunks as Chunk[]) {
    if (!Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start<0 || c.start>covered || c.end<=c.start || c.end>points.length ||
      !Number.isInteger(c.tokens) || c.tokens<1 || c.tokens>512 || points.slice(c.start,c.end).join('')!==c.text) fail('retrieval_unavailable',503);
    covered=Math.max(covered,c.end);
  }
  if (covered!==points.length) fail('retrieval_unavailable',503);
  return result.chunks;
}
/** A conservative byte ceiling for compatible embedding endpoints without the
 * local tokenizer. Overlap copies a whole short paragraph with exact offsets. */
function chunkWholeParagraphs(text: string): Chunk[] {
  const limit = 512, overlap = 64, chunks: Chunk[] = [];
  const paragraphs = text.match(/[\s\S]+?(?:\r?\n[ \t]*\r?\n|$)/gu) ?? [];
  let start = 0, offset = 0, current = '', previous = '';
  for (const paragraph of paragraphs) {
    if (Buffer.byteLength(paragraph) > limit) fail('knowledge_file_block_limit', 422);
    if (Buffer.byteLength(current + paragraph) > limit) {
      chunks.push({ text: current, start, end: offset, tokens: Buffer.byteLength(current) });
      current = Buffer.byteLength(previous) <= overlap && Buffer.byteLength(previous + paragraph) <= limit ? previous : '';
      start = offset - Array.from(current).length;
    }
    current += paragraph;
    offset += Array.from(paragraph).length;
    previous = paragraph;
  }
  if (current) chunks.push({ text: current, start, end: offset, tokens: Buffer.byteLength(current) });
  if (!chunks.length || chunks.length > 128) fail('knowledge_file_block_limit', 422);
  return chunks;
}
