import { needSourceContextSupported } from './need-source-context';

/** A reading aid only: keep the complete literal need and its existing authority.
 * Reuse the write/source qualifier rules before treating a mentioned count as
 * affirmed. In particular, do not choose the denied option in a correction.
 */
export function affirmedNeedOccupancy(value: string): string | null {
  const mentions = /((?:单|双|多)人|[一二两三四五六七八九十\d]+(?:个)?人)(?:(?:共同|一起|轮流)?(?:办公|使用))?/g;
  for (const mention of value.matchAll(mentions)) {
    if (needSourceContextSupported({ room: '', value: mention[0], quote: value }, value)) return mention[1];
  }
  return null;
}

/** A later explicit unknown headcount also limits occupancy in an old mixed
 * desk row. A generic use update alone must not erase its independent meaning.
 */
export function hasNeedOccupancyUpdate(value: string): boolean {
  return /(?:单人|一人|双人|两人|多人).{0,6}(?:办公|使用)/.test(value)
    || /人数(?:还|尚|暂)?(?:未定|待定|待确认|不确定|未确定|没确定|没有确定|没定|未明确)/.test(value);
}
