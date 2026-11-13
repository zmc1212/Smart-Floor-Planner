import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { fail } from '../contracts';
import { injectionSignals } from '../contracts/native-tools';
import { extractWebPage, publicWebUrl, readPublicPage } from '../agent/web';
import { webDocumentProtocol, webSearchLimits, type WebReadPage, type WebSourceTrust } from './contract';
import { classifyWebSource } from './trust';
import { publicStandardMetadata, type PublicStandard } from './standards';

export type FetchedWebDocument = {
  protocol: typeof webDocumentProtocol;
  requestedUrl: string;
  /** Final URL after the guarded reader's redirects. */
  url: string;
  title: string;
  siteName: string | null;
  text: string;
  textBytes: number;
  /** SHA-256 over normalized original text only; retrieval time is excluded. */
  contentHash: string;
  publishedAt: string | null;
  retrievedAt: string;
  contentType: string;
  parser: string;
  injectionSignals: string[];
  trust: WebSourceTrust;
  attachments?: Array<{ url: string; title: string }>;
  standard?: PublicStandard;
};

export function standardAttachment(notice: (Pick<FetchedWebDocument, 'standard' | 'attachments'>
  & Partial<Pick<FetchedWebDocument, 'injectionSignals'>>) | undefined, standard: Pick<PublicStandard, 'id' | 'name'>) {
  return notice?.standard?.kind === 'publication_notice' && notice.standard.id === standard.id
    && !notice.injectionSignals?.length
    ? notice.attachments?.find(link => link.title.replace(/\.pdf$/i, '') === standard.name) : undefined;
}

function cleanPublishedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  return year >= 1990 && year <= 2100 ? date.toISOString() : null;
}

/** Publication metadata is optional and never inferred from search snippets. */
export function pageMetadata(html: string): { siteName: string | null; publishedAt: string | null } {
  const { document } = parseHTML(html);
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute('content')?.trim() || null;
  const first = (...selectors: string[]) => selectors.map(meta).find(Boolean) || null;
  const time = document.querySelector('article time[pubdate][datetime],main time[pubdate][datetime]')
    ?.getAttribute('datetime')?.trim() || null;
  return {
    siteName: first('meta[property="og:site_name"]', 'meta[name="application-name"]')?.slice(0, 200) ?? null,
    publishedAt: cleanPublishedAt(first(
      'meta[property="article:published_time"]',
      'meta[property="og:article:published_time"]',
      'meta[name="date"]', 'meta[name="pubdate"]', 'meta[name="publishdate"]',
      'meta[name="publish-date"]', 'meta[name="dc.date"]', 'meta[name="dcterms.date"]',
    ) || time),
  };
}

function pageAttachments(html: string, url: string) {
  const { document } = parseHTML(html);
  const candidates = new Map<string, { url: string; title: string }>();
  for (const link of document.querySelectorAll('a[href]')) {
    try {
      const href = publicWebUrl(new URL(link.getAttribute('href')!, url).href);
      if (!/\.pdf$|\/download\/?$/i.test(href.pathname) || candidates.has(href.href)) continue;
      candidates.set(href.href, { url: href.href, title: link.textContent?.replaceAll('\0', '').trim().slice(0, 200) || href.pathname });
      if (candidates.size === 10) break;
    } catch { /* An invalid or non-public href remains outside the read scope. */ }
  }
  return [...candidates.values()];
}

/**
 * Fetch one public page through the existing guarded reader (DNS pinning,
 * redirect revalidation, private-address rejection, size/timeout limits and
 * encoding detection). The returned text is untrusted external data.
 */
export async function fetchPublicDocument(
  value: string,
  options: { readPage?: WebReadPage; now?: () => Date; signal?: AbortSignal } = {},
): Promise<FetchedWebDocument> {
  const requested = publicWebUrl(value);
  options.signal?.throwIfAborted();
  const page = await (options.readPage
    ? options.readPage(requested.href, options.signal)
    : readPublicPage(requested.href, undefined, undefined, options.signal));
  options.signal?.throwIfAborted();
  const finalUrl = publicWebUrl(page.url);
  if (Buffer.byteLength(page.body) > webSearchLimits.maxResponseBytes) fail('web_page_too_large', 502);
  if (!/^(?:text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/i.test(page.type)) {
    fail('unsupported_web_content', 422);
  }
  const retrievedAt = (options.now?.() ?? new Date()).toISOString();
  const extracted = extractWebPage(
    { url: finalUrl.href, body: page.body, type: page.type },
    retrievedAt,
    { removeAds: true },
  );
  const metadata = /html/i.test(page.type) ? pageMetadata(page.body) : { siteName: null, publishedAt: null };
  const attachments = /html/i.test(page.type) ? pageAttachments(page.body, finalUrl.href) : [];
  const standard = publicStandardMetadata(extracted.url, extracted.title, extracted.text, /html/i.test(page.type) ? page.body : undefined);
  return {
    protocol: webDocumentProtocol,
    requestedUrl: requested.href,
    url: extracted.url,
    title: extracted.title,
    siteName: metadata.siteName,
    text: extracted.text,
    textBytes: extracted.textBytes,
    contentHash: createHash('sha256').update(extracted.text).digest('hex'),
    publishedAt: metadata.publishedAt,
    retrievedAt,
    contentType: page.type,
    parser: extracted.parser,
    injectionSignals: injectionSignals(`${extracted.title}\n${extracted.text}`),
    trust: classifyWebSource(extracted.url, extracted.title),
    ...(attachments.length ? { attachments } : {}),
    ...(standard ? { standard } : {}),
  };
}
