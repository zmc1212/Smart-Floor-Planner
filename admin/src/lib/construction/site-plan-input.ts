import type { PlanCommand } from './site-plans';

export type NaturalPlanFields = { title: string; costQuote: string; scheduleQuote: string };
function cost(quote: string): number | undefined {
  const value = quote.replace(/\s/g, '');
  if (/^(?:费用(?:变化)?(?:保持)?不变|费用(?:变化)?[：:]?0(?:\.00?)?元)$/.test(value)) return 0;
  const match = /^(?:本次|这次)?(?:费用(?:变化)?[：:]?)?(增加|追加|减少|减免|\+|-)(\d+(?:\.\d{1,2})?)元$/.exec(value);
  if (!match) return undefined;
  const [whole, fraction = ''] = match[2].split('.'), cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 100000000 ? (['减少', '减免', '-'].includes(match[1]) ? -cents : cents) : undefined;
}
function days(quote: string): number | undefined {
  const value = quote.replace(/\s/g, '');
  if (/^(?:工期(?:变化)?(?:保持)?不变|工期(?:变化)?[：:]?0天)$/.test(value)) return 0;
  const match = /^(?:本次|这次)?(?:工期(?:变化)?[：:]?)?(延长|增加|缩短|减少|\+|-)(\d+)天$/.exec(value);
  if (!match) return undefined;
  const n = Number(match[2]); return Number.isSafeInteger(n) && n <= 365 ? (['缩短', '减少', '-'].includes(match[1]) ? -n : n) : undefined;
}
/** The model selects exact source quotes, never amounts or a rewritten change.
 * Human confirmation reviews the complete original as the formal difference. */
export function naturalPlanInput(original: string, issueId: string, fields: NaturalPlanFields, mediaIds: string[]) {
  const title = fields.title.trim(), costQuote = fields.costQuote.trim(), scheduleQuote = fields.scheduleQuote.trim();
  // A quote must be the complete source clause: cropping “预计/可能/左右”
  // off a number cannot turn an estimate into a formal impact.
  const clauses = original.split(/[，,。；;！？!?\n]/).map(value => value.trim());
  const costDeltaCents = costQuote && clauses.includes(costQuote) ? cost(costQuote) : undefined;
  const scheduleDeltaDays = scheduleQuote && clauses.includes(scheduleQuote) ? days(scheduleQuote) : undefined;
  const missing = [mediaIds.length === 1 ? '' : '一张本人本次上传的方案原图', title && title.length <= 80 && original.includes(title) ? '' : '原话中的明确方案名称',
    costDeltaCents !== undefined ? '' : '明确的费用增加／减少或不变', scheduleDeltaDays !== undefined ? '' : '明确的工期延长／缩短或不变',
    original.length <= 1200 ? '' : '1200字内的完整方案原话'].filter(Boolean);
  return { missing, command: missing.length ? undefined : { action: 'publish', issueId, title, difference: original, costDeltaCents: costDeltaCents!, scheduleDeltaDays: scheduleDeltaDays! } as Extract<PlanCommand, { action: 'publish' }> };
}
