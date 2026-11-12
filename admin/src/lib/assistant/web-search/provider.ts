import { fail } from '../contracts';
import { parseWebQuery, publicWebUrl } from '../agent/web';
import {
  webSearchLimits, type WebSearchHit, type WebSearchProvider,
  type WebSearchProviderResult, type WebSearchRequest,
} from './contract';

/**
 * Search adapters for deployment-configured public search services.
 *
 * Only the documented JSON endpoints already used by this project are
 * supported: SearXNG `/search?format=json`, DDGS `/search/text`, and
 * OpenSERP `/mega/search`. No vendor request parameter is invented here; a
 * service that does not document news returns `web_search_news_unsupported`
 * instead of fabricating news results.
 */

type JsonPacket = { ok: boolean; status: number; payload: unknown };

const knownOpenserpFailures = new Set([
  'captcha_detected', 'blocked', 'rate_limited', 'search_timeout', 'request_timeout',
  'proxy_connect', 'proxy_auth', 'proxy_timeout', 'proxy_unavailable', 'parser_failure',
  'all_engines_failed', 'circuit_open',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\t \u00a0]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, limit) : null;
}

function cleanPublishedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  return year >= 1990 && year <= 2100 ? date.toISOString() : null;
}

function toHit(input: { url: unknown; title: unknown; snippet: unknown; publishedAt: unknown }, rank: number): WebSearchHit | null {
  if (typeof input.url !== 'string') return null;
  let url: URL;
  try { url = publicWebUrl(input.url); } catch { return null; }
  const title = cleanText(input.title, webSearchLimits.maxTitleChars);
  if (!title) return null;
  return {
    rank, title, url: url.href, domain: url.hostname,
    snippet: cleanText(input.snippet, webSearchLimits.maxSnippetChars),
    publishedAt: cleanPublishedAt(input.publishedAt),
  };
}

/** URL identity is the only dedupe key; titles can legitimately repeat. */
function dedupeHits(hits: Array<WebSearchHit | null>, limit: number): WebSearchHit[] {
  const seen = new Set<string>(), result: WebSearchHit[] = [];
  for (const hit of hits) {
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    result.push({ ...hit, rank: result.length + 1 });
    if (result.length >= limit) break;
  }
  return result;
}

function unsupportedNews(provider: string): never {
  return fail(`web_search_news_unsupported:${provider}`, 422);
}

function queryWithDomains(query: string, domains: string[]) {
  return query + (domains.length ? ' (' + domains.map(domain => 'site:' + domain).join(' OR ') + ')' : '');
}

function validateRequest(request: WebSearchRequest) {
  const query = parseWebQuery({ query: request.query, domains: request.domains });
  if (!['web', 'news'].includes(request.kind)) fail('invalid_web_search_request', 422);
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > webSearchLimits.maxResults) {
    fail('invalid_web_search_request', 422);
  }
  return { ...query, kind: request.kind, limit: request.limit, signal: request.signal };
}

/** Read a bounded JSON response. The search endpoint is deployment-owned and
 * redirects are refused; model input never selects it. */
async function readSearchJson(url: URL, external?: AbortSignal): Promise<JsonPacket> {
  const timeout = AbortSignal.timeout(webSearchLimits.searchTimeoutMs);
  const signal = external ? AbortSignal.any([external, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, { signal, redirect: 'error', headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    if (timeout.aborted) return fail('web_search_timeout', 503);
    if (external?.aborted) return fail('web_search_aborted', 503);
    return fail('web_search_unavailable', 503);
  }
  if (!response.body) fail('invalid_web_search_response', 502);
  const reader = response.body.getReader(), chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > webSearchLimits.maxResponseBytes) fail('web_search_response_too_large', 502);
      chunks.push(Buffer.from(part.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(response.ok ? 'invalid_web_search_response' : `web_search_http_${response.status}`, 502); }
  return { ok: response.ok, status: response.status, payload };
}

export function searxngSearchHits(packet: unknown, limit: number): WebSearchHit[] {
  const data = asRecord(packet);
  if (!data || !Array.isArray(data.results)) fail('invalid_web_search_response', 502);
  if (data.unresponsive_engines !== undefined && !Array.isArray(data.unresponsive_engines)) {
    fail('invalid_web_search_response', 502);
  }
  const hits = data.results.map(raw => {
    const item = asRecord(raw);
    if (!item) return null;
    return toHit({
      url: item.url, title: item.title,
      snippet: item.content,
      // SearXNG news engines may expose `publishedDate`; ordinary results
      // usually omit it, in which case the field stays null.
      publishedAt: item.publishedDate ?? item.published_at ?? null,
    }, 0);
  });
  const results = dedupeHits(hits, limit);
  if (!results.length && Array.isArray(data.unresponsive_engines) && data.unresponsive_engines.length) {
    fail('web_search_upstream_unavailable', 503);
  }
  return results;
}

export function ddgsSearchHits(packet: unknown, limit: number): WebSearchHit[] {
  const data = asRecord(packet);
  if (!data || !Array.isArray(data.results)) fail('invalid_web_search_response', 502);
  return dedupeHits(data.results.map(raw => {
    const item = asRecord(raw);
    if (!item) return null;
    // DDGS results are documented as href/title/body; body is a search snippet.
    return toHit({ url: item.href, title: item.title, snippet: item.body, publishedAt: null }, 0);
  }), limit);
}

export function openserpSearchHits(packet: unknown, limit: number): WebSearchHit[] {
  const data = asRecord(packet);
  if (!data || !Array.isArray(data.results)) fail('invalid_web_search_response', 502);
  const meta = asRecord(data.meta);
  if (!meta || !Array.isArray(meta.engines_responded) || !Array.isArray(meta.engines_failed)) {
    fail('invalid_web_search_response', 502);
  }
  const hits = data.results.flatMap(raw => {
    const item = asRecord(raw);
    // Ads, answers and provider extraction are not organic sources.
    if (!item || item.type !== 'organic') return [];
    const hit = toHit({ url: item.url, title: item.title, snippet: item.snippet, publishedAt: null }, 0);
    return hit ? [hit] : [];
  });
  const results = dedupeHits(hits, limit);
  if (!results.length && meta.engines_failed.length) fail('web_search_upstream_unavailable', 503);
  return results;
}

export type WebSearchProviderConfig = {
  provider: 'searxng' | 'ddgs' | 'openserp';
  baseUrl: string;
  ddgsBackend?: string;
  openserpEngines?: string;
};

/** Deployment configuration only. No API key is read or logged here; a future
 * commercial adapter may add its own encrypted key through the same boundary. */
export function webSearchProviderConfig(env: Record<string, string | undefined> = process.env): WebSearchProviderConfig | null {
  const provider = env.ASSISTANT_WEB_SEARCH_PROVIDER?.trim();
  if (!['searxng', 'ddgs', 'openserp'].includes(provider || '') || !env.ASSISTANT_WEB_SEARCH_URL?.trim()) return null;
  let base: URL;
  try { base = new URL(env.ASSISTANT_WEB_SEARCH_URL.trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null;
  const engines = env.ASSISTANT_OPENSERP_ENGINES || 'baidu';
  if (provider === 'openserp'
    && !/^(?:baidu|bing|google|duckduckgo|yandex|ecosia)(?:,(?:baidu|bing|google|duckduckgo|yandex|ecosia))*$/.test(engines)) return null;
  return {
    provider: provider as WebSearchProviderConfig['provider'], baseUrl: base.href,
    ...(provider === 'ddgs' ? { ddgsBackend: env.ASSISTANT_DDGS_BACKEND || 'yahoo' } : {}),
    ...(provider === 'openserp' ? { openserpEngines: engines } : {}),
  };
}

export function createWebSearchProvider(config: WebSearchProviderConfig): WebSearchProvider {
  let base: URL;
  try { base = new URL(config.baseUrl); } catch { return fail('invalid_web_search_configuration', 503); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    fail('invalid_web_search_configuration', 503);
  }
  const endpoint = (path: string) => new URL(path, base.href.endsWith('/') ? base.href : base.href + '/');
  return {
    name: config.provider,
    supportsNews: config.provider === 'searxng',
    async search(request: WebSearchRequest): Promise<WebSearchProviderResult> {
      const input = validateRequest(request);
      if (input.kind === 'news' && config.provider !== 'searxng') return unsupportedNews(config.provider);
      let url: URL;
      if (config.provider === 'ddgs') {
        url = endpoint('search/text');
        url.searchParams.set('query', queryWithDomains(input.query, input.domains));
        url.searchParams.set('region', 'cn-zh');
        url.searchParams.set('safesearch', 'moderate');
        url.searchParams.set('max_results', String(input.limit));
        url.searchParams.set('backend', config.ddgsBackend || 'yahoo');
      } else if (config.provider === 'openserp') {
        url = endpoint('mega/search');
        url.searchParams.set('text', queryWithDomains(input.query, input.domains));
        url.searchParams.set('limit', String(input.limit));
        url.searchParams.set('engines', config.openserpEngines || 'baidu');
        url.searchParams.set('extract', '0');
      } else {
        url = endpoint('search');
        url.searchParams.set('q', queryWithDomains(input.query, input.domains));
        url.searchParams.set('format', 'json');
        url.searchParams.set('language', 'zh-CN');
        url.searchParams.set('safesearch', '1');
        url.searchParams.set('pageno', '1');
        url.searchParams.set('categories', input.kind === 'news' ? 'news' : 'general');
      }
      const packet = await readSearchJson(url, input.signal);
      if (!packet.ok) {
        const error = asRecord(packet.payload)?.error;
        if (config.provider === 'openserp' && typeof error === 'string' && knownOpenserpFailures.has(error)) {
          fail('web_search_upstream_' + error, 503);
        }
        fail('web_search_http_' + packet.status, 503);
      }
      const results = config.provider === 'openserp' ? openserpSearchHits(packet.payload, input.limit)
        : config.provider === 'ddgs' ? ddgsSearchHits(packet.payload, input.limit)
          : searxngSearchHits(packet.payload, input.limit);
      return {
        provider: config.provider, query: input.query, kind: input.kind,
        retrievedAt: new Date().toISOString(), results,
      };
    },
  };
}

export function configuredWebSearchProvider(env: Record<string, string | undefined> = process.env): WebSearchProvider | null {
  const config = webSearchProviderConfig(env);
  return config ? createWebSearchProvider(config) : null;
}
