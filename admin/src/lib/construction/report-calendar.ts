import { fail } from '@/lib/assistant/contracts';

const dayMs = 86400000, offset = 8 * 3600000;
export type ReportPeriod = { kind: 'daily' | 'weekly'; start: Date; end: Date; cutoff: Date; scheduledAt: Date };
export function reportTime(value: unknown) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('invalid_construction', 422);
  return value;
}
export function reportDayStart(now: Date) {
  if (!Number.isFinite(now.getTime())) fail('invalid_construction', 422);
  return Math.floor((now.getTime() + offset) / dayMs) * dayMs - offset;
}
/** Shanghai has no DST; UTC arithmetic keeps the server's host timezone irrelevant. */
export function latestReportPeriod(kind: 'daily' | 'weekly', now: Date, time: string): ReportPeriod {
  const [h, m] = reportTime(time).split(':').map(Number), clock = (h * 60 + m) * 60000;
  const today = reportDayStart(now);
  if (kind === 'daily') {
    const start = today + clock <= now.getTime() ? today : today - dayMs;
    const cutoff = new Date(start + clock);
    return { kind, start: new Date(start), end: cutoff, cutoff, scheduledAt: cutoff };
  }
  const weekday = new Date(today + offset).getUTCDay();
  let monday = today - ((weekday + 6) % 7) * dayMs;
  if (monday + clock > now.getTime()) monday -= 7 * dayMs;
  return { kind, start: new Date(monday - 7 * dayMs), end: new Date(monday), cutoff: new Date(monday), scheduledAt: new Date(monday + clock) };
}
export function nextReportAt(kind: 'daily' | 'weekly', now: Date, time: string) {
  return new Date(latestReportPeriod(kind, now, time).scheduledAt.getTime() + (kind === 'daily' ? dayMs : 7 * dayMs));
}
/** A daily supplement closes at Shanghai midnight. Later state cannot be
 * backfilled into yesterday or a completed weekly period. */
export function correctedReportEnd(kind: string, start: Date, previousEnd: Date, now: Date) {
  reportDayStart(now);
  return kind === 'daily' ? new Date(Math.max(previousEnd.getTime(), Math.min(now.getTime(), start.getTime() + dayMs))) : previousEnd;
}
