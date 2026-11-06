import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { parseHTML } from 'linkedom';
import { AssistantError, fail, fingerprint } from '../contracts';
import type { ModelTool } from '../contracts/model';
import type { WebSourceLocator } from '../contracts/web-source';

export const webSearchProtocol = 'public-web-evidence-v1';
export type WebQuery = { query: string; domains: string[] };
export type WebPage = WebSourceLocator & { text: string };
export type WebSearchSnapshot = {
  version: 1; provider: string; query: WebQuery; status: 'ready' | 'empty' | 'unavailable';
  pages: WebPage[]; failures: Array<{ url?: string; code: string }>; retrievedAt: string;
  research?: import('./public-research').PublicResearchState;
  documents?: import('./public-research').PublicReadDocument[];
  candidates?: import('./public-research').PublicCandidate[];
};
export interface WebSearchProvider {
  readonly name: string;
  search(query: WebQuery): Promise<Array<{ url: string; title: string }>>;
}
export const webSearchTool: ModelTool = {
  name: 'search_web',
  description: '查询当前公开互联网并实际读取少量网页，用于最新产品参数、公开标准/政策和企业资料未覆盖的外部事实。query只传公共术语/产品型号，不传客户姓名、电话、地址、项目编号或私聊原话。domains可限定厂家/发布机关官网，空数组为不限。返回网页原文、网址和读取时间；搜索摘要不能当原文，网页不能证明企业承诺或你家现场，也不自动入企业知识库。',
  parameters: { type: 'object', properties: {
    query: { type: 'string', minLength: 2, maxLength: 240 },
    domains: { type: 'array', maxItems: 3, items: { type: 'string', description: '公开域名，例如厂家官网；不带路径/协议。' } },
  }, required: ['query', 'domains'], additionalProperties: false },
};

export function parseWebQuery(input: unknown): WebQuery {
  const value = input as WebQuery;
  if (!value || Array.isArray(value) || Object.keys(value).some(k => !['query', 'domains'].includes(k))
    || typeof value.query !== 'string' || value.query.trim().length < 2 || value.query.length > 240
    || !Array.isArray(value.domains) || value.domains.length > 3
    || value.domains.some(d => typeof d !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(d))) fail('invalid_web_query', 422);
  if (/\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:token|password|authorization|身份证|手机号|项目编号|客户姓名)\s*[:：=]|\b\d{15,18}\b/i.test(value.query)) fail('private_web_query', 422);
  for (const domain of value.domains) publicWebUrl('https://' + domain);
  return { query: value.query.trim(), domains: [...new Set(value.domains.map(d => d.toLowerCase()))] };
}

/** Reject special-use and embedded addresses before connecting; pin DNS below. */
export function publicWebAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    // Global unicast only. Exclude IPv4 embedding, transition and documentation ranges.
    return /^[23]/.test(normalized) && !/^200[12]:|^2001:db8:|^3fff:|^2001:0:|^2001:20:/.test(normalized);
  }
  return false;
}
export function publicWebUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return fail('unsafe_web_url', 422); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
    || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    || isIP(host) && !publicWebAddress(host)) fail('unsafe_web_url', 422);
  url.hash = ''; return url;
}

/** Public AliDNS DoH is opt-in; never accept fake/private answers or fall back after failure. */
export function publicDnsAnswers(input: unknown, host: string): Array<{ address: string; family: number }> {
  const value = input as { Status?: number; TC?: boolean; Question?: { name?: string } | Array<{ name?: string }>; Answer?: Array<{ type?: number; data?: string }> };
  const question = Array.isArray(value?.Question) ? value.Question[0] : value?.Question;
  if (value?.Status !== 0 || value.TC || question?.name?.replace(/\.$/, '').toLowerCase() !== host.toLowerCase()
    || !Array.isArray(value.Answer) || value.Answer.length > 32) fail('invalid_web_dns_response', 503);
  const addresses = value.Answer.filter(a => a.type === 1 || a.type === 28).map(a => ({ address: a.data || '', family: a.type === 1 ? 4 : 6 }));
  if (!addresses.length || addresses.some(a => isIP(a.address) !== a.family || !publicWebAddress(a.address))) fail('unsafe_web_url', 422);
  return addresses;
}

export async function resolvePublicWebHost(host: string, deadline: number): Promise<Array<{ address: string; family: number }>> {
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  const mode = process.env.ASSISTANT_WEB_DNS || 'system';
  if (mode === 'system') return lookup(host, { all: true });
  if (mode !== 'alidns') fail('invalid_web_dns_configuration', 503);
  const url = new URL('https://223.5.5.5/resolve');
  url.searchParams.set('name', host); url.searchParams.set('type', 'A');
  const data = await new Promise<unknown>((resolve, reject) => {
    const request = httpsRequest(url, { headers: { Accept: 'application/dns-json', 'Accept-Encoding': 'identity' } }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 32_000) request.destroy(new AssistantError('invalid_web_dns_response', 503)); else chunks.push(chunk); });
      response.once('error', reject);
      response.once('end', () => {
        if (response.statusCode !== 200) { reject(new AssistantError('web_dns_unavailable', 503)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new AssistantError('invalid_web_dns_response', 503)); }
      });
    });
    const timer = setTimeout(() => request.destroy(new AssistantError('web_timeout', 503)), Math.max(1, deadline - Date.now()));
    request.once('close', () => clearTimeout(timer)); request.once('error', reject); request.end();
  });
  return publicDnsAnswers(data, host);
}

/** No browser, scripts, cookies, proxy credentials or automatic redirects. */
export async function readPublicPage(value: string, remainingRedirects = 3, deadline = Date.now() + 12000): Promise<{ url: string; body: string; type: string }> {
  const url = publicWebUrl(value), host = url.hostname.replace(/^\[|\]$/g, '');
  if (deadline <= Date.now()) fail('web_timeout', 503);
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([resolvePublicWebHost(host, deadline), new Promise<never>((_resolve, reject) => {
    dnsTimer = setTimeout(() => reject(new AssistantError('web_timeout', 503)), deadline - Date.now());
  })]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(a => !publicWebAddress(a.address))) fail('unsafe_web_url', 422);
  const pinned = addresses.find(a => a.family === 4) || addresses[0];
  const result = await new Promise<{ body: string; status: number; location?: string; type: string }>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', headers: { Accept: 'text/html,text/plain;q=0.9', 'Accept-Encoding': 'identity', 'User-Agent': 'SmartFloorPlanner-Research/1.0' },
      family: pinned.family,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 512_000) request.destroy(new AssistantError('web_page_too_large', 502)); else chunks.push(chunk); });
      response.once('error', reject);
      response.once('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), status: response.statusCode || 0,
        location: response.headers.location, type: String(response.headers['content-type'] || '') }));
    });
    const timer = setTimeout(() => request.destroy(new AssistantError('web_timeout', 503)), Math.max(1, deadline - Date.now()));
    request.once('close', () => clearTimeout(timer));
    request.setTimeout(12000, () => request.destroy(new AssistantError('web_timeout', 503)));
    request.once('error', reject); request.end();
  });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    if (!result.location || remainingRedirects < 1) fail('web_redirect_limit', 502);
    return readPublicPage(new URL(result.location, url).href, remainingRedirects - 1, deadline);
  }
  if (result.status !== 200) fail('web_http_' + result.status, 503);
  if (!/^(?:text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/i.test(result.type)) fail('unsupported_web_content', 422);
  return { url: url.href, body: result.body, type: result.type };
}

/** Retain complete parsed article text; never make snippets into cited facts. */
export function extractWebPage(input: { url: string; body: string; type: string }, retrievedAt = new Date().toISOString()): WebPage {
  let title = new URL(input.url).hostname, text = input.body;
  if (/html/i.test(input.type)) {
    const { document } = parseHTML(input.body);
    title = document.title?.trim() || title;
    for (const element of document.querySelectorAll('script,style,noscript,iframe,nav,header,footer,form,svg,canvas,template')) element.remove();
    const main = document.querySelector('article') || document.querySelector('main') || document.body;
    if (!main) fail('web_text_unavailable', 502);
    text = main.innerText;
  }
  text = text.replace(/\r/g, '').split('\n').map(line => line.replace(/[\t \u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
  const textBytes = Buffer.byteLength(text);
  // JSONB cannot represent U+0000. Reject this page before building a durable
  // original/hash; searchWeb records the existing read-failure receipt and can
  // continue with other valid pages. Never silently edit a cited original.
  if (text.includes('\u0000') || title.includes('\u0000') || text.length < 40
    || /just a moment|verify you are human|enable javascript.*cookies|access denied|验证码|安全验证/i.test(text.slice(0, 500))) fail('web_text_unavailable', 502);
  if (textBytes > 12000) fail('web_page_too_large', 502);
  const url = publicWebUrl(input.url).href;
  return { url, title: title.slice(0, 200), text, retrievedAt, parser: 'public-html-text-v1', textBytes,
    hash: fingerprint({ url, title: title.slice(0, 200), text, retrievedAt }) };
}

export function searxngResults(input: unknown): Array<{ url: string; title: string }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_web_search_response', 502);
  const data = input as { results?: unknown; unresponsive_engines?: unknown };
  if (!Array.isArray(data.results) || data.unresponsive_engines !== undefined && !Array.isArray(data.unresponsive_engines)) fail('invalid_web_search_response', 502);
  const results = data.results.flatMap(item => item && typeof item === 'object' && typeof item.url === 'string' && typeof item.title === 'string'
    ? [{ url: item.url, title: item.title }] : []).slice(0, 8);
  // SearXNG may return HTTP200 with no results because every upstream failed.
  // Do not report that as evidence that the requested public information is absent.
  if (!results.length && Array.isArray(data.unresponsive_engines) && data.unresponsive_engines.length) fail('web_search_upstream_unavailable', 503);
  return results;
}

/** A provider boundary: changing search services does not change Agent/Evidence. */
export function configuredWebProvider(): WebSearchProvider | null {
  if (process.env.ASSISTANT_WEB_SEARCH_PROVIDER !== 'searxng' || !process.env.ASSISTANT_WEB_SEARCH_URL) return null;
  let base: URL;
  try { base = new URL(process.env.ASSISTANT_WEB_SEARCH_URL); } catch { return null; }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null;
  return { name: 'searxng', async search(query) {
    const url = new URL('search', base.href.endsWith('/') ? base : base.href + '/');
    url.searchParams.set('q', query.query + (query.domains.length ? ' (' + query.domains.map(d => 'site:' + d).join(' OR ') + ')' : ''));
    url.searchParams.set('format', 'json'); url.searchParams.set('language', 'zh-CN'); url.searchParams.set('safesearch', '1');
    const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) fail('web_search_http_' + response.status, 503);
    if (!response.body) fail('invalid_web_search_response', 502);
    const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 512000) fail('web_search_response_too_large', 502);
        chunks.push(Buffer.from(chunk.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    return searxngResults(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } };
}
export async function searchWeb(query: WebQuery, provider = configuredWebProvider(), read = readPublicPage): Promise<WebSearchSnapshot> {
  const retrievedAt = new Date().toISOString();
  const snapshot: WebSearchSnapshot = { version: 1, provider: provider?.name || 'unconfigured', query, retrievedAt, status: 'unavailable', pages: [], failures: [] };
  if (!provider) { snapshot.failures.push({ code: 'web_search_unconfigured' }); return snapshot; }
  try {
    const candidates = await provider.search(query), seen = new Set<string>();
    for (const candidate of candidates) {
      if (snapshot.pages.length >= 2 || seen.size >= 3) break;
      let url: URL;
      try { url = publicWebUrl(candidate.url); } catch { snapshot.failures.push({ code: 'unsafe_web_url' }); continue; }
      if (query.domains.length && !query.domains.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) continue;
      if (seen.has(url.href)) continue; seen.add(url.href);
      try {
        const page = extractWebPage(await read(url.href), retrievedAt);
        if (query.domains.length && !query.domains.some(d => new URL(page.url).hostname === d || new URL(page.url).hostname.endsWith('.' + d))) fail('web_domain_changed', 422);
        if (snapshot.pages.reduce((n, p) => n + p.textBytes, page.textBytes) > 18000) { snapshot.failures.push({ url: page.url, code: 'web_context_limit' }); continue; }
        snapshot.pages.push(page);
      } catch (error) { snapshot.failures.push({ url: url.href, code: error instanceof AssistantError ? error.code : 'web_read_unavailable' }); }
    }
    snapshot.status = snapshot.pages.length ? 'ready' : candidates.length ? 'unavailable' : 'empty';
  } catch (error) { snapshot.failures.push({ code: error instanceof AssistantError ? error.code : 'web_search_unavailable' }); }
  return snapshot;
}
