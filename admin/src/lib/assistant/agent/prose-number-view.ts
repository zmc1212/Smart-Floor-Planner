import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';

export const proseNumberProtocol = 'markdown-list-marker-v1';
// Ambiguous "1. ℃"/"1. 米" is kept as a numerical claim. Markup cannot
// turn a quantity into an ordinal. Quantities in item bodies remain untouched.
const startsWithUnit = /^(?:℃|°[CF]?|[%‰㎡㎥²³]|(?:mm|cm|km|kg|ml|mpa|kpa|kw|m|h|s|l|v|w)(?:\b|$)|毫米|厘米|千米|平方米|立方米|千克|毫升|兆帕|千瓦|小时|分钟|秒|天|周|个月|年|度|元|万元|遍|次|米|吨|克|升)/iu;

/** Claim-analysis view only. Parse CommonMark structure rather than guessing
 * numbers from line prefixes. Omit verified ordered-list marker spans; retain
 * every item body, unrecognized form, measurement, date, version and code.
 * UI prose, quoted originals and citation identities are never rewritten. */
export function proseNumberView(text: string): string {
  const spans: Array<[number, number]> = [];
  const plain = (node: RootContent | { children?: unknown[]; value?: unknown }): string => {
    if ('value' in node && typeof node.value === 'string') return node.value;
    return 'children' in node && Array.isArray(node.children) ? node.children.map(child => plain(child as RootContent)).join('') : '';
  };
  const visit = (node: RootContent) => {
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
