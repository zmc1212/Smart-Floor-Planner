/** Acceptance contract for a native-executor round (xiaok-native-executor-v1).
 *
 * Stage report bodies compose through the native model path, so a failed or
 * empty stage body is always a violation, and the round window must contain
 * zero FastGPT audit records of any kind, including `stage`, because the
 * positive control already ran before the round opened.
 * These helpers are pure so the script's verdicts can be unit-tested offline.
 */
import { auditNativeMode } from './audit-window';

export const isNativeExecutor = (executor: string) => executor === auditNativeMode;

export type StageBodyReportRow = { bindingId: string; reportId?: string; bodyStatus?: unknown; bodyError?: unknown };
export type StageBodyReaderView = { kind: string; binding: string; bodyParts: number };

/** Every stage report row must have a succeeded body run with no error code,
 * and every reader's `detail.body` array must be non-empty. */
export function stageBodyViolations(input: {
  reports: readonly StageBodyReportRow[];
  readers: readonly StageBodyReaderView[];
}): string[] {
  const violations: string[] = [];
  for (const row of input.reports) {
    const label = 'binding ' + row.bindingId + (row.reportId ? ' report ' + row.reportId : '');
    if (String(row.bodyStatus || '') !== 'succeeded')
      violations.push(label + ' body_status=' + String(row.bodyStatus || '(missing)'));
    if (String(row.bodyError ?? '').trim()) violations.push(label + ' body_error=' + String(row.bodyError));
  }
  for (const view of input.readers)
    if (!Number.isFinite(view.bodyParts) || view.bodyParts <= 0)
      violations.push(view.kind + ' reader binding ' + view.binding + ' body is empty');
  return violations;
}

/** A native round claims zero FastGPT calls, so any seen audit kind — stage
 * included — invalidates the claim. */
export const nativeAuditKindViolations = (kinds: Record<string, number>) => Object.keys(kinds).sort();
