import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fail } from '../contracts';

export const fastGPTPreviewProtocol = 'fastgpt-mineru-preview-v1';
export type FastGPTRetrievalConfig = {
  protocol: typeof fastGPTPreviewProtocol; enterpriseId: string; baseUrl: string; apiKey: string;
  datasetId: string; collectionId: string; corpusSha256: string;
  chunks: Array<{ chunkIndex: number; sha256: string }>;
};
export type FastGPTCandidate = { chunkIndex: number; chunkSha256: string; rank: number; semanticRank: number | null; similarity: number | null };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
let loaded: { path: string; hash: string; config: FastGPTRetrievalConfig } | undefined;

/** Explicit process-scoped development opt-in. This is a replaceable candidate
 * index, never a tenant/permission resolver, source store or answer endpoint. */
export function fastGPTPreviewConfiguration(enterpriseId: string): FastGPTRetrievalConfig | undefined {
  const path = process.env.XIAOK_FASTGPT_RETRIEVAL_FILE;
  if (!path) return;
  const bytes = fs.readFileSync(path), hash = sha(bytes);
  if (loaded && (loaded.path !== path || loaded.hash !== hash)) fail('context_changed');
  if (!loaded) {
    const c = JSON.parse(bytes.toString('utf8')) as FastGPTRetrievalConfig;
    let url: URL;
    try { url = new URL(c.baseUrl); } catch { return fail('retrieval_unavailable', 503); }
    if (c.protocol !== fastGPTPreviewProtocol || !/^[1-9]\d*$/.test(c.enterpriseId)
      || url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '18300'
      || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || typeof c.apiKey !== 'string' || !c.apiKey || ![c.datasetId, c.collectionId].every(x => /^[a-f0-9]{24}$/.test(x))
      || !/^[a-f0-9]{64}$/.test(c.corpusSha256) || !Array.isArray(c.chunks) || !c.chunks.length || c.chunks.length > 1000
      || new Set(c.chunks.map(x => x.chunkIndex)).size !== c.chunks.length
      || c.chunks.some(x => !Number.isInteger(x.chunkIndex) || x.chunkIndex < 0 || !/^[a-f0-9]{64}$/.test(x.sha256))) fail('retrieval_unavailable', 503);
    loaded = { path, hash, config: c };
  }
  return loaded.config.enterpriseId === enterpriseId ? loaded.config : undefined;
}

/** No retries, fallback, query expansion model or answer generation. Keep the
 * upstream token-budget semantics; only checked IDs/ranks leave this adapter. */
export async function fastGPTCandidates(config: FastGPTRetrievalConfig, query: string, request: typeof fetch = fetch): Promise<FastGPTCandidate[]> {
  if (!query.trim() || query.length > 1000) fail('invalid_message', 422);
  let response: Response;
  try {
    response = await request(new URL('/api/core/dataset/searchTest', config.baseUrl), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId: config.datasetId, text: query, limit: 20000, similarity: 0,
        searchMode: 'mixedRecall', usingReRank: false, datasetSearchUsingExtensionQuery: false }),
    });
  } catch { return fail('retrieval_unavailable', 503); }
  if (!response.ok || !response.body) fail('retrieval_unavailable', 503);
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024 * 1024) { await reader.cancel(); fail('retrieval_unavailable', 503); }
      parts.push(value);
    }
    const packet = JSON.parse(Buffer.concat(parts).toString('utf8'));
    const rows = packet.data?.list;
    if (packet.error || !Array.isArray(rows) || rows.length > 100) fail('retrieval_unavailable', 503);
    const expected = new Map(config.chunks.map(c => [c.chunkIndex, c.sha256]));
    const seen = new Set<number>();
    return rows.map((row: Record<string, unknown>, index: number) => {
      const chunkIndex = Number(row.chunkIndex);
      if (row.datasetId !== config.datasetId || row.collectionId !== config.collectionId || typeof row.q !== 'string'
        || !Number.isInteger(chunkIndex) || seen.has(chunkIndex) || sha(row.q) !== expected.get(chunkIndex)) fail('context_changed');
      seen.add(chunkIndex);
      const scores = Array.isArray(row.score) ? row.score as Array<{ type?: string; value?: number; index?: number }> : [];
      const embeddingIndex = scores.find(x => x.type === 'embedding')?.index;
      const similarity = typeof row.score === 'number' ? row.score : scores.find(x => x.type === 'embedding')?.value;
      const lexical = scores.find(x => x.type === 'fullText')?.value;
      if (similarity === undefined && !(typeof lexical === 'number' && Number.isFinite(lexical) && lexical > 0)
        || similarity !== undefined && (typeof similarity !== 'number' || !Number.isFinite(similarity) || similarity < -1 || similarity > 1)) fail('retrieval_unavailable', 503);
      if (similarity !== undefined && (!Number.isInteger(embeddingIndex) || embeddingIndex! < 0)) fail('retrieval_unavailable', 503);
      return { chunkIndex, chunkSha256: expected.get(chunkIndex)!, rank: index + 1,
        semanticRank: embeddingIndex === undefined ? null : embeddingIndex + 1, similarity: similarity ?? null };
    });
  } catch (error) {
    if (error instanceof Error && ['context_changed', 'retrieval_unavailable'].includes(error.message)) throw error;
    return fail('retrieval_unavailable', 503);
  } finally { reader.releaseLock(); }
}
