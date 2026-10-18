import { fail } from '../contracts';
import { EMBEDDING_PROFILE } from '../infrastructure/embedding-gateway';
export type Chunk = { text: string; start: number; end: number; tokens: number };
/** Offsets are Unicode code points, not JavaScript UTF-16 code units. */
export async function chunkDocument(text: string): Promise<Chunk[]> {
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
