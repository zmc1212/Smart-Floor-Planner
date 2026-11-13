import type { SynthesisSource } from './synthesis';
import { fail, fingerprint } from '../contracts';
import { proseNumberView, referenceMarkerText } from './prose-number-view';
import { citedPdfPage } from './source-document';

export const citationProtocolVersion = 'source-catalog-v1';
export type CatalogCitation = { citationId: string; sourceId: string; quote: string; start: number; end: number };
const maxQuoteLength = 400;
const quantitySuffix = /^\s*(?:[\d.A-Za-z%‰㎡㎥²³]|元|万|米|厘米|毫米|平方|立方|吨|克|千克|升|毫升|小时|分钟|秒|天|周|月|年|度|兆帕|帕|瓦|千瓦|伏|安)/u;

/** Deterministic references into the authorized original, never model-written
 * quotations. Keep the complete source in context; do not clip a long clause or
 * separate a table row from its required header/conditions just to make it fit. */
export function sourceCitationCatalog(source: SynthesisSource): CatalogCitation[] {
  const spans: Array<[number, number]> = [], text = source.text;
  const add = (start: number, end: number) => {
    const quote = text.slice(start, end);
    if (quote.trim().length && quote.length <= maxQuoteLength) spans.push([start, end]);
  };
  const reviewed = !!source.web?.document?.reviewedTextHash;
  if (reviewed) {
    for (const line of text.matchAll(/[^\r\n]+(?:\r?\n[1-9] .+)?/gu)) add(line.index!, line.index! + line[0].length);
  } else if (text.length <= maxQuoteLength) add(0, text.length);
  else {
    const file = source.evidence?.file || (source as SynthesisSource & { file?: { kind?: string } }).file;
    if (file?.kind === 'table_row') return [];
    for (const line of text.matchAll(/[^\r\n]+/gu)) {
      if (line[0].length <= maxQuoteLength) add(line.index!, line.index! + line[0].length);
      else for (const clause of line[0].matchAll(/[^。！？；;]+(?:[。！？；;]+|$)/gu)) {
        add(line.index! + clause.index!, line.index! + clause.index! + clause[0].length);
      }
    }
  }
  // Pack adjacent complete clauses/lines rather than producing a catalog entry
  // for every tiny status line. Retain original whitespace and never bridge a
  // skipped oversized clause or clip a clause to fill the remaining budget.
  const packed: Array<[number, number]> = [];
  for (const [start, end] of spans) {
    const previous = packed.at(-1);
    if (!reviewed && previous && end - previous[0] <= maxQuoteLength && /^\s*$/u.test(text.slice(previous[1], start))) previous[1] = end;
    else packed.push([start, end]);
  }
  // Preserve the same 80-bit fingerprint in compact URL-safe encoding. These
  // identifiers are scoped references, not secrets or permission tokens.
  return packed.filter(([start, end]) => text.slice(start, end).trim().length >= 4).map(([start, end]) => ({ citationId: 'C' + Buffer.from(fingerprint({ sourceId: source.sourceId,
    kind: source.kind, text, start, end }).slice(0, 20), 'hex').toString('base64url'),
    sourceId: source.sourceId, quote: text.slice(start, end), start, end }));
}

export function modelCitationCatalog(source: SynthesisSource) {
  return sourceCitationCatalog(source).map(c => {
    const characters = Array.from(c.quote);
    return { citationId: c.citationId,
      // Keep the original once, with bounded identification hints for every
      // citable clause. A hint is not evidence; the server resolves the full span.
      ...(c.start === 0 && c.end === source.text.length ? {} : {
        hint: characters.slice(0, 24).join('') + (characters.length > 24 ? '…' : ''),
        range: [c.start, c.end],
      }) };
  });
}

/** Look up in this turn's authorized catalog only. Never parse an ID into a DB
 * lookup, accept a foreign/stale reference, or repair a supplied string quote. */
export function resolveCatalogCitation(citation: Record<string, unknown>, sources: SynthesisSource[]) {
  if (!Object.hasOwn(citation, 'citationId')) return null;
  if (Object.keys(citation).length !== 1 || typeof citation.citationId !== 'string') fail('invalid_model_citation', 502);
  const matches = sources.flatMap(source => sourceCitationCatalog(source)).filter(c => c.citationId === citation.citationId);
  if (matches.length !== 1 || sources.filter(s => s.sourceId === matches[0].sourceId).length !== 1) fail('invalid_model_citation', 502);
  return { sourceId: matches[0].sourceId, quote: matches[0].quote };
}

/** The same resolved catalog selections own feedback, numerical analysis and
 * display markers. No ID is looked up outside the authorized source set. */
export function selectedCatalogCitationIds(citations: Array<{sourceId:string;quote:string}>, sources: SynthesisSource[]) {
  return [...new Set(citations.flatMap(citation=>{
    const resolved=resolveCatalogCitation(citation as unknown as Record<string,unknown>,sources)||citation;
    const source=sources.find(source=>source.sourceId===resolved.sourceId);
    return source?sourceCitationCatalog(source).filter(option=>option.quote===resolved.quote).map(option=>option.citationId):[];
  }))];
}
export function sourceReferenceText(text:string,citations:Array<{sourceId:string;quote:string}>,sources:SynthesisSource[]) {
  return referenceMarkerText(text,selectedCatalogCitationIds(citations,sources));
}

/** Only an exact quoted filename, named edition or actual PDF page supported by a cited
 * source's typed trusted metadata is exempt from engineering-number matching.
 * Original prose still reaches commitment/scope guards. A bare number or a
 * quantity (including one glued to a document label) is never exempted. */
export function engineeringClaimText(text: string, citedSources: SynthesisSource[], citationCount = 0, citations:Array<{sourceId:string;quote:string}>=[],
  standardLabels: readonly string[] = []) {
  const aliases = new Map<string, { name: string; version: string }>();
  const filenames = new Set<string>();
  const pdfPages = new Set<number>();
  const publicStandards = new Set([...standardLabels, ...citedSources.flatMap(source => source.web?.standard ? [source.web.standard.id] : [])]);
  for (const source of citedSources) { const page = citedPdfPage(source); if (page !== null) pdfPages.add(page); }
  for (const source of citedSources.filter(s => s.kind === 'knowledge')) {
    const file = source.evidence?.file;
    if (file?.format === 'pdf' && typeof file.page === 'number' && Number.isSafeInteger(file.page) && file.page > 0)
      pdfPages.add(file.page);
    for (const label of [source.title, source.evidence?.file?.name].filter((s): s is string => !!s)) {
      if (/^[^\r\n《》“”"']+\.(?:pdf|docx|xlsx)$/iu.test(label)) filenames.add(label);
      for (const match of label.matchAll(/([\p{L}][\p{L}\p{Zs}\t·_-]{1,80}?)([vV]?\d+(?:\.\d+){1,3})(?=$|[\s·_—\-（）()\[\]【】]|\.(?:pdf|docx|xlsx)$|版)/gu)) {
        // A spaced quantity in the trusted filename/title is still a quantity,
        // not an edition. File extensions identify the document format only.
        const suffix=label.slice(match.index!+match[0].length).replace(/^\.(?:pdf|docx|xlsx)$/i,'');
        if(quantitySuffix.test(suffix))continue;
        const stem = match[1].trim();
        for (let i = 0; i < stem.length - 1; i++) {
          if (i && /[A-Za-z]/.test(stem[i - 1]) && /[A-Za-z]/.test(stem[i])) continue;
          const name = stem.slice(i);
          if (name.trim().length >= 2) aliases.set(name + '\u0000' + match[2], { name, version: match[2] });
        }
      }
    }
  }
  let result = proseNumberView(sourceReferenceText(text,citations,citedSources), citationCount);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const id of publicStandards) {
    const spelling = escape(id).replace(/^(\D+)(\d)/u, '$1[\\p{Zs}\\t]*$2').replace(/-/g, '[-—－]');
    result = result.replace(new RegExp('(?<![A-Z0-9])' + spelling + '(?![A-Z0-9]|[.,]\\d)', 'giu'),
      (match: string, offset: number, full: string) => quantitySuffix.test(full.slice(offset + match.length)) ? match : '规范编号');
  }
  for (const page of pdfPages) {
    // Coordinates describe this segment's cited original, not quantities in
    // its prose. Never trust a display label, another segment or a bare number.
    result = result.replace(new RegExp('第[\\p{Zs}\\t]*' + page + '[\\p{Zs}\\t]*页', 'gu'), '原文页');
  }
  for (const filename of [...filenames].sort((a, b) => b.length - a.length)) {
    // Exact paired quoting distinguishes a trusted filename (including its
    // numeric prefix/extension) from engineering quantities outside that name.
    // This is a claim-analysis view only; original prose and quotes stay intact.
    const expression = new RegExp([['《', '》'], ['“', '”'], ['"', '"'], ["'", "'"]]
      .map(([open, close]) => escape(open + filename + close)).join('|'), 'gu');
    result = result.replace(expression, match => match[0] + '文档名称' + match.at(-1));
  }
  for (const alias of [...aliases.values()].sort((a, b) => b.name.length - a.name.length)) {
    // Only horizontal layout space between the trusted name and edition may
    // vary. Never normalize originals, split version digits, or cross a line.
    const expression = new RegExp(escape(alias.name) + '[\\p{Zs}\\t]*' + escape(alias.version), 'gu');
    result = result.replace(expression, (match: string, offset: number, full: string) =>
      quantitySuffix.test(full.slice(offset + match.length)) ? match : '文档名称');
  }
  return result;
}
