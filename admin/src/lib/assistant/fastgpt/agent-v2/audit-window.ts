/** Shared FastGPT audit-source contract for acceptance rounds.
 *
 * A native-executor round claims "zero FastGPT calls" from the same audit
 * ledger the FastGPT bridge writes. That claim is only meaningful when:
 *  - a positive-control probe receipt belongs to THIS acceptance batch and the
 *    same deployment/audit source (not a historical receipt from another run);
 *  - the probe ran while the V2 bridge was bound, and the audited round runs
 *    under the native executor — the expected V2→native mode switch, whose
 *    binding strings differ by design and are never compared for equality;
 *  - the ledger still contains the probe window and has not been shortened or
 *    rewritten, so an invalid audit source fails closed instead of looking
 *    like zero calls;
 *  - every judged record comes from the window opened immediately before the
 *    round's own requests, so earlier records can never be attributed to it.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

export const auditProbeSchemaVersion = 2;
export const auditProbeMode = 'fastgpt-agent-v2';
export const auditNativeMode = 'xiaok-native-executor-v1';

export type AuditProbeReceipt = {
  schemaVersion: number;
  batchId: string;
  probeRunId: string;
  conversationId?: string;
  auditFile: string;
  deployment: { workflowsFile: string; auditFile: string; serviceBase: string; fingerprint: string };
  probe: { mode: string; binding: string; verifiedAt: string };
  window: { before: number; after: number; prefixHash: string };
};

export type AuditRecord = { kind: string; value: Record<string, unknown> };
export type AuditWindowEntry = AuditRecord & { index: number; runId: string };

export type AuditSourceCode = 'receipt_missing' | 'receipt_invalid' | 'batch_mismatch' | 'deployment_mismatch'
  | 'mode_mismatch' | 'ledger_missing' | 'ledger_truncated' | 'ledger_rewritten' | 'ledger_invalid' | 'probe_record_missing';

export class AuditSourceError extends Error {
  code: AuditSourceCode;
  constructor(code: AuditSourceCode, message: string) { super(message); this.name = 'AuditSourceError'; this.code = code; }
}

/** Deterministic serialisation: key order must not change the deployment hash. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}
export const auditDigest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const auditPrefixHash = (lines: string[], end: number) =>
  createHash('sha256').update(lines.slice(0, end).join('\n')).digest('hex');

/** Deployment identity shared by the V2 probe and the native round. The
 * per-request `agentV2.runtime` switch is excluded on purpose: it is the
 * expected mode transition, not a different deployment. */
export function auditDeployment(workflowsFile: string, workflows: Record<string, unknown>, serviceBase: string) {
  const resolved = path.resolve(workflowsFile);
  const auditFile = path.resolve(String(workflows.auditFile || ''));
  if (!workflows.auditFile || !auditFile) throw new AuditSourceError('ledger_missing', 'workflows.auditFile 未配置,审计来源无效');
  const normalized = JSON.parse(JSON.stringify(workflows)) as Record<string, unknown>;
  const agentV2 = normalized.agentV2 as Record<string, unknown> | undefined;
  if (agentV2 && typeof agentV2 === 'object') delete agentV2.runtime;
  return { workflowsFile: resolved, auditFile, serviceBase, fingerprint: auditDigest({ ...normalized, workflowsFile: resolved, serviceBase }) };
}

const recordOf = (line: string, index: number): AuditRecord => {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return { kind: String(parsed.kind || ''), value: (parsed.value ?? {}) as Record<string, unknown> };
  } catch {
    throw new AuditSourceError('ledger_invalid', '审计账本第' + (index + 1) + '行无法解析,审计来源无效');
  }
};
const runIdOf = (record: AuditRecord) => String(record.value.runId || '');

/** Verify the batch probe receipt and open this round's window at the actual
 * current ledger position. The receipt's `window.after` is a historical
 * watermark: it must still exist and match its prefix hash, but the round
 * window always starts at the live log length read here. */
export function openAuditWindow(input: {
  receipt: unknown;
  expected: { batchId: string; workflowsFile: string; auditFile: string; serviceBase: string;
    deploymentFingerprint: string; roundMode: string };
  lines: string[];
}) {
  const { receipt, expected, lines } = input;
  if (!receipt || typeof receipt !== 'object') throw new AuditSourceError('receipt_missing', '审计探针回执缺失');
  const value = receipt as AuditProbeReceipt;
  if (value.schemaVersion !== auditProbeSchemaVersion) throw new AuditSourceError('receipt_invalid',
    '审计探针回执版本过旧(需 schemaVersion ' + auditProbeSchemaVersion + '),不得作为本轮正控');
  if (!String(value.batchId || '').trim() || value.batchId !== expected.batchId) throw new AuditSourceError('batch_mismatch',
    '审计探针回执属于批次 ' + String(value.batchId || '(缺失)') + ',不是本轮批次 ' + expected.batchId);
  if (!value.deployment || path.resolve(String(value.deployment.workflowsFile || '')) !== path.resolve(expected.workflowsFile)
    || path.resolve(String(value.deployment.auditFile || value.auditFile || '')) !== path.resolve(expected.auditFile)
    || String(value.deployment.serviceBase || '') !== expected.serviceBase
    || String(value.deployment.fingerprint || '') !== expected.deploymentFingerprint) throw new AuditSourceError('deployment_mismatch',
    '审计探针回执属于另一部署或审计来源,不得作为本轮正控');
  if (String(value.probe?.mode || '') !== auditProbeMode || expected.roundMode !== auditNativeMode) throw new AuditSourceError('mode_mismatch',
    '审计探针须在 fastgpt-agent-v2 绑定下取得回执,本轮须以 xiaok-native-executor-v1 运行: '
    + String(value.probe?.mode || '(缺失)') + ' -> ' + expected.roundMode);
  const before = Number(value.window?.before), after = Number(value.window?.after);
  if (!Number.isInteger(before) || !Number.isInteger(after) || before < 0 || after < 1 || before > after)
    throw new AuditSourceError('receipt_invalid', '审计探针回执窗口水位无效');
  if (lines.length < after) throw new AuditSourceError('ledger_truncated',
    '审计来源失效:日志仅' + lines.length + '行,低于探针窗口水位' + after + ',不得按零调用判通过');
  if (auditPrefixHash(lines, after) !== String(value.window.prefixHash || '')) throw new AuditSourceError('ledger_rewritten',
    '审计来源失效:探针窗口内的日志已被替换或重建,不得按零调用判通过');
  const probeIndex = lines.slice(before, after).map(recordOf)
    .findIndex(record => record.kind === 'agentV2' && runIdOf(record) === String(value.probeRunId));
  if (probeIndex < 0) throw new AuditSourceError('probe_record_missing',
    '审计账本探针窗口内缺少 run ' + value.probeRunId + ' 的 agentV2 记录,不得作为本轮正控');
  return { probeRunId: String(value.probeRunId), batchId: String(value.batchId), probeMode: String(value.probe.mode),
    probeBinding: String(value.probe.binding), verifiedAt: String(value.probe.verifiedAt),
    probeWindow: { before, after }, windowStart: lines.length, ledgerLength: lines.length,
    modeTransition: String(value.probe.mode) + ' -> ' + expected.roundMode };
}

/** Records added at/after `windowStart`. A log shorter than the opened window
 * is an invalid audit source, never an empty (zero-call) result. */
export function auditWindowEntries(lines: string[], windowStart: number): AuditWindowEntry[] {
  if (windowStart < 0 || lines.length < windowStart) throw new AuditSourceError('ledger_truncated',
    '审计来源失效:本轮窗口起点' + windowStart + '超出当前日志长度' + lines.length);
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
