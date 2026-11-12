/**
 * Independent public-web search contract.
 *
 * The search vendor is an adapter detail. Business tools, the Agent loop and
 * source assessment only see normalized, bounded results. Search snippets are
 * explicitly not full page content; only `web_fetch` may produce a document.
 */
export const webSearchProtocol = 'independent-web-search-v1';
export const webSearchReportProtocol = 'web-search-report-v1';
export const webDocumentProtocol = 'public-web-document-v1';
export const webSourceAssessmentProtocol = 'web-source-assessment-v1';
export const webCitationAuditProtocol = 'web-citation-audit-v1';
export const webResearchProtocol = 'web-research-v1';

export const webSearchLimits = {
  minQueryChars: 2,
  maxQueryChars: 240,
  maxDomains: 3,
  maxQueriesPerBatch: 3,
  maxResults: 10,
  defaultResults: 5,
  maxSnippetChars: 500,
  maxTitleChars: 300,
  maxPageTextBytes: 12000,
  searchTimeoutMs: 12000,
  pageTimeoutMs: 12000,
  maxResponseBytes: 512_000,
  maxBatchConcurrency: 3,
} as const;

export type WebSearchKind = 'web' | 'news';

export type WebSearchHit = {
  /** Provider order only; it is never a credibility score. */
  rank: number;
  title: string;
  url: string;
  domain: string;
  snippet: string | null;
  /** Only when the provider actually supplied a valid publication time. */
  publishedAt: string | null;
};

export type WebSearchProviderResult = {
  provider: string;
  query: string;
  kind: WebSearchKind;
  retrievedAt: string;
  results: WebSearchHit[];
};

export type WebSearchRequest = {
  query: string;
  kind: WebSearchKind;
  domains: string[];
  limit: number;
  signal?: AbortSignal;
};

export interface WebSearchProvider {
  readonly name: string;
  readonly supportsNews: boolean;
  search(request: WebSearchRequest): Promise<WebSearchProviderResult>;
}

export type WebReadPage = (url: string) => Promise<{ url: string; body: string; type: string }>;

export type WebSourceKind = 'official_document' | 'institution' | 'enterprise' | 'general_web';

export type WebSourceTrust = {
  kind: WebSourceKind;
  /** True only when a public domain suffix establishes the source class. */
  verified: boolean;
  verification: 'domain_suffix' | 'unverified';
  notes: string[];
};

export type WebEvidenceSource = {
  url: string;
  title: string;
  domain: string;
  evidence: 'search_result' | 'full_page';
  snippet: string | null;
  /** Full original text exists only for `full_page`. */
  text: string | null;
  textBytes: number;
  publishedAt: string | null;
  retrievedAt: string;
  sourceKind: WebSourceKind;
  trust: WebSourceTrust;
  rank: number | null;
  contentHash: string | null;
  injectionSignals: string[];
};

export type WebSourceConflict = {
  code: 'duplicate_content' | 'publication_date_conflict' | 'source_type_conflict' | 'syndicated_title';
  urls: string[];
};

export type WebSourceAssessment = {
  protocol: typeof webSourceAssessmentProtocol;
  conflicts: WebSourceConflict[];
  unverifiedUrls: string[];
  verifiedUrls: string[];
  note: 'search_rank_is_not_credibility';
};

export type WebCitationAudit = {
  protocol: typeof webCitationAuditProtocol;
  ok: boolean;
  citedUrls: string[];
  invalidUrls: string[];
  allowedUrls: string[];
  note: 'only_evidence_urls_may_be_cited';
};

export type WebResearchIntent = 'general' | 'safety' | 'standard' | 'product' | 'market' | 'news';

export type WebResearchPlan = {
  question: string;
  needsSearch: boolean;
  intent: WebResearchIntent;
  queries: string[];
  officialPreferred: boolean;
  reason: string;
};
