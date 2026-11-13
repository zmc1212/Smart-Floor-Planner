import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fingerprint, type Evidence } from '../contracts';
import type { WebSourceLocator } from '../contracts/web-source';
import { extractWebPage, readPublicPage, type WebSearchSnapshot, type WebPage } from './web';
import type { SynthesisContext, SynthesisSource, SynthesisAnswer } from './synthesis';
import { configuredPublicRead, publicReaderParser, validPublicDocument, verifyPublicPdf, type PublicReadDocument } from './public-research';
import { fetchPublicDocument, standardAttachment } from '../web-search/page';
import { withPublicRequest } from '../web-search/tools';
import { injectionSignals } from '../contracts/native-tools';
import { originalDocumentPage, reviewedStandardPublication } from '../web-search/standards';

export type WebSourceProblem = 'source_changed' | 'source_missing' | 'source_unreadable' | 'source_withdrawn' | 'source_forbidden';
export type WebSourceChecks = ReadonlyMap<string, WebSourceProblem | null>;
type WebSourceCheck = { reason: WebSourceProblem; code: string } | null;
const checkDetails = new WeakMap<WebSourceChecks, ReadonlyMap<string, string>>();
export const webSourceErrorCode = (checks: WebSourceChecks, hash: string) => checkDetails.get(checks)?.get(hash);

function checkOriginalDocumentPage(web: WebSourceLocator, document: PublicReadDocument): WebSourceCheck {
  if (!web.document || document.url !== web.url || document.original.sha256 !== web.document.hash)
    return { reason: 'source_changed', code: 'pdf_original_changed' };
  const text = originalDocumentPage(document, web.document);
  if (!text?.trim() || injectionSignals(document.title + '\n' + text).length)
    return { reason: 'source_unreadable', code: document.parseError ?? 'pdf_page_unreadable' };
  const { hash, ...locator } = web;
  return fingerprint({ ...locator, text }) === hash ? null : { reason: 'source_changed', code: 'pdf_page_changed' };
}

/** Compare with the same original-reading path used to create the snapshot.
 * A live HTTP status by itself cannot verify the original text. */
async function inspectWebSource(web: WebSourceLocator, budgetMs: number): Promise<WebSourceCheck> {
  try {
    return await withPublicRequest(async () => {
      const url = web.requestedUrl ?? web.url;
      if (web.parser === publicReaderParser) {
        return checkOriginalDocumentPage(web, await configuredPublicRead(url, budgetMs));
      }
      const deadline = Date.now() + budgetMs;
      const read = (url: string, signal?: AbortSignal) => readPublicPage(url, undefined, deadline, signal);
      const page = web.requestedUrl
        ? await fetchPublicDocument(url, { readPage: read, now: () => new Date(web.retrievedAt) })
        : extractWebPage(await read(url), web.retrievedAt);
      if (injectionSignals(page.title + '\n' + page.text).length) return { reason: 'source_unreadable', code: 'web_page_untrusted_instruction' };
      if (web.standard && 'standard' in page && fingerprint(web.standard) !== fingerprint(page.standard ?? null))
        return { reason: 'source_changed', code: 'web_standard_status_changed' };
      return fingerprint({ url: page.url, title: page.title, text: page.text, retrievedAt: page.retrievedAt }) === web.hash
        ? null : { reason: 'source_changed', code: 'web_original_changed' };
    });
  } catch (error) { return originalReadFailure(error); }
}

export async function checkWebSource(web: WebSourceLocator, budgetMs: number): Promise<WebSourceProblem | null> {
  return (await inspectWebSource(web, budgetMs))?.reason ?? null;
}

function originalReadFailure(error: unknown): NonNullable<WebSourceCheck> {
  const code = error instanceof AssistantError ? error.code : 'web_read_unavailable';
  if (code === 'web_http_410') return { reason: 'source_withdrawn', code };
  if (code === 'web_http_404') return { reason: 'source_missing', code };
  if (['web_http_401', 'web_http_403', 'web_http_451'].includes(code)) return { reason: 'source_forbidden', code };
  if (['web_http_412', 'pdf_validator_changed'].includes(code)) return { reason: 'source_changed', code };
  return { reason: 'source_unreadable', code };
}

/** Each supplied original already passed the owning run's tenant/conversation
 * check. The source still has to be live before its persisted text is returned. */
async function checkPdfVersion(web: WebSourceLocator, budgetMs: number) {
  const source = web.document!;
  const requestedUrl = web.requestedUrl ?? web.url;
  const publication = reviewedStandardPublication(web);
  const signal = AbortSignal.timeout(budgetMs);
  const origin = verifyPublicPdf(requestedUrl, budgetMs, source.etag, signal);
  const notice = publication ? fetchPublicDocument(publication.noticeUrl, { signal }) : null;
  const [verified, currentNotice] = await Promise.allSettled([origin, notice]);
  if (currentNotice.status === 'fulfilled' && publication) {
    const publishedUrl = standardAttachment(currentNotice.value ?? undefined, publication.standard)?.url;
    if (!publishedUrl) return { reason: 'source_withdrawn', code: 'web_attachment_withdrawn' } as const;
    const currentLink = new URL(publishedUrl), previousLink = new URL(requestedUrl);
    currentLink.searchParams.sort();
    previousLink.searchParams.sort();
    if (currentLink.href !== previousLink.href) return { reason: 'source_changed', code: 'web_attachment_changed' } as const;
  }
  if (verified.status === 'rejected') return originalReadFailure(verified.reason);
  if (currentNotice.status === 'rejected') return originalReadFailure(currentNotice.reason);
  const current = verified.value;
  if (current.url !== web.url || current.bytes !== source.bytes || current.sha256 && current.sha256 !== source.hash)
    return { reason: 'source_changed', code: 'pdf_original_changed' } as const;
  return null;
}

export async function checkWebSources(sources: WebSourceLocator[], check = checkWebSource, options: {
  /** Only hashes whose private original/page were verified under authorization. */
  savedPdfPages?: ReadonlySet<string>;
} = {}): Promise<WebSourceChecks> {
  const unique = [...new Map(sources.map(source => [source.hash, source])).values()];
  const result = new Map<string, WebSourceProblem | null>();
  const details = new Map<string, string>();
  const record = (hash: string, problem: WebSourceCheck) => {
    result.set(hash, problem?.reason ?? null);
    if (problem) details.set(hash, problem.code);
  };
  const groups = new Map<string, WebSourceLocator[]>();
  for (const source of unique) {
    const pdf = options.savedPdfPages?.has(source.hash) && source.document?.mediaType === 'application/pdf' ? source.document : null;
    const key = check !== checkWebSource || source.parser !== publicReaderParser ? source.hash
      : fingerprint([source.requestedUrl ?? source.url, source.url, pdf?.hash ?? null, pdf?.bytes ?? null, pdf?.etag ?? null,
        pdf && source.document?.reviewedTextHash ? source.standard?.id : null]);
    const pages = groups.get(key);
    if (pages) pages.push(source);
    else groups.set(key, [source]);
  }
  const started = Date.now(), pending = [...groups.values()];
  for (let start = 0; start < pending.length; start += 4) {
    await Promise.all(pending.slice(start, start + 4).map(async pages => {
      const first = pages[0];
      // A range-read original may need a redirect, a probe and four pinned
      // transfers. One slot and one bounded download serve all its citations.
      const budget = pages.some(page => page.document?.transport === 'verified_pdf_ranges') ? 12000 : 6000;
      const remaining = started + budget - Date.now();
      if (remaining <= 0) {
        for (const page of pages) record(page.hash, { reason: 'source_unreadable', code: 'web_timeout' });
      } else if (check === checkWebSource && first.document?.mediaType === 'application/pdf' && options.savedPdfPages?.has(first.hash)) {
        try {
          const problem = await withPublicRequest(() => checkPdfVersion(first, remaining));
          for (const page of pages) record(page.hash, problem);
        } catch (error) { for (const page of pages) record(page.hash, originalReadFailure(error)); }
      } else if (check === checkWebSource && first.parser === publicReaderParser) {
        try {
          const document = await withPublicRequest(() => configuredPublicRead(first.requestedUrl ?? first.url, remaining));
          for (const page of pages) record(page.hash, checkOriginalDocumentPage(page, document));
        } catch (error) { for (const page of pages) record(page.hash, originalReadFailure(error)); }
      } else {
        if (check === checkWebSource) record(first.hash, await inspectWebSource(first, remaining));
        else result.set(first.hash, await check(first, remaining));
      }
    }));
  }
  checkDetails.set(result, details);
  return result;
}

export function citationWebSource(citation: { id: string; available: boolean; locator?: unknown } | undefined) {
  return citation?.available && parseWebCitationId(citation.id)
    ? (citation.locator as { web?: WebSourceLocator } | undefined)?.web : undefined;
}

export function webEvidence(snapshot: WebSearchSnapshot, runId: string, sequence: number): Evidence[] {
  return snapshot.pages.map((page, index) => {
    const { text, ...web } = page;
    return { ref: { type: 'web_page', id: `${runId}:${sequence}:${index}`, version: page.hash }, text, hash: page.hash, web };
  });
}
export function webSynthesisSources(evidence: Evidence[]): SynthesisSource[] {
  return evidence.map(e => ({ sourceId: 'W' + e.ref.id, kind: 'web', title: e.web!.title, text: e.text, evidence: e,
    web: e.web, ...(e.text.length <= 400 ? { fullTextCitable: true as const } : {}) }));
}
function pageValid(page: WebPage, document?: PublicReadDocument) {
  const base = typeof page.text === 'string' && typeof page.url === 'string'
    && typeof page.title === 'string' && typeof page.retrievedAt === 'string' && Number.isFinite(Date.parse(page.retrievedAt))
    && page.textBytes === Buffer.byteLength(page.text) && page.textBytes <= (page.parser === publicReaderParser ? 18000 : 12000);
  if (!base) return false;
  if (page.parser === 'public-html-text-v1') return page.hash === fingerprint({ url: page.url, title: page.title, text: page.text, retrievedAt: page.retrievedAt });
  const { hash, ...original } = page;
  return page.parser === publicReaderParser && hash === fingerprint(original) && !!page.document
    && !!document && !!page.text.trim() && validPublicDocument(document)
    && document.url === page.url && document.title === page.title
    && (document.requestedUrl || undefined) === page.requestedUrl
    && (document.transport === 'verified_pdf_ranges' ? document.transport : undefined) === page.document.transport
    && document.original.etag === page.document.etag
    && document.mediaType === page.document.mediaType && document.original.bytes === page.document.bytes
    && document.pages.length === page.document.pages && originalDocumentPage(document, page.document) === page.text
    && !injectionSignals(page.title + '\n' + page.text).length;
}
/** Same Evidence identity, backed only by this authorized run's immutable read. */
export async function resolveWebEvidence(tx: PostgresTransaction, actor: { enterpriseId: string }, conversation: Row, evidence: Evidence) {
  const match = /^([1-9]\d{0,18}):(12\d{2}):(\d{1,2})$/.exec(evidence.ref.id);
  if (evidence.ref.type !== 'web_page' || !match) return undefined;
  const step = await one(tx, sql`select s.private_checkpoint from app.assistant_run_steps s join app.assistant_runs r
    on r.enterprise_id=s.enterprise_id and r.id=s.run_id
    where s.enterprise_id=${actor.enterpriseId} and r.conversation_id=${String(conversation.id)} and r.id=${match[1]}
      and s.step_seq=${Number(match[2])} and s.capability_name in ('web.search.v1','web.read.v1') and s.status='succeeded'`);
  const snapshot = step?.private_checkpoint as WebSearchSnapshot | null;
  const page = snapshot?.version === 1 && Array.isArray(snapshot.pages) ? snapshot.pages[Number(match[3])] : null;
  const { text, ...web } = page || {} as WebPage;
  const document = page?.document && snapshot?.documents?.find(item => item.original.sha256 === page.document?.hash);
  if (!page || Number(match[3]) > 31 || !pageValid(page, document ?? undefined) || evidence.hash !== page.hash || evidence.ref.version !== page.hash
    || evidence.text !== text || fingerprint(evidence.web) !== fingerprint(web)) return undefined;
  return { title: page.title, text: page.text, locator: { web: evidence.web }, published_version_id: page.hash };
}

export function parseWebCitationId(value: string): { runId: string; index: number; part?: number } | null {
  const match = /^w:([1-9]\d{0,18}):(\d{1,2})(?::(\d{1,2}))?$/.exec(value);
  return match && Number(match[2]) <= 31 && (match[3] === undefined || Number(match[3]) < 24)
    ? { runId: match[1], index: Number(match[2]), ...(match[3] === undefined ? {} : { part: Number(match[3]) }) } : null;
}

/** Preserve each explicitly selected original when the enclosing interval would
 * include too much unrelated text. Existing bounded page citations keep their ID.
 * Parts are derived only from the persisted answer, never from client offsets. */
export function webAnswerQuoteSpans(answer: SynthesisAnswer, source: SynthesisSource) {
  const quotes = [...new Set(answer.segments.flatMap(segment => segment.citations
    .filter(citation => citation.sourceId === source.sourceId).map(citation => citation.quote)))];
  if (!quotes.length || quotes.length > 24 || quotes.some(quote => !quote.trim() || quote.length > 600 || !source.text.includes(quote))) return [];
  const start = Math.min(...quotes.map(quote => source.text.indexOf(quote)));
  const end = Math.max(...quotes.map(quote => source.text.indexOf(quote) + quote.length));
  if (end - start <= 600) return [{ quote: source.text.slice(start, end), selectedQuotes: quotes, part: undefined as number | undefined }];
  return quotes.map((quote, part) => ({ quote, selectedQuotes: [quote], part }));
}
/** Reuse the existing citation endpoint/catalog. No fake knowledge document,
 * copied enterprise entry, second citation table or model-supplied URL. */
export async function webCitationForAnswer(tx: PostgresTransaction, actor: { enterpriseId: string }, conversation: Row, citationId: string) {
  const ref = parseWebCitationId(citationId); if (!ref) return null;
  const saved = await one(tx, sql`select s.source_refs,s.private_checkpoint,m.content from app.assistant_run_steps s
    join app.assistant_runs r on r.enterprise_id=s.enterprise_id and r.id=s.run_id
    join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.output_message_id
    where s.enterprise_id=${actor.enterpriseId} and r.conversation_id=${String(conversation.id)} and r.id=${ref.runId}
      and s.step_seq=1006 and s.kind='agent_synthesis_context' and s.status='succeeded'`);
  const context = saved?.source_refs as SynthesisContext | null, answer = saved?.private_checkpoint as SynthesisAnswer | null;
  const source = context?.sources?.filter(s => s.kind === 'web')[ref.index];
  if (!source?.evidence || !(saved?.content as { blocks?: Array<{ citationId?: string }> })?.blocks?.some(b => b.citationId === citationId)
    || !answer?.segments || !await resolveWebEvidence(tx, actor, conversation, source.evidence)) return null;
  const span = webAnswerQuoteSpans(answer, source).find(span => span.part === ref.part);
  if (!span) return null;
  const web = source.evidence.web!;
  const pdf = web.document?.mediaType === 'application/pdf' ? web.document : null;
  const section = pdf?.section ? '\n' + pdf.section : '';
  return { id: citationId, available: true, title: web.title, quote: span.quote, version: web.hash,
    versionLabel: '网页读取快照', sourceLocation: web.url + (pdf ? '\nPDF 第' + pdf.page + '页（共' + pdf.pages + '页）' + section : '') + '\n读取时间：' + web.retrievedAt,
    locator: { web }, historical: true, isDraft: false, referenceCase: false, sourceUrl: web.url, retrievedAt: web.retrievedAt };
}
