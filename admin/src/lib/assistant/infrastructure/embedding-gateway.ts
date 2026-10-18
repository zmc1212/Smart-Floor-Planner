import type { EmbeddingGateway } from '../contracts';
import { fail } from '../contracts';

export const EMBEDDING_PROFILE = Object.freeze({
  id: 'qwen3-embedding-0.6b-1024-zh-v1', model: 'Qwen/Qwen3-Embedding-0.6B',
  revision: '97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3', dimensions: 1024,
  normalized: true, dtype: 'float16', maxTokens: 512, overlapTokens: 64,
  queryInstruction: 'Given a renovation customer question, retrieve relevant company knowledge passages that answer the question.',
  lexicalVersion: 'zh-renovation-dictionary-bigram-v1', chunkVersion: 'tokens-512-overlap-64-v1',
});

export function embeddingGateway(options?: { url: string; apiKey: string; timeoutMs?: number; fetch?: typeof fetch }): EmbeddingGateway {
  const url = options?.url ?? process.env.ASSISTANT_EMBEDDING_URL ?? '';
  const apiKey = options?.apiKey ?? process.env.ASSISTANT_EMBEDDING_API_KEY ?? '';
  let endpoint: URL;
  try { endpoint = new URL(url); } catch { return fail('retrieval_unavailable', 503); }
  if (!apiKey || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !['https:', 'http:'].includes(endpoint.protocol)
    || (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) fail('retrieval_unavailable', 503);
  const timeoutMs = options?.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('retrieval_unavailable', 503);
  const request = options?.fetch ?? fetch;
  return {
    profile: EMBEDDING_PROFILE,
    async embed(texts, kind) {
      if (!['query', 'document'].includes(kind) || !Array.isArray(texts) || !texts.length || texts.length > 8
        || texts.some(t => typeof t !== 'string' || !t.trim() || t.length > 12000)) fail('invalid_embedding_input', 422);
      const input = texts.map(t => kind === 'query' ? `Instruct: ${EMBEDDING_PROFILE.queryInstruction}\nQuery:${t}` : t);
      const body = JSON.stringify({ model: EMBEDDING_PROFILE.model, input, input_type: kind, dimensions: 1024, encoding_format: 'float' });
      if (Buffer.byteLength(body) > 65536) fail('invalid_embedding_input', 422);
      try {
        // No automatic retries/fallback: a timeout may have consumed GPU work.
        const response = await request(new URL('/v1/embeddings', endpoint), {
          method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body, signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
        });
        if (response.status === 422 || response.status === 413) fail('invalid_embedding_input', 422);
        if (!response.ok) fail('retrieval_unavailable', 503);
        const data = await response.json();
        if (data.model !== EMBEDDING_PROFILE.model || data.revision !== EMBEDDING_PROFILE.revision
          || data.profile !== EMBEDDING_PROFILE.id || !Array.isArray(data.data) || data.data.length !== texts.length) fail('retrieval_unavailable', 503);
        const vectors: number[][] = new Array(texts.length);
        for (const row of data.data) {
          if (!Number.isInteger(row.index) || row.index < 0 || row.index >= texts.length || vectors[row.index]
            || !Array.isArray(row.embedding) || row.embedding.length !== 1024
            || row.embedding.some((x: unknown) => typeof x !== 'number' || !Number.isFinite(x))) fail('retrieval_unavailable', 503);
          const norm = Math.sqrt(row.embedding.reduce((sum: number, x: number) => sum + x * x, 0));
          if (Math.abs(norm - 1) > 0.002) fail('retrieval_unavailable', 503);
          vectors[row.index] = row.embedding;
        }
        const tokens = data.usage?.prompt_tokens;
        const usage = Number.isSafeInteger(tokens) && tokens > 0 ? { inputTokens: tokens } : null;
        return { vectors, usage };
      } catch (error) {
        if (error instanceof Error && error.message === 'invalid_embedding_input') throw error;
        return fail('retrieval_unavailable', 503);
      }
    },
  };
}
