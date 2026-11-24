/** Shared FastGPT audit-ledger window contract for acceptance rounds.
 *
 * The FastGPT audit ledger is append-only. A native-executor round claims
 * "zero FastGPT calls"; that claim is only meaningful when:
 *  - the judged records come from the window opened immediately before the
 *    round's own requests, so earlier records can never be attributed to it;
 *  - closing the window re-verifies the prefix identity captured at open, so a
 *    same-length replacement, or a log shortened and regrown to the same
 *    length, still fails closed instead of reading as zero calls.
 */
import { createHash } from 'node:crypto';

export const auditNativeMode = 'xiaok-native-executor-v1';

/** Identity captured when the round window opens. `windowStart` alone cannot
 * distinguish an append-only ledger from one replaced by different content of
 * the same length, or shortened and regrown; `windowPrefixHash` re-verifies the
 * prefix the window was actually opened on. */
export type AuditWindowHandle = { windowStart: number; windowPrefixHash: string };

export type AuditRecord = { kind: string; value: Record<string, unknown> };
export type AuditWindowEntry = AuditRecord & { index: number; runId: string };

export type AuditSourceCode = 'ledger_truncated' | 'ledger_rewritten' | 'ledger_invalid';

export class AuditSourceError extends Error {
  code: AuditSourceCode;
  constructor(code: AuditSourceCode, message: string) { super(message); this.name = 'AuditSourceError'; this.code = code; }
}

export const auditPrefixHash = (lines: string[], end: number) =>
  createHash('sha256').update(lines.slice(0, end).join('\n')).digest('hex');

const recordOf = (line: string, index: number): AuditRecord => {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return { kind: String(parsed.kind || ''), value: (parsed.value ?? {}) as Record<string, unknown> };
  } catch {
    throw new AuditSourceError('ledger_invalid', '审计账本第' + (index + 1) + '行无法解析,审计来源无效');
  }
};
const runIdOf = (record: AuditRecord) => String(record.value.runId || '');

/** Records added at/after the opened window. A log shorter than the opened
 * window, or whose prefix no longer matches the identity captured at open, is
 * an invalid audit source, never an empty (zero-call) result. */
export function auditWindowEntries(lines: string[], window: AuditWindowHandle): AuditWindowEntry[] {
  const windowStart = window.windowStart;
  if (windowStart < 0 || lines.length < windowStart) throw new AuditSourceError('ledger_truncated',
    '审计来源失效:本轮窗口起点' + windowStart + '超出当前日志长度' + lines.length);
  if (auditPrefixHash(lines, windowStart) !== window.windowPrefixHash) throw new AuditSourceError('ledger_rewritten',
    '审计来源失效:开窗后的日志前缀已被替换或重建(含同长度替换),不得按零调用判通过');
  return lines.slice(windowStart).map((line, offset) => {
    const record = recordOf(line, windowStart + offset);
    return { ...record, index: windowStart + offset, runId: runIdOf(record) };
  });
}
export function auditKindCounts(entries: AuditWindowEntry[]) {
  const kinds: Record<string, number> = {};
  for (const entry of entries) kinds[entry.kind] = (Number(kinds[entry.kind]) || 0) + 1;
  return kinds;
}
/** Native rounds may only see the stage-report exception; any other kind means
 * this round's chat path called FastGPT. */
export const auditNonStageKinds = (kinds: Record<string, number>) => Object.keys(kinds).filter(kind => kind !== 'stage');
export const readableAuditError = (error: unknown) => error instanceof AuditSourceError
  ? '审计来源失效(' + error.code + '): ' + error.message : (error as Error).message;
