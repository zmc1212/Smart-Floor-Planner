import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';

export const proseNumberProtocol = 'structured-list-and-reference-marker-v5';

/** Compare printed numbers without changing prose, source originals or decimal
 * precision. A complete ASCII thousands grouping is presentation, not several
 * independent quantities. Malformed grouping retains the old tokenization. */
export function groundedNumberTokens(text: string): string[] {
  return (text.match(/\d+(?:[,.]\d+)*/g) || []).flatMap(token =>
    /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(token)
      ? [token.replaceAll(',', '')] : token.match(/\d+(?:\.\d+)?/g) || []);
}

/** A calendar day written "9日" and stored "09" is one integer, not an
 * invented quantity: natural Chinese dates drop the leading zero. Only plain
 * integers are compared by value; every decimal keeps its printed precision. */
export function printedNumberSupported(token: string, supported: Set<string>): boolean {
  if (supported.has(token)) return true;
  if (!/^\d+$/.test(token)) return false;
  const value = BigInt(token);
  for (const candidate of supported) if (/^\d+$/.test(candidate) && BigInt(candidate) === value) return true;
  return false;
}
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
      const itemText = body.startsWith('**') || body.startsWith('__')
        ? plain(fromMarkdown(body).children[0] ?? {}).trimStart() : body;
      if (end === marker + 1 || !body.trim() || startsWithUnit.test(itemText)) break;
      spans.push([offset + cursor + start, offset + cursor + end]);
      cursor += part.length + 1;
    }
    if (spans.length === parts.length) return spans;
  }
  return sentenceInlineMarkers(text, offset);
}

/** A view of exact selected reference markers, never a rewrite of a provider
 * packet or source original. Verbatim code and block quotes stay untouched. */
export function referenceMarkerText(text: string, references: readonly string[]) {
  if (!references.length) return text;
  const spans: Array<[number, number]> = [];
  const visit = (node: RootContent) => {
    if (node.type === 'code' || node.type === 'blockquote') return;
    if (node.type === 'text') {
      const start=node.position?.start.offset,end=node.position?.end.offset;
      if (start!==undefined&&end!==undefined&&text.slice(start,end)===node.value)
        for (const reference of new Set(references)) {
          const marker='['+reference+']';let position=node.value.indexOf(marker);
          while(position>=0){
            // Do not join numerical fragments or turn an embedded reference
            // into a supported physical value. Keep ordinary code/quotes.
            if (!/\d/.test(node.value[position-1]||'')&&!/\d/.test(node.value[position+marker.length]||''))
              spans.push([start+position,start+position+marker.length]);
            position=node.value.indexOf(marker,position+marker.length);
          }
        }
    }
    if ('children' in node) for(const child of node.children)visit(child as RootContent);
  };
  for(const node of fromMarkdown(text).children)visit(node);
  let result=text;
  for(const [start,end] of spans.sort((a,b)=>b[0]-a[0]))result=result.slice(0,start)+' '+result.slice(end);
  return result;
}

/** Claim-analysis only: omit structural list/reference ordinals while keeping
 * measurements, dates, unknown syntax and every original item body. */
export function proseNumberView(text: string, citationCount = 0): string {
  const spans: Array<[number, number]> = [];
  const visit = (node: RootContent) => {
    if (node.type === 'code' || node.type === 'blockquote') return;
    // The segment's already-validated citations supply the reference namespace.
    // A sentence-end [1][2] is presentation, never a new source or a quantity.
    // Unknown ordinals, ranges, decimals, labels and unit-bearing values stay
    // visible to the numerical guard. Do not edit UI prose or source originals.
    if (node.type === 'text' && citationCount > 0) {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start !== undefined && end !== undefined && text.slice(start, end) === node.value) {
        for (const match of node.value.matchAll(/(?:\[[1-9]\d?\])+/gu)) {
          const before = node.value.slice(0, match.index), after = node.value.slice(match.index! + match[0].length);
          const ordinals = [...match[0].matchAll(/\[(\d+)\]/g)].map(item => Number(item[1]));
          if (!before.trim() || /[\d\[\]:：=＝~～—–-]\s*$/u.test(before)
            || !/^(?:[。！？；，,.!?;]|\s*$)/u.test(after)
            || startsWithUnit.test(after.trimStart()) || ordinals.some(ordinal => ordinal > citationCount)) continue;
          spans.push([start + match.index!, start + match.index! + match[0].length]);
        }
      }
    }
    if (node.type === 'paragraph' && node.children.every(child => child.type === 'text'
      || child.type === 'strong' && child.children.every(part => part.type === 'text'))) {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      const textNodes = node.children.filter(child => child.type === 'text');
      if (start !== undefined && end !== undefined && textNodes.every(child =>
        child.position && text.slice(child.position.start.offset, child.position.end.offset) === child.value)) {
        const markers = inlineMarkers(text.slice(start, end), start);
        if (markers.every(([from, to]) => textNodes.some(child => {
          const first = child.position?.start.offset, last = child.position?.end.offset;
          return first !== undefined && last !== undefined && from >= first && to <= last;
        }))) spans.push(...markers);
      }
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
