/** Acceptance contract for a native-executor round (xiaok-native-executor-v1).
 *
 * Stage report bodies now compose through the native model path, so two
 * historical exemptions must not survive into a native round:
 *  - `--stage-fastgpt=down` may not excuse a failed or empty stage body; the
 *    flag is honored only in legacy FastGPT V2 rounds, where a deliberately
 *    skipped body was tolerated;
 *  - the round window must contain zero FastGPT audit records of any kind,
 *    including `stage`, because the positive control already ran before the
 *    round opened.
 * These helpers are pure so the script's verdicts can be unit-tested offline.
 */
import { auditNativeMode } from './audit-window';

export const legacyFastgptExecutor = 'fastgpt-agent-v2-v1';
export const isNativeExecutor = (executor: string) => executor === auditNativeMode;

/** The historical exemption is confined to legacy FastGPT V2 rounds. A native
 * round ignores the flag: its stage bodies are native-model output, so the flag
 * must never turn a real failure into a pass; an unknown executor fails closed. */
export const stageBodyToleratedByLegacyFlag = (executor: string, legacyDownFlag: boolean) =>
  executor === legacyFastgptExecutor && legacyDownFlag;

/** The outage note explains a legacy FastGPT round only; a native round must
 * never attribute a stage-body defect to an unreachable FastGPT deployment. */
export const stageFastgptDownNote = (executor: string, legacyDownFlag: boolean) =>
  stageBodyToleratedByLegacyFlag(executor, legacyDownFlag)
    ? 'FastGPT deployment unreachable by configuration for this round'
    : undefined;

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
