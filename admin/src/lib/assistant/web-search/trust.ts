import { publicWebUrl } from '../agent/web';
import {
  webCitationAuditProtocol, webSourceAssessmentProtocol,
  type WebCitationAudit, type WebEvidenceSource, type WebSearchProviderResult,
  type WebSourceAssessment, type WebSourceConflict, type WebSourceKind, type WebSourceTrust,
} from './contract';

const officialSuffixes = ['.gov.cn', '.gov'];
const institutionSuffixes = ['.edu.cn', '.edu', '.ac.cn', '.ac'];
const standardsDomains = new Set([
  'iso.org', 'iec.ch', 'gb688.cn', 'std.samr.gov.cn', 'openstd.samr.gov.cn',
  'samr.gov.cn', 'mohurd.gov.cn',
]);

function hostMatches(host: string, suffixes: string[]) {
  return suffixes.some(suffix => host === suffix.slice(1) || host.endsWith(suffix));
}

/**
 * Domain/URL heuristics only. They classify provenance; they never verify a
 * claim's truth. An enterprise's own site is still self-published.
 */
export function classifyWebSource(url: string, title?: string | null): WebSourceTrust {
  const host = publicWebUrl(url).hostname.toLowerCase();
  if (hostMatches(host, officialSuffixes) || standardsDomains.has(host)
    || [...standardsDomains].some(domain => host.endsWith('.' + domain))) {
    return {
      kind: 'official_document', verified: true, verification: 'domain_suffix',
      notes: ['public_government_or_standards_domain'],
    };
  }
  if (hostMatches(host, institutionSuffixes)) {
    return {
      kind: 'institution', verified: true, verification: 'domain_suffix',
      notes: ['public_education_or_research_domain'],
    };
  }
  const label = `${title || ''} ${url}`.toLowerCase();
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { /* URL was already validated. */ }
  if (/官网|官方|制造商|厂家|有限公司|集团|official|manufacturer/.test(label)
    || /\/(?:about|company|manufacturer|official|brand)(?:\/|$)/.test(pathname)) {
    return {
      kind: 'enterprise', verified: false, verification: 'unverified',
      notes: ['self_published_enterprise_site', 'not_independently_verified'],
    };
  }
  return {
    kind: 'general_web', verified: false, verification: 'unverified',
    notes: ['unclassified_public_web', 'not_independently_verified'],
  };
}

/** Per-run evidence sink. Full-page reads replace an earlier search snippet. */
export class WebEvidenceCollector {
  private readonly items = new Map<string, WebEvidenceSource>();

  addSearch(result: WebSearchProviderResult): void {
    for (const hit of result.results) {
      if (this.items.get(hit.url)?.evidence === 'full_page') continue;
      const trust = classifyWebSource(hit.url, hit.title);
      this.items.set(hit.url, {
        url: hit.url, title: hit.title, domain: hit.domain, evidence: 'search_result',
        snippet: hit.snippet, text: null, textBytes: 0,
        publishedAt: hit.publishedAt, retrievedAt: result.retrievedAt,
        sourceKind: trust.kind, trust,
        rank: hit.rank, contentHash: null, injectionSignals: [],
      });
    }
  }

  addDocument(document: {
    url: string; title: string; text: string; textBytes: number; contentHash: string;
    publishedAt: string | null; retrievedAt: string; injectionSignals: string[]; trust: WebSourceTrust;
  }): WebEvidenceSource {
    const source: WebEvidenceSource = {
      url: document.url, title: document.title, domain: new URL(document.url).hostname,
      evidence: 'full_page', snippet: null, text: document.text, textBytes: document.textBytes,
      publishedAt: document.publishedAt, retrievedAt: document.retrievedAt,
      sourceKind: document.trust.kind, trust: document.trust,
      rank: null, contentHash: document.contentHash, injectionSignals: document.injectionSignals,
    };
    this.items.set(document.url, source);
    return source;
  }

  sources(): WebEvidenceSource[] {
    return [...this.items.values()];
  }
}

function normalizedTitle(title: string) {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * Metadata-level source assessment. Conflicts are review markers, not truth
 * verdicts; search rank is never used as a credibility score.
 */
export function assessWebSources(sources: WebEvidenceSource[]): WebSourceAssessment {
  const conflicts: WebSourceConflict[] = [];
  const byHash = new Map<string, WebEvidenceSource[]>();
  for (const source of sources) {
    if (!source.contentHash) continue;
    const group = byHash.get(source.contentHash) || [];
    group.push(source); byHash.set(source.contentHash, group);
  }
  for (const group of byHash.values()) {
    if (group.length > 1) {
      conflicts.push({ code: 'duplicate_content', urls: group.map(source => source.url) });
    }
  }
  const byTitle = new Map<string, WebEvidenceSource[]>();
  for (const source of sources) {
    const key = normalizedTitle(source.title);
    if (!key) continue;
    const group = byTitle.get(key) || [];
    group.push(source); byTitle.set(key, group);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const urls = group.map(source => source.url);
    const kinds = new Set(group.map(source => source.sourceKind));
    const dates = new Set(group.map(source => source.publishedAt).filter((value): value is string => !!value));
    if (kinds.size > 1) conflicts.push({ code: 'source_type_conflict', urls });
    if (dates.size > 1) conflicts.push({ code: 'publication_date_conflict', urls });
    const domains = new Set(group.map(source => source.domain));
    if (domains.size > 1 && !conflicts.some(conflict => conflict.code === 'publication_date_conflict'
      && conflict.urls.join() === urls.join())) {
      conflicts.push({ code: 'syndicated_title', urls });
    }
  }
  return {
    protocol: webSourceAssessmentProtocol,
    conflicts,
    unverifiedUrls: sources.filter(source => !source.trust.verified).map(source => source.url),
    verifiedUrls: sources.filter(source => source.trust.verified).map(source => source.url),
    note: 'search_rank_is_not_credibility',
  };
}

function answerUrls(answer: string): string[] {
  const found = answer.match(/https?:\/\/[^\s<>"'）)】\]，。；、]+/gi) || [];
  return [...new Set(found.map(value => value.replace(/[),.;:!?]+$/g, '')))];
}

/** Only evidence URLs may appear as citations. The answer is never rewritten. */
export function auditAnswerCitations(answer: string, sources: WebEvidenceSource[]): WebCitationAudit {
  const allowed = new Set<string>();
  for (const source of sources) {
    try { allowed.add(publicWebUrl(source.url).href); } catch { /* Invalid evidence is never allowed. */ }
  }
  const cited: string[] = [], invalid: string[] = [];
  for (const value of answerUrls(answer)) {
    let url: string;
    try { url = publicWebUrl(value).href; } catch { invalid.push(value); continue; }
    cited.push(url);
    if (!allowed.has(url)) invalid.push(url);
  }
  return {
    protocol: webCitationAuditProtocol,
    ok: invalid.length === 0,
    citedUrls: [...new Set(cited)], invalidUrls: [...new Set(invalid)], allowedUrls: [...allowed],
    note: 'only_evidence_urls_may_be_cited',
  };
}

/**
 * Boundary claims that public web search cannot support. Enterprise knowledge
 * is not wired in R3, so any claimed internal-standard lookup is a defect.
 */
export function webAnswerBoundaryIssues(answer: string, sourceCount: number): string[] {
  const issues = new Set<string>();
  const enterpriseMention = /(?:本企业|公司|我们|咱们)(?:内部)?(?:的)?(?:施工)?(?:标准|规范|知识库)|企业内部(?:标准|规范|知识库)/;
  const retrievalClaim = /(?:已|刚刚)?(?:查询|检索|查阅|核对)(?:了)?(?:本)?企业(?:内部)?(?:标准|规范|知识库)/;
  const negated = /(?:不等于|不是|并非|不代表|未|没有|无法|不能|不构成)/;
  // A clause that explicitly denies an enterprise-standard claim is not a
  // fabricated claim. Evaluate per clause so a later real claim still counts.
  for (const clause of answer.split(/[。；！？\n]/)) {
    if (negated.test(clause)) continue;
    if (enterpriseMention.test(clause)) issues.add('claimed_enterprise_standard');
    if (retrievalClaim.test(clause)) issues.add('claimed_enterprise_knowledge_retrieval');
  }
  if (sourceCount === 0 && /(?:已|经过?)(?:联网|在线|公开资料)(?:核实|验证|查证|检索)/.test(answer)) {
    issues.add('claimed_web_verification_without_source');
  }
  return [...issues];
}
