import type { EmbeddingGateway } from '../contracts';
import { fail, fingerprint } from '../contracts';

export const EMBEDDING_PROFILE = Object.freeze({
  id: 'qwen3-embedding-0.6b-1024-zh-v1', model: 'Qwen/Qwen3-Embedding-0.6B',
  revision: '97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3', dimensions: 1024,
  normalized: true, dtype: 'float16', maxTokens: 512, overlapTokens: 64,
  queryInstruction: 'Given a renovation customer question, retrieve relevant company knowledge passages that answer the question.',
  lexicalVersion: 'zh-renovation-dictionary-bigram-v1', chunkVersion: 'tokens-512-overlap-64-v1',
});

export function configuredEmbeddingProfile(env = process.env) {
  const provider = env.ASSISTANT_EMBEDDING_PROVIDER || 'local';
  if (provider === 'local') return EMBEDDING_PROFILE;
  const model = env.ASSISTANT_EMBEDDING_MODEL?.trim(), revision = env.ASSISTANT_EMBEDDING_REVISION?.trim();
  if (provider !== 'openai_compatible' || !model || !revision || model.length > 160 || revision.length > 160
    || /[\x00-\x1f]/u.test(model + revision)) fail('retrieval_unavailable', 503);
  const configuration = { provider, model, revision, dimensions: EMBEDDING_PROFILE.dimensions, normalized: true,
    maxTokens: 512, overlapTokens: 64, lexicalVersion: EMBEDDING_PROFILE.lexicalVersion, chunkVersion: 'whole-paragraph-utf8-v1' };
  return { id: 'openai-compatible-' + fingerprint(configuration).slice(0, 24), ...configuration };
}

export function assertEmbeddingProfile(gateway: EmbeddingGateway, expected = configuredEmbeddingProfile()) {
  const { model, revision, dimensions } = gateway.profile;
  if (model !== expected.model || revision !== expected.revision || dimensions !== expected.dimensions) fail('retrieval_unavailable', 503);
}

export function embeddingGateway(options?: { url: string; apiKey: string; timeoutMs?: number; fetch?: typeof fetch }): EmbeddingGateway {
  const profile = configuredEmbeddingProfile(), local = 'queryInstruction' in profile;
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
  const basePath = endpoint.pathname.replace(/\/+$/u, '');
  const target = local || !basePath ? new URL('/v1/embeddings', endpoint)
    : new URL(basePath.endsWith('/embeddings') ? basePath : basePath + '/embeddings', endpoint);
  return {
    profile,
    async embed(texts, kind, signal) {
      if (!['query', 'document'].includes(kind) || !Array.isArray(texts) || !texts.length || texts.length > 8
        || texts.some(t => typeof t !== 'string' || !t.trim() || t.length > 12000)) fail('invalid_embedding_input', 422);
      const input = local && kind === 'query' ? texts.map(t => `Instruct: ${profile.queryInstruction}\nQuery:${t}`) : texts;
      const body = JSON.stringify({ model: profile.model, input, dimensions: profile.dimensions,
        encoding_format: 'float', ...(local ? { input_type: kind } : {}) });
      if (Buffer.byteLength(body) > 65536) fail('invalid_embedding_input', 422);
      try {
        // No automatic retries/fallback: a timeout may have consumed GPU work.
        const timeout = AbortSignal.timeout(timeoutMs);
        const response = await request(target, {
          method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body, signal: signal ? AbortSignal.any([timeout, signal]) : timeout, redirect: 'error',
        });
        if (response.status === 422 || response.status === 413) fail('invalid_embedding_input', 422);
        if (!response.ok) fail('retrieval_unavailable', 503);
        const data = await response.json();
        if (data.model !== profile.model || (local && (data.revision !== profile.revision || data.profile !== profile.id))
          || !Array.isArray(data.data) || data.data.length !== texts.length) fail('retrieval_unavailable', 503);
        const vectors: number[][] = new Array(texts.length);
        for (const row of data.data) {
          if (!Number.isInteger(row.index) || row.index < 0 || row.index >= texts.length || vectors[row.index]
            || !Array.isArray(row.embedding) || row.embedding.length !== profile.dimensions
            || row.embedding.some((x: unknown) => typeof x !== 'number' || !Number.isFinite(x))) fail('retrieval_unavailable', 503);
          const norm = Math.sqrt(row.embedding.reduce((sum: number, x: number) => sum + x * x, 0));
          if (!Number.isFinite(norm) || norm === 0 || local && Math.abs(norm - 1) > 0.002) fail('retrieval_unavailable', 503);
          vectors[row.index] = local ? row.embedding : row.embedding.map((value: number) => value / norm);
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
