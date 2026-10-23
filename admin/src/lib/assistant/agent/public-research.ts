import { createHash } from 'node:crypto';
import { AssistantError, fail, fingerprint } from '../contracts';
import { configuredWebProvider, publicWebUrl, type WebQuery, type WebPage, type WebSearchProvider, type WebSearchSnapshot } from './web';
import type { ModelTool } from '../contracts/model';

export const publicReaderParser = 'crawl4ai-static-0.9.2+pypdf-6.21.2-v1';
export type PublicReadDocument = { version: 1; url: string; title: string; parser: typeof publicReaderParser;
  mediaType: string; pages: Array<{ page: number; text: string }>; links: Array<{ url: string; title: string }>;
  redirects: Array<{ from: string; to: string; status: number }>;
  original: { sha256: string; bytes: number; base64: string }; egress: string; tlsVerification: true };
export type PublicResearchState = { version: 1; startedAt: string; queries: WebQuery[];
  visited: string[]; reads: number; navigation: Array<{ url: string; parent: string | null; depth: number; outcome: string }>;
  refinements?: Array<{ query: WebQuery; from: { url: string; title: string; alias: string } }>;
  discoveries?: Array<{ query: WebQuery; candidates: Array<{ url: string; title: string }> }>;
  selection?: { protocol: 'document-purpose-frontier-v1'; documentHash: string; complete: boolean; technicalHint: boolean } };
export type PublicReader = (url: string, remainingMs: number) => Promise<PublicReadDocument>;
export type PublicCandidate = { id: string; url: string; title: string; parent: string | null; depth: number };
export const publicDiscoveryScopeProtocol = 'public-domain-provenance-v1';
/** Narrowing a search requires a user-supplied domain or an actual discovered
 * host. Model guesses are recorded but cannot erase the public search space.
 * This is discovery provenance only; all reader SSRF/TLS checks still apply. */
export function publicDiscoveryQuery(query: WebQuery, question: string, discoveredUrls: string[]) {
  const hosts = new Set<string>();
  for (const match of question.matchAll(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,63}(?::\d+)?(?:\/[^\s，。！？；、"'<>]*)?/gi)) {
    try { hosts.add(publicWebUrl(/^https?:\/\//i.test(match[0]) ? match[0] : 'https://' + match[0]).hostname); } catch { /* Not a usable public source. */ }
  }
  for (const url of discoveredUrls) { try { hosts.add(publicWebUrl(url).hostname); } catch { /* Never promote invalid candidates. */ } }
  const allowed = (domain: string) => [...hosts].some(host => host === domain || host.endsWith('.' + domain));
  const inline = [...query.query.matchAll(/\bsite:((?:[a-z0-9-]+\.)+[a-z]{2,63})/gi)].map(match=>match[1].toLowerCase());
  const requested = [...new Set([...query.domains,...inline])], rejected = requested.filter(domain=>!allowed(domain));
  const text = query.query.replace(/\bsite:((?:[a-z0-9-]+\.)+[a-z]{2,63})(?:\/[^\s]*)?/gi,
    (match,domain:string)=>allowed(domain.toLowerCase())?match:'').trim();
  if (!text) fail('invalid_web_query',422);
  return { query: { ...query, query:text, domains:query.domains.filter(allowed) },
    scope: { protocol:publicDiscoveryScopeProtocol,requestedDomains:requested,rejectedDomains:rejected } };
}
export const readWebTool: ModelTool = { name: 'read_web',
  description: '实际读取本run search_web或read_web返回的一个公开候选。只传候选id，不能传自造URL、客户信息或前轮编号。按真实出链受控导航到相关原文/PDF，返回完整原页、条件、页码和读取失败；搜索摘要不是依据，公开原文不证明企业采用或本人现场达标。',
  parameters: {type:'object',properties:{candidateId:{type:'string',minLength:6,maxLength:80}},required:['candidateId'],additionalProperties:false} };
export function parsePublicRead(value: unknown): { candidateId: string } {
  const input = value as Record<string,unknown>;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1
    || typeof input.candidateId !== 'string' || !/^P[1-9]\d{0,18}:12\d{2}:\d{1,3}$/.test(input.candidateId)) fail('invalid_web_candidate',422);
  return {candidateId:input.candidateId};
}
export function publicResearchTools(tools: ModelTool[], enabled: boolean): ModelTool[] {
  if (!enabled || !tools.some(tool=>tool.name==='search_web')) return tools;
  return [...tools.map(tool=>tool.name!=='search_web'?tool:{...tool,
    description:'发现公开互联网候选，query只传公共术语/厂家/产品，不传客户姓名、电话、地址、项目编号或私聊原话。domains只能用客户明确提供或本run实际发现的域名，未知填[]，不根据品牌猜官网。返回实际候选id、标题和网址，尚未读取原文，搜索摘要不得当证据；要核实请用read_web选择实际候选。最多三个查询，与读取共用本run有界研究时限。'}),readWebTool];
}
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const inDomains = (url: string, domains: string[]) => !domains.length || domains.some(domain => {
  const host = new URL(url).hostname; return host === domain || host.endsWith('.' + domain);
});

/** Verify the private reader packet before it can become an Evidence source.
 * Original bytes remain in the existing private checkpoint, never model input. */
export function validPublicDocument(value: PublicReadDocument) {
  if (!value || value.version !== 1 || value.parser !== publicReaderParser || value.tlsVerification !== true
    || value.egress !== 'upstream-v0.9.2-resolve-and-pin-proxy' || !value.original
    || !Number.isSafeInteger(value.original.bytes) || value.original.bytes < 1 || value.original.bytes > 4 * 1024 * 1024
    || typeof value.original.base64 !== 'string' || value.original.base64.length > 5_592_408
    || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 50
    || !Array.isArray(value.links) || value.links.length > 100 || !Array.isArray(value.redirects) || value.redirects.length > 3) return false;
  try {
    publicWebUrl(value.url);
    for (const redirect of value.redirects) { publicWebUrl(redirect.from); publicWebUrl(redirect.to); }
    const bytes = Buffer.from(value.original.base64, 'base64');
    if (bytes.length !== value.original.bytes || digest(bytes) !== value.original.sha256) return false;
    if (value.mediaType === 'application/pdf' && bytes.subarray(0,4).toString() !== '%PDF') return false;
    return value.pages.every((page, index) => page.page === index + 1 && typeof page.text === 'string')
      && value.pages.reduce((sum, page) => sum + Buffer.byteLength(page.text), 0) <= 2_000_000;
  } catch { return false; }
}

export async function configuredPublicRead(url: string, remainingMs: number): Promise<PublicReadDocument> {
  publicWebUrl(url);
  // Private purpose-built reader only; never accept a URL supplied by the model
  // as the service endpoint, OS proxy credentials or arbitrary local services.
  if (process.env.ASSISTANT_PUBLIC_READER_URL !== 'http://127.0.0.1:18095') fail('web_reader_unconfigured', 503);
  const response = await fetch('http://127.0.0.1:18095/read', { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, remainingMs }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(remainingMs, 28000))) });
  if (!response.body) fail('web_reader_unavailable', 503);
  const stream = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await stream.read(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > 8_000_000) fail('web_reader_response_limit', 502);
      chunks.push(Buffer.from(chunk.value));
    }
  } finally { await stream.cancel().catch(() => {}); }
  const packet = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!response.ok) fail(typeof packet.code === 'string' && /^(?:web_|pdf_|unsafe_web_|unsupported_web_|invalid_pdf|encrypted_pdf|reader_version_)[a-z0-9_]*$/.test(packet.code)
    ? packet.code : 'web_reader_unavailable', 503);
  const document = packet as PublicReadDocument;
  if (!validPublicDocument(document)) fail('invalid_web_reader_response', 502);
  return document;
}

/** Complete original pages only. Oversized pages stay in the immutable read
 * with an explicit context-limit result; no truncated clause becomes evidence. */
export function publicDocumentPages(document: PublicReadDocument, retrievedAt: string): WebPage[] {
  if (!validPublicDocument(document)) fail('invalid_web_reader_response', 502);
  return document.pages.filter(page => Buffer.byteLength(page.text) <= 12000 && (document.mediaType === 'application/pdf' || page.text.trim().length >= 40)).map(page => {
    const locator: Omit<WebPage, 'hash' | 'text'> = { url: document.url, title: document.title, retrievedAt, parser: publicReaderParser,
      textBytes: Buffer.byteLength(page.text), document: { hash: document.original.sha256, mediaType: document.mediaType,
        page: page.page, pages: document.pages.length, bytes: document.original.bytes } };
    return { ...locator, text: page.text, hash: fingerprint({ ...locator, text: page.text }) };
  });
}

/** Ranking guides reads, never proves authorship/authority or facts. No test
 * manufacturer URL/domain, expected answer or search snippet enters Evidence. */
export function rankPublicCandidate(candidate: { url: string; title: string }, query: string) {
  let path = candidate.url;
  try { path = decodeURI(path); } catch { /* Unsafe/malformed candidates are rejected before reads. */ }
  let pathname = ''; try { pathname = new URL(candidate.url).pathname; } catch { return 0; }
  const text = path.toLowerCase() + ' ' + candidate.title.toLowerCase();
  const tokens = text.replace(/[^a-z0-9\p{Script=Han}]/gu, '');
  const terms = query.toLowerCase().match(/[a-z]{3,}|[\p{Script=Han}]{2,}/gu) || [];
  return terms.filter(term => text.includes(term)).length * 3
    + (/地暖|地热|地熱|underfloor|floor.heating/i.test(query) && /underfloorheating|floorheating|地暖|地熱|地热/i.test(tokens) ? 12 : 0)
    + (/地板|floor|laminate/i.test(query) ? (text.match(/floor|laminate|vinyl|wood|timber/g) || []).length : 0)
    // CMS download endpoints need not end in .pdf. This is only a navigation
    // hint from the actual link; downloaded MIME/magic/hash still decide type.
    + (/pdf|\.docx?(?:\?|$)/i.test(pathname) ? 8 : 0)
    + (/install|technical|manual|instruction|download|安装|安裝|技术|技術|下载|下載|地暖|地熱|地热/.test(text) ? 5 : 0)
    + (/official|官网|官方/.test(text) ? 2 : 0);
}

const originalQuery = (query: string) => /官方|官网|厂家|原文|手册|安装|official|manufacturer|manual|instruction|installation/i.test(query);
/** Separate document purpose from file type. A PDF brochure is not a technical
 * manual merely because it is a PDF. These classes guide navigation only;
 * authorship, applicability and facts still require the actual original. */
export function publicNavigationClass(candidate: { url: string; title: string; parent?: string | null }) {
  let text = candidate.url + ' ' + candidate.title;
  try { text = decodeURI(text); } catch { /* Keep the actual unnormalized label. */ }
  let pathname: string; try { pathname = new URL(candidate.url).pathname; } catch { return 0; }
  const document = /pdf|\.docx?(?:\?|$)/i.test(pathname);
  const technical = /install|manual|instruction|technical|underfloor|floor[-_\s]?heating|安装|安裝|技术|技術|手册|地暖|地热|地熱/i.test(text);
  return technical ? document ? 4 : 3 : candidate.parent === null ? 2 : document ? 1 : 0;
}
const compareFrontier = (a: { url: string; title: string; parent?: string | null }, b: { url: string; title: string; parent?: string | null }, query: string) =>
  (originalQuery(query) ? publicNavigationClass(b) - publicNavigationClass(a) : 0) || rankPublicCandidate(b,query) - rankPublicCandidate(a,query);

/** Discovery-only query decomposition. An actual public result may expose a
 * foreign brand spelling absent from the original language. Re-search that
 * exact bounded label for its directory; never construct a domain, insert an
 * expected document or treat the label/search result as evidence of authority. */
export function publicOriginalRefinement(query: WebQuery, candidates: Array<{ url: string; title: string }>) {
  if (!originalQuery(query.query)) return null;
  for (const candidate of candidates) {
    try { publicWebUrl(candidate.url); } catch { continue; }
    const alias = candidate.title.match(/(?<![A-Za-z0-9])([A-Z][A-Z0-9-]{2,}(?:[ \t]+[A-Z][A-Z0-9-]{1,}){0,3})(?![A-Za-z0-9])/)?.[1];
    if (!alias || alias.length > 48 || /^(?:PDF|HTML|HTTP|HTTPS|DOCX|XLSX|WWW|ISO|EN|GB)(?:\s|$)/.test(alias)) continue;
    return { query: { query: alias + ' 官网', domains: [...query.domains] }, from: { url: candidate.url, title: candidate.title, alias } };
  }
  return null;
}

export async function searchPublicResearch(query: WebQuery, provider: WebSearchProvider | null = configuredWebProvider(),
  read: PublicReader = configuredPublicRead, previous?: PublicResearchState, deadlineAt = Infinity,
  mode?: { runId: string; sequence: number; discoverOnly?: boolean; selected?: PublicCandidate; alternatives?: PublicCandidate[] }): Promise<WebSearchSnapshot> {
  const retrievedAt = new Date().toISOString();
  const state: PublicResearchState = previous ? structuredClone(previous) : { version: 1, startedAt: retrievedAt, queries: [], visited: [], reads: 0, navigation: [] };
  const deadline = Math.min(Date.parse(state.startedAt) + 60000, deadlineAt);
  const result: WebSearchSnapshot = { version: 1, provider: provider?.name || 'unconfigured', query,
    retrievedAt, status: 'unavailable', pages: [], failures: [], documents: [], research: state, ...(mode?{candidates:[]}: {}) };
  if (!provider && !mode?.selected) { result.failures.push({ code: 'web_search_unconfigured' }); return result; }
  if (!mode?.selected && state.queries.length >= 3 || Date.now() >= deadline || !mode?.discoverOnly && state.reads >= 6) {
    result.failures.push({ code: 'web_research_limit' }); return result;
  }
  if (!mode?.selected) state.queries.push(query);
  const queue: Array<{ url: string; title: string; parent: string | null; depth: number }> = [];
  try {
    const search = async (input: WebQuery) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const candidates = await Promise.race([provider!.search(input), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AssistantError('web_timeout', 503)), Math.max(1, Math.min(12000, deadline - Date.now())));
      })]).finally(() => clearTimeout(timer));
      (state.discoveries ||= []).push({ query: input, candidates: candidates.slice(0,8) });
      return candidates;
    };
    let candidates = mode?.selected ? [mode.selected, ...(mode.alternatives || []).filter(c => c.id !== mode.selected!.id)] : await search(query);
    if (mode?.discoverOnly && state.queries.length < 3 && Date.now() < deadline) {
      const refinement = publicOriginalRefinement(query, candidates);
      if (refinement && !state.queries.some(old => fingerprint(old) === fingerprint(refinement.query))) {
        state.queries.push(refinement.query); (state.refinements ||= []).push(refinement);
        // The refined frontier owns this directory search. Do not let a highly
        // ranked old aggregator branch consume its entire read budget. Both
        // original result sets remain in the durable discoveries artifact.
        try { const refined = await search(refinement.query); if (refined.length) candidates = refined; }
        catch (error) { result.failures.push({ code: error instanceof AssistantError ? error.code : 'web_search_unavailable' }); }
      }
    }
    const seen = new Set<string>();
    for (const candidate of candidates.slice(0,8)) {
      let url: string;
      try { url=publicWebUrl(candidate.url).href; } catch { result.failures.push({code:'unsafe_web_url'}); continue; }
      if (!inDomains(url,query.domains)) continue;
      if (seen.has(url)) continue; seen.add(url);
      const source = { ...candidate, url, parent: 'parent' in candidate ? candidate.parent as string | null : null,
        depth: 'depth' in candidate ? candidate.depth as number : 0 };
      queue.push(source);
      if (mode?.discoverOnly) result.candidates!.push({...source,id:`P${mode.runId}:${mode.sequence}:${result.candidates!.length}`});
    }
    if (mode?.discoverOnly) { result.status=result.candidates!.length?'ready':'empty'; return result; }
    while (queue.length && state.reads < 6 && Date.now() < deadline) {
      queue.sort((a,b) => compareFrontier(a,b,query.query));
      const selectedIndex = mode?.selected && !state.visited.includes(mode.selected.url) ? queue.findIndex(c => c.url === mode.selected!.url) : -1;
      const candidate = queue.splice(selectedIndex < 0 ? 0 : selectedIndex, 1)[0];
      let url: string;
      try { url = publicWebUrl(candidate.url).href; }
      catch { result.failures.push({ code: 'unsafe_web_url' }); continue; }
      if (!inDomains(url, query.domains) || state.visited.includes(url)) continue;
      state.visited.push(url); state.reads++;
      const nav = { url, parent: candidate.parent, depth: candidate.depth, outcome: 'unavailable' }; state.navigation.push(nav);
      try {
        const document = await read(url, Math.max(1, Math.min(27000, deadline - Date.now())));
        if (!validPublicDocument(document)) fail('invalid_web_reader_response', 502);
        if (!inDomains(document.url, query.domains)) fail('web_domain_changed', 422);
        nav.outcome = 'read';
        const duplicate = result.documents!.some(old => old.original.sha256 === document.original.sha256);
        if (!duplicate) {
          result.documents!.push(document);
          // Prefer the actual document to intermediate navigation pages while
          // retaining all reads and failures in the private checkpoint.
          const pages = publicDocumentPages(document, retrievedAt);
          const complete = pages.length === document.pages.length && pages.length <= 32 && pages.reduce((n,p)=>n+p.textBytes,0) <= 18000;
          const technicalHint = publicNavigationClass(candidate) === 4;
          if (document.mediaType === 'application/pdf' && complete) {
            // Admit a complete bounded document, including short/blank PDF
            // pages. A later technical original may replace a provisional
            // brochure before Evidence is materialized; every fetched original
            // stays in documents. This never changes a committed source.
            result.pages = pages;
            state.selection = { protocol: 'document-purpose-frontier-v1', documentHash: document.original.sha256, complete, technicalHint };
            // A complete bounded original is available. Keep every read and
            // candidate in the artifact, without crawling unrelated branches.
            if (!originalQuery(query.query) || technicalHint) break;
          }
          else if (document.mediaType !== 'application/pdf') {
            for (const page of pages) if (result.pages.reduce((n,p)=>n+p.textBytes,0) + page.textBytes <= 18000 && result.pages.length < 32) result.pages.push(page);
            if (!pages.length) result.failures.push({ url: document.url, code: 'web_context_limit' });
          } else result.failures.push({ url: document.url, code: 'web_context_limit' });
        }
        if (candidate.depth < 3) for (const link of document.links) {
          let url: string;
          try { url = publicWebUrl(link.url).href; } catch { continue; }
          if (!inDomains(url, query.domains) || state.visited.includes(url)) continue;
          const anchor={ ...link, url, parent: document.url, depth: candidate.depth + 1 };
          if (mode && result.candidates!.length<100 && !result.candidates!.some(c => c.url === url)) result.candidates!.push({...anchor,id:`P${mode.runId}:${mode.sequence}:${result.candidates!.length}`});
          if (rankPublicCandidate(anchor,query.query)>0 && !/\b(?:appstore|play\.google)\b|\/apps?(?:\/|\?|$)/i.test(url) && !queue.some(c => c.url === url)) queue.push(anchor);
        }
        // Bound the best unique pending links, not the first hundred insertions.
        // Repeated site menus must not prevent a later original-document link
        // from ever entering ranking. Originals/failed reads stay durable.
        queue.sort((a,b) => compareFrontier(a,b,query.query));
        queue.splice(100);
      } catch (error) {
        const code = error instanceof AssistantError ? error.code : 'web_read_unavailable';
        nav.outcome = code; result.failures.push({ url, code });
      }
    }
    result.status = result.pages.length ? 'ready' : candidates.length ? 'unavailable' : 'empty';
    if (Date.now() >= deadline) result.failures.push({ code: 'web_deadline_exceeded' });
  } catch (error) { result.failures.push({ code: error instanceof AssistantError ? error.code : 'web_search_unavailable' }); }
  return result;
}
