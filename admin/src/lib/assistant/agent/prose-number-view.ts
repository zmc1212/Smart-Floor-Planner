import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';

export const proseNumberProtocol = 'structured-list-marker-v2';
// Ambiguous "1. ℃"/"1. 米" is kept as a numerical claim. Markup cannot
// turn a quantity into an ordinal. Quantities in item bodies remain untouched.
const startsWithUnit = /^(?:℃|°[CF]?|[%‰㎡㎥²³]|(?:mm|cm|km|kg|ml|mpa|kpa|kw|m|h|s|l|v|w)(?:\b|$)|毫米|厘米|千米|平方米|立方米|千克|毫升|兆帕|千瓦|小时|分钟|秒|天|周|个月|年|度|元|万元|遍|次|米|吨|克|升)/iu;

const plain = (node: RootContent | { children?: unknown[]; value?: unknown }): string => {
  if ('value' in node && typeof node.value === 'string') return node.value;
  return 'children' in node && Array.isArray(node.children) ? node.children.map(child => plain(child as RootContent)).join('') : '';
};

/** Sentence-delimited inline lists use the same CommonMark item parser as
 * ordinary lists. Unicode boundaries locate candidate items; only a complete
 * consecutive 1..N sequence with one marker style is annotated. Sentence
 * bodies, measurements and dates are never removed from the analysis view. */
function sentenceInlineMarkers(text: string, offset: number): Array<[number, number]> {
  for (let colon = 0; colon < text.length; colon++) {
    if (text[colon] !== '：' && text[colon] !== ':') continue;
    let start = colon + 1; while (text[start] === ' ' || text[start] === '\t') start++;
    const tail = text.slice(start), spans: Array<[number, number]> = [];
    let punctuation = '', invalid = false;
    for (const boundary of new Intl.Segmenter('zh-CN', { granularity: 'sentence' }).segment(tail)) {
      const candidate = tail.slice(boundary.index), list = fromMarkdown(candidate).children[0];
      if (list?.type !== 'list' || !list.ordered) {
        if (!boundary.index) break;
        continue;
      }
      const item = list.children[0], paragraph = item?.children[0];
      const itemStart = item?.position?.start.offset, end = paragraph?.position?.start.offset;
      if (paragraph?.type !== 'paragraph' || itemStart !== 0 || end === undefined) { invalid = true; break; }
      const marker = /^(\d{1,9})([.)])([\t ]+)$/.exec(candidate.slice(0, end));
      if (!marker || marker[1] !== String(spans.length + 1) || list.start !== spans.length + 1
        || punctuation && punctuation !== marker[2] || startsWithUnit.test(plain(paragraph).trimStart())) { invalid = true; break; }
      punctuation = marker[2]; spans.push([offset + start + boundary.index, offset + start + boundary.index + end]);
      if (spans.length > 12) { invalid = true; break; }
    }
    if (!invalid && spans.length >= 2) return spans;
  }
  return [];
}

/** A conservative inline-list grammar, separate from numerical claim parsing.
 * Colon + two or more semicolon-delimited, consecutive 1..N items, with the
 * same marker and horizontal space. A failed/ambiguous item rejects the whole
 * annotation. Bodies, code, quantities and original text are never changed. */
function inlineMarkers(text: string, offset: number): Array<[number, number]> {
  for (let colon = 0; colon < text.length; colon++) {
    if (text[colon] !== '：' && text[colon] !== ':') continue;
    const parts = text.slice(colon + 1).split(/[；;]/u);
    if (parts.length < 2 || parts.length > 12) continue;
    const spans: Array<[number, number]> = [];
    let cursor = colon + 1, punctuation = '';
    for (const [index, part] of parts.entries()) {
      let start = 0; while (part[start] === ' ' || part[start] === '\t') start++;
      const digits = String(index + 1), marker = start + digits.length;
      if (part.slice(start, marker) !== digits || !['.', ')'].includes(part[marker])
        || punctuation && punctuation !== part[marker]) break;
      punctuation = part[marker];
      let end = marker + 1; while (part[end] === ' ' || part[end] === '\t') end++;
      const body = part.slice(end).trimStart();
      if (end === marker + 1 || !body.trim() || startsWithUnit.test(body)) break;
      spans.push([offset + cursor + start, offset + cursor + end]);
      cursor += part.length + 1;
    }
    if (spans.length === parts.length) return spans;
  }
  return sentenceInlineMarkers(text, offset);
}

/** Claim-analysis view only. Parse CommonMark structure rather than guessing
 * numbers from line prefixes. Omit verified ordered-list marker spans; retain
 * every item body, unrecognized form, measurement, date, version and code.
 * UI prose, quoted originals and citation identities are never rewritten. */
export function proseNumberView(text: string): string {
  const spans: Array<[number, number]> = [];
  const visit = (node: RootContent) => {
    if (node.type === 'code' || node.type === 'blockquote') return;
    if (node.type === 'paragraph' && node.children.length === 1 && node.children[0].type === 'text') {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start !== undefined && end !== undefined && text.slice(start, end) === node.children[0].value)
        spans.push(...inlineMarkers(node.children[0].value, start));
    }
    if (node.type === 'list' && node.ordered) for (const item of node.children) {
      const start = item.position?.start.offset, paragraph = item.children[0], end = paragraph?.position?.start.offset;
      if (paragraph?.type !== 'paragraph' || start === undefined || end === undefined || end <= start) continue;
      const marker = text.slice(start, end);
      if (!/^\d{1,9}[.)][\t ]+$/.test(marker) || startsWithUnit.test(plain(paragraph).trimStart())) continue;
      spans.push([start, end]);
    }
    if ('children' in node) for (const child of node.children) visit(child as RootContent);
  };
  for (const node of fromMarkdown(text).children) visit(node);
  if (!spans.length) return text;
  let output = text;
  for (const [start, end] of spans.sort((a,b) => b[0]-a[0])) output = output.slice(0,start) + ' '.repeat(end-start) + output.slice(end);
  return output;
}
