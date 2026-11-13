import { parseHTML } from 'linkedom';
import { publicWebUrl } from '../agent/web';
import { createHash } from 'node:crypto';
import reviewedStandards from './reviewed-public-standards.json';
import type { PublicReadDocument } from '../agent/public-research';
import type { WebSourceLocator } from '../contracts/web-source';

export type PublicStandard = {
  kind: 'standard_text' | 'publication_notice' | 'status_catalog' | 'withdrawal_notice' | 'department_guidance';
  id: string; name: string; level: 'national' | 'local' | 'industry';
  issuer?: string; issuedAt?: string; effectiveAt?: string;
  status: 'unknown' | 'current' | 'withdrawn' | 'not_yet_effective';
  affected?: Array<{ id: string; clauses: string[] }>;
};

const idPattern = '(?:GB(?:/T)?|JGJ(?:/T)?|DB[0-9]+(?:/T)?|CJJ(?:/T)?)\\s*\\d{2,6}[-—－]\\d{4}';
export const standardIdentity = (value: string) => value.normalize('NFKC').replace(/[\s]/gu, '').replace(/[—－]/g, '-').toUpperCase();
const level = (id: string) => id.startsWith('GB') ? 'national' : id.startsWith('DB') ? 'local' : 'industry';
const idFrom = (value: string) => value.match(new RegExp(idPattern, 'iu'))?.[0];

export function namedReviewedStandard(question: string) {
  const normalized = standardIdentity(question);
  const explicitIds = [...question.normalize('NFKC').matchAll(new RegExp(idPattern, 'giu'))].map(match => standardIdentity(match[0]));
  return reviewedStandards.find(item => explicitIds.length ? explicitIds.includes(item.standard.id)
    : normalized.includes(item.standard.id) || question.includes(item.standard.name));
}

export const explicitStandardReference = (value: string) => !!idFrom(value.normalize('NFKC')) || /《[^》]+》/u.test(value);

export const reviewedStandardTopic = (value: string) => reviewedStandards.find(item => item.topics.some(term => value.includes(term)));

export function reviewedStandardPublication(web: WebSourceLocator) {
  if (!web.document?.reviewedTextHash || web.standard?.kind !== 'standard_text') return undefined;
  const { origin, pathname } = publicWebUrl(web.url);
  return reviewedStandards.find(item => item.standard.id === web.standard?.id && item.sha256 === web.document?.hash
    && item.origin === origin && item.path === pathname);
}

export function matchingReviewedStandard(question: string, precedingQuestions: string[]) {
  const named = namedReviewedStandard(question);
  if (named) return named;
  if (explicitStandardReference(question)) return;
  if (/(?:企业|公司)(?:的|自己|内部|资料|规定|做法|标准)/u.test(question)
    && !/公开|国家|国标|通用要求|通用规范/u.test(question)) return;
  // Short continuations may refer to the immediately preceding technical
  // subject. An independently named part or topic keeps its own retrieval.
  return reviewedStandardTopic(question) ?? (/^(?:处理后|那(?:么)?之后|刚才说的是|之后|那什么时候|那做完后)/u.test(question)
    ? reviewedStandardTopic(precedingQuestions.at(-1) ?? '') : undefined);
}

/** A scan may contribute reviewed passages only for the actual publisher
 * original. A changed byte, mirror or out-of-range page cannot reuse them. */
export function reviewedPublicStandard(document: PublicReadDocument) {
  if (document.mediaType !== 'application/pdf') return;
  const { origin, pathname } = publicWebUrl(document.url);
  const entry = reviewedStandards.find(item => item.sha256 === document.original.sha256
    && item.origin === origin && item.path === pathname && item.pages === document.pages.length);
  if (!entry) return;
  return { standard: entry.standard as PublicStandard, transcripts: entry.transcripts
    .filter(page => document.pages[page.page - 1]?.status === 'ocr_required')
    .map(page => ({ ...page, reviewedTextHash: createHash('sha256').update(page.text).digest('hex') })) };
}

export function originalDocumentPage(document: PublicReadDocument, locator: NonNullable<WebSourceLocator['document']>) {
  if (locator.reviewedTextHash) {
    const transcript = reviewedPublicStandard(document)?.transcripts.find(item => item.page === locator.page);
    return transcript?.reviewedTextHash === locator.reviewedTextHash && transcript?.section === locator.section
      ? transcript?.text : undefined;
  }
  const page = document.pages[locator.page - 1];
  return !document.parseError && page && (!page.status || page.status === 'text') ? page.text : undefined;
}

function calendarDate(value: string | undefined) {
  const fields = value?.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})/u)?.slice(1);
  if (!fields) return undefined;
  const date = [fields[0], fields[1].padStart(2, '0'), fields[2].padStart(2, '0')].join('-');
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : undefined;
}

/** Catalog labels and publisher notices have different evidentiary roles.
 * Their status fields are never derived from result titles or dates alone. */
export function publicStandardMetadata(url: string, title: string, original: string, html?: string): PublicStandard | undefined {
  const { hostname, pathname } = publicWebUrl(url);
  if (hostname === 'ebook.chinabuilding.com.cn' && pathname === '/zbooklib/book/detail/show' && html) {
    const { document } = parseHTML(html);
    const label = document.querySelector('#bookDetailTitle')?.textContent?.trim();
    const status = document.querySelector('#bookUnit')?.textContent?.trim();
    const id = label && idFrom(label);
    const name = label?.split(/[：:]/u)[1]?.trim();
    if (!id || !name || !original.includes(name)) return;
    const normalized = standardIdentity(id);
    return { kind: 'status_catalog', id: normalized, name, level: level(normalized),
      status: status === '现行' ? 'current' : status === '废止' ? 'withdrawn'
        : status === '未实施' || status === '即将实施' ? 'not_yet_effective' : 'unknown',
      issuedAt: calendarDate(original.match(/发布日期\s*[：:]\s*([^\n]+)/u)?.[1]),
      effectiveAt: calendarDate(original.match(/实施日期\s*[：:]\s*([^\n]+)/u)?.[1]) };
  }
  if (!/(?:^|\.)gov\.cn$/u.test(hostname)) return;
  const heading = title.match(/《([^》]+)》/u)?.[1];
  const primary = original.match(new RegExp('现批准\\s*《([^》]+)》[^。]{0,55}?编号为\\s*(' + idPattern + ')', 'iu'));
  const id = primary?.[2] ?? idFrom(title);
  const name = primary?.[1] ?? heading;
  if (!id || !name) return;
  const normalized = standardIdentity(id);
  const issuer = hostname === 'www.mohurd.gov.cn' ? '住房和城乡建设部' : undefined;
  const issuedAt = calendarDate(original.match(/发文日期\s*[：:]?\s*([^\n]+)/u)?.[1]
    ?? original.match(/住房和城乡建设部\s*(\d{4}年\d{1,2}月\d{1,2}日)/u)?.[1]);
  if (primary && /关于发布.{0,35}标准.{0,90}公告/u.test(title)) {
    const retired = original.split(/同时废止下列[^：:\n]*[：:]/u)[1]?.split(/本规范在|本标准在|住房和城乡建设部门户/u)[0];
    const affected = retired ? retired.split('\n').flatMap(line => {
      const ref = idFrom(line);
      const clauses = line.slice(line.indexOf(ref ?? '') + (ref?.length ?? 0)).match(/\d+\.\d+(?:\.\d+)?(?:[（(]\d+(?:[、,]\d+)*[）)])?/g);
      return ref && clauses?.length ? [{ id: standardIdentity(ref), clauses }] : [];
    }).slice(0, 30) : [];
    return { kind: 'publication_notice', id: normalized, name, level: level(normalized), issuer, issuedAt,
      effectiveAt: calendarDate(original.slice(primary.index).match(/自\s*(\d{4}年\d{1,2}月\d{1,2}日)起实施/u)?.[1]),
      status: 'unknown', ...(affected.length ? { affected } : {}) };
  }
  const retirement = original.split('\n').some(line => line.includes(name)
    && standardIdentity(line).includes(normalized) && /(?:予以|同时|正式|决定)废止|自.{1,20}起废止/u.test(line)
    && !/相关强制性条文|第.{0,20}条/u.test(line));
  if (/关于废止/u.test(title) && retirement)
    return { kind: 'withdrawal_notice', id: normalized, name, level: level(normalized), issuer, issuedAt,
      status: 'unknown', effectiveAt: calendarDate(original.match(/自\s*(\d{4}年\d{1,2}月\d{1,2}日)起废止/u)?.[1]) };
  return { kind: 'department_guidance', id: normalized, name, level: level(normalized), issuer, issuedAt, status: 'unknown' };
}

export type StandardCitation = { standard: PublicStandard; quote: string };
const statusClaims = /(?:仍(?:然)?|目前|现在|还)有效|现行(?:有效|的)?(?:标准|规范|要求)?|已经废止|已(?:被)?废止|全本废止|整部废止|现已生效|仍(?:须|应|必须)执行/gu;
/** The exact status-bearing forms the guard recognizes, shared with the one
 * bounded repair so a diagnostic never invents another vocabulary. */
export function standardStatusClaims(text: string) {
  return [...text.matchAll(statusClaims)].map(match => match[0]);
}

/** Check status-bearing claims against exact-edition catalog/withdrawal
 * evidence. Historical references and explicit uncertainty remain usable. */
export function unverifiedStandardStatus(text: string, cited: StandardCitation[], consulted: PublicStandard[]) {
  return text.split(/[。！？；\n]/u).some(sentence => {
    const mentions = [...sentence.matchAll(new RegExp(idPattern, 'giu'))].map(match => standardIdentity(match[0]));
    const named = consulted.filter(item => sentence.includes(item.name)).map(item => item.id);
    const ids = [...new Set(mentions.length ? mentions : named.length ? named : consulted.map(item => item.id))];
    if (!ids.length) return false;
    if (!/当时|公告(?:发布时|于)|发布时|原公告(?:写明|记载|曾)/u.test(sentence) && /必须严格执行|现仍.{0,8}执行|现行|有效/u.test(sentence)
      && consulted.some(standard => standard.affected?.some(item => ids.includes(item.id)
        && item.clauses.some(clause => sentence.includes(clause))))) return true;
    if (/哪些条|第\s*\d+\.\d+|相关强制性条文|其中.{0,14}条文/u.test(sentence)
      && /条文|条款|第\s*\d/u.test(sentence) && !/全本|整部/u.test(sentence) && /废止/u.test(sentence)
      && cited.some(({ standard, quote }) => standard.affected?.some(item => ids.includes(item.id)
        && item.clauses.some(clause => quote.includes(clause)) && standardIdentity(quote).includes(item.id)))) return false;
    return [...sentence.matchAll(statusClaims)].some(claim => {
      const start = sentence.slice(0, claim.index);
      const clause = start.split(/[，,]/u).at(-1) ?? '';
      const remainder = sentence.slice(claim.index + claim[0].length);
      if (/是否|能否|无法确认|尚未核实|不能(?:据此)?判断|不能认定|不代表|未(?:查到|见|找到|显示|发现)|待核实/u.test(clause)
        || /^(?:的)?(?:有效性|状态|情况)?(?:我|本次|本轮)?(?:暂|仍)?(?:无法|不能|尚未|未能)(?:确认|核实)(?:$|[，,])/u.test(remainder)
        || claim[0] === '现行' && sentence.slice(claim.index).startsWith('现行工程建设标准中')
        || claim[0] === '现行' && /^现行(?:状态|情况|结论|信息|记录)(?![是为属]|有效)/u.test(sentence.slice(claim.index))
        || /^(?:如何|怎么|哪里|能否|是否)/u.test(sentence.trim())) return false;
      const requested = claim[0].includes('废止') ? 'withdrawn' : 'current';
      return ids.length !== 1 || !cited.some(({ standard, quote }) => standard.id === ids[0]
        && (standard.kind === 'status_catalog' && standard.status === requested
          && (requested === 'current' ? /现行/u.test(quote) : /废止/u.test(quote))
          || requested === 'withdrawn' && standard.kind === 'withdrawal_notice' && /废止/u.test(quote)
            && !!standard.effectiveAt && standard.effectiveAt <= new Date().toISOString().slice(0, 10)))
        || consulted.some(standard => standard.id === ids[0]
          && (standard.kind === 'status_catalog' && standard.status !== 'unknown' && standard.status !== requested
            || requested === 'current' && standard.kind === 'withdrawal_notice'
              && !!standard.effectiveAt && standard.effectiveAt <= new Date().toISOString().slice(0, 10)));
    });
  });
}
