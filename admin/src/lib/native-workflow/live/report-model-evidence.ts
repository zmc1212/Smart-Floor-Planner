/** Offline acceptance evidence for one B5.2 daily report.
 *
 * A report only counts as produced by this run when the whole chain is bound to
 * the same business identity: the report row, its latest version, the facts run
 * that authored it, the body run that composed it, the succeeded `agent_model`
 * steps of that body run, the succeeded/accepted provider attempts of those
 * steps and the observed token usage of exactly those attempts. Historical,
 * failed, unaccepted, FastGPT or other-run rows can never be accepted as this
 * run's evidence.
 *
 * Everything here is a pure function of caller-supplied rows: no database, no
 * environment, no clock. `fresh` and `replay` are evaluated separately so a
 * reused success is never described as a new model call.
 */

export interface ReportEvidenceReport {
  id: string;
  latest_revision: number;
}

export interface ReportEvidenceVersion {
  report_id: string;
  revision: number;
  run_id: string;
  body_run_id: string | null;
  status: string;
  knowledge_status: string;
}

export interface ReportEvidenceRun {
  id: string;
  purpose: string;
  status: string;
}

export interface ReportEvidenceStep {
  run_id: string;
  step_seq: number;
  kind: string;
  status: string;
  provider_attempt_id: string | null;
}

export interface ReportEvidenceAttempt {
  id: string;
  assistant_run_id: string | null;
  provider_key: string;
  adapter_type: string;
  status: string;
  accepted: boolean;
}

export interface ReportEvidenceUsage {
  id: string;
  run_id: string;
  provider_attempt_id: string | null;
  category: string;
  measurement_kind: string;
  quantity: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface ReportEvidenceSnapshot {
  report: ReportEvidenceReport | null;
  version: ReportEvidenceVersion | null;
  factsRun: ReportEvidenceRun | null;
  bodyRun: ReportEvidenceRun | null;
  steps: readonly ReportEvidenceStep[];
  attempts: readonly ReportEvidenceAttempt[];
  usage: readonly ReportEvidenceUsage[];
}

export interface ReportEvidenceExpected {
  reportId: string;
  revision: number;
  factsRunId: string;
}

export interface ReportModelEvidence {
  ok: boolean;
  reasons: readonly string[];
  binding: {
    reportId: string;
    revision: number;
    factsRunId: string;
    bodyRunId: string;
    attemptIds: readonly string[];
    usageIds: readonly string[];
    inputTokens: number;
    outputTokens: number;
  } | null;
}

const FACTS_PURPOSE = 'construction.report.facts';
const BODY_PURPOSE = 'construction.report.compose';
const MODEL_STEP_KIND = 'agent_model';
const TOKEN_CATEGORY = 'tokens';
const OBSERVED_MEASUREMENT = 'observed';
const FASTGPT_PATTERN = /fastgpt/iu;

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFastGpt(attempt: ReportEvidenceAttempt): boolean {
  return FASTGPT_PATTERN.test(attempt.provider_key) || FASTGPT_PATTERN.test(attempt.adapter_type);
}

function observedUsage(usage: readonly ReportEvidenceUsage[]): ReportEvidenceUsage | null {
  return usage.find((row) => row.measurement_kind === OBSERVED_MEASUREMENT
    && row.input_tokens !== null && row.output_tokens !== null) ?? null;
}

/** Full model-evidence check. Every failed rule appends its own stable code. */
export function evaluateReportModelEvidence(
  expected: ReportEvidenceExpected,
  snapshot: ReportEvidenceSnapshot,
): ReportModelEvidence {
  const reasons: string[] = [];
  const seen = new Set<string>();
  const push = (code: string): void => {
    if (seen.has(code)) return;
    seen.add(code);
    reasons.push(code);
  };

  const report = snapshot.report;
  if (!report) push('report_missing');
  else {
    if (report.id !== expected.reportId) push('report_id_mismatch');
    if (report.latest_revision !== expected.revision) push('report_revision_mismatch');
  }

  const version = snapshot.version;
  if (!version) push('version_missing');
  else {
    if (version.report_id !== expected.reportId) push('version_report_id_mismatch');
    if (version.revision !== expected.revision) push('version_revision_mismatch');
    if (version.run_id !== expected.factsRunId) push('version_facts_run_mismatch');
    if (!nonEmpty(version.body_run_id)) push('version_body_run_missing');
    if (version.status !== 'facts_ready') push('version_status_mismatch');
    if (version.knowledge_status !== 'ready') push('version_knowledge_not_ready');
  }

  const factsRun = snapshot.factsRun;
  if (!factsRun) push('facts_run_missing');
  else {
    if (factsRun.id !== expected.factsRunId) push('facts_run_id_mismatch');
    if (factsRun.purpose !== FACTS_PURPOSE) push('facts_run_purpose_mismatch');
    if (factsRun.status !== 'succeeded') push('facts_run_not_succeeded');
  }

  const bodyRunId = nonEmpty(version?.body_run_id) ? version.body_run_id : '';
  const bodyRun = snapshot.bodyRun;
  if (!bodyRun) push('body_run_missing');
  else {
    if (bodyRunId && bodyRun.id !== bodyRunId) push('body_run_id_mismatch');
    if (bodyRun.purpose !== BODY_PURPOSE) push('body_run_purpose_mismatch');
    if (bodyRun.status !== 'succeeded') push('body_run_not_succeeded');
  }

  if (!bodyRunId) {
    return { ok: false, reasons, binding: null };
  }

  const modelSteps = snapshot.steps
    .filter((step) => step.run_id === bodyRunId && step.kind === MODEL_STEP_KIND)
    .sort((left, right) => left.step_seq - right.step_seq);
  if (!modelSteps.length) push('model_step_missing');
  for (const step of modelSteps) {
    if (step.status !== 'succeeded') push('model_step_not_succeeded');
    if (!nonEmpty(step.provider_attempt_id)) push('model_step_attempt_missing');
  }

  // The snapshot is expected to be scoped to this body run. Any attempt that
  // belongs to another run, failed, was not accepted or came from FastGPT is a
  // rejection even if some other row would look usable.
  for (const attempt of snapshot.attempts) {
    if (attempt.assistant_run_id !== bodyRunId) push('attempt_run_mismatch');
    if (attempt.status !== 'succeeded') push('attempt_not_succeeded');
    if (attempt.accepted !== true) push('attempt_not_accepted');
    if (isFastGpt(attempt)) push('fastgpt_attempt');
  }

  const attemptIds: string[] = [];
  for (const step of modelSteps) {
    const attemptId = step.provider_attempt_id;
    if (!nonEmpty(attemptId)) continue;
    if (!attemptIds.includes(attemptId)) attemptIds.push(attemptId);
    const attempt = snapshot.attempts.find((row) => row.id === attemptId);
    if (!attempt) {
      push('attempt_missing');
      continue;
    }
    if (attempt.assistant_run_id !== bodyRunId) push('attempt_run_mismatch');
    if (attempt.status !== 'succeeded') push('attempt_not_succeeded');
    if (attempt.accepted !== true) push('attempt_not_accepted');
    if (isFastGpt(attempt)) push('fastgpt_attempt');
  }

  // Token usage must be attached to exactly one bound attempt; other runs,
  // other attempts and unattributed token rows never count. Other categories
  // (for example an embedding used by the same body run) are not model
  // evidence and neither prove nor invalidate it.
  for (const row of snapshot.usage) {
    if (row.category !== TOKEN_CATEGORY) continue;
    if (row.run_id !== bodyRunId) push('usage_run_mismatch');
    else if (!nonEmpty(row.provider_attempt_id) || !attemptIds.includes(row.provider_attempt_id)) {
      push('usage_attempt_mismatch');
    } else {
      if (row.measurement_kind !== OBSERVED_MEASUREMENT) push('usage_not_observed');
      if (row.input_tokens === null || row.output_tokens === null) push('usage_tokens_missing');
    }
  }

  const usageIds: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  for (const attemptId of attemptIds) {
    const bound = snapshot.usage.filter((row) => row.provider_attempt_id === attemptId
      && row.category === TOKEN_CATEGORY);
    if (!bound.length) {
      push('usage_missing');
      continue;
    }
    const inRun = bound.filter((row) => row.run_id === bodyRunId);
    if (!inRun.length) {
      push('usage_run_mismatch');
      continue;
    }
    const tokens = inRun.filter((row) => row.category === TOKEN_CATEGORY);
    if (!tokens.length) {
      push('usage_missing');
      continue;
    }
    const observed = tokens.filter((row) => row.measurement_kind === OBSERVED_MEASUREMENT);
    if (!observed.length) {
      push('usage_not_observed');
      continue;
    }
    const usable = observedUsage(observed);
    if (!usable) {
      push('usage_tokens_missing');
      continue;
    }
    if (!usageIds.includes(usable.id)) usageIds.push(usable.id);
    inputTokens += usable.input_tokens ?? 0;
    outputTokens += usable.output_tokens ?? 0;
  }

  if (reasons.length) return { ok: false, reasons, binding: null };
  return {
    ok: true,
    reasons,
    binding: {
      reportId: expected.reportId,
      revision: expected.revision,
      factsRunId: expected.factsRunId,
      bodyRunId,
      attemptIds,
      usageIds,
      inputTokens,
      outputTokens,
    },
  };
}

export interface PeriodCounts {
  assistantUsageRecords: number;
  aiProviderAttempts: number;
  assistantJobs: number;
  assistantRuns: number;
  constructionReports: number;
  reportDeliveries: number;
  reportMessages: number;
}

export const PERIOD_COUNT_KEYS = [
  'assistantUsageRecords',
  'aiProviderAttempts',
  'assistantJobs',
  'assistantRuns',
  'constructionReports',
  'reportDeliveries',
  'reportMessages',
] as const satisfies readonly (keyof PeriodCounts)[];

export interface WorkerJobState {
  status: string;
  attempts: number;
}

export interface FreshAcceptanceInput {
  saveReceipt: Record<string, unknown> | null;
  evidence: ReportModelEvidence;
  countsBefore: PeriodCounts;
  countsAfter: PeriodCounts;
  worker: { factsJob: WorkerJobState | null; bodyJob: WorkerJobState | null };
}

function receiptString(receipt: Record<string, unknown>, key: string): string {
  const value = receipt[key];
  return typeof value === 'string' ? value.trim() : '';
}

function receiptRevision(receipt: Record<string, unknown>): number {
  const value = receipt.revision;
  return typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
}

function workerJobReasons(
  label: 'facts' | 'body',
  job: WorkerJobState | null,
): string[] {
  if (!job) return [`worker_${label}_job_missing`];
  const reasons: string[] = [];
  if (job.status !== 'succeeded') reasons.push(`worker_${label}_job_not_succeeded`);
  if (job.attempts < 1) reasons.push(`worker_${label}_job_attempts_zero`);
  return reasons;
}

/** Fresh acceptance: a new report was generated and really delivered this run. */
export function evaluateFreshGeneration(input: FreshAcceptanceInput): { ok: boolean; reasons: readonly string[] } {
  const reasons: string[] = [];
  const seen = new Set<string>();
  const push = (code: string): void => {
    if (seen.has(code)) return;
    seen.add(code);
    reasons.push(code);
  };

  const receipt = input.saveReceipt;
  if (!receipt) push('fresh_receipt_missing');
  else {
    if (receipt.reused !== false) push('fresh_receipt_reused');
    const reportId = receiptString(receipt, 'reportId');
    const runId = receiptString(receipt, 'runId');
    const revision = receiptRevision(receipt);
    if (!reportId || !runId || !Number.isFinite(revision)) push('fresh_receipt_incomplete');
    const binding = input.evidence.binding;
    if (!binding || binding.reportId !== reportId || binding.revision !== revision || binding.factsRunId !== runId) {
      push('fresh_evidence_mismatch');
    }
  }

  if (!input.evidence.ok) {
    push('model_evidence_failed');
    for (const reason of input.evidence.reasons) push(reason);
  }

  for (const key of PERIOD_COUNT_KEYS) {
    if (!(input.countsAfter[key] > input.countsBefore[key])) push(`fresh_counts_not_increased:${key}`);
  }

  for (const code of workerJobReasons('facts', input.worker.factsJob)) push(code);
  for (const code of workerJobReasons('body', input.worker.bodyJob)) push(code);

  return { ok: reasons.length === 0, reasons };
}

export interface ReplayAcceptanceInput {
  expected: { reportId: string; revision: number; factsRunId: string; reportKey: string };
  saveReceipt: Record<string, unknown> | null;
  deliveryReceipt: Record<string, unknown> | null;
  expectedDelivery: { messageId: string; conversationId: string } | null;
  countsBefore: PeriodCounts;
  countsAfter: PeriodCounts;
}

/** Replay acceptance: the same report/version/delivery is reused, no new rows. */
export function evaluateReplay(input: ReplayAcceptanceInput): { ok: boolean; reasons: readonly string[] } {
  const reasons: string[] = [];
  const seen = new Set<string>();
  const push = (code: string): void => {
    if (seen.has(code)) return;
    seen.add(code);
    reasons.push(code);
  };

  const saveReceipt = input.saveReceipt;
  if (!saveReceipt) push('replay_receipt_missing');
  else {
    if (saveReceipt.reused !== true) push('replay_receipt_not_reused');
    const revision = receiptRevision(saveReceipt);
    if (receiptString(saveReceipt, 'reportId') !== input.expected.reportId
      || revision !== input.expected.revision
      || receiptString(saveReceipt, 'runId') !== input.expected.factsRunId
      || receiptString(saveReceipt, 'reportKey') !== input.expected.reportKey) {
      push('replay_receipt_mismatch');
    }
  }

  const deliveryReceipt = input.deliveryReceipt;
  if (!deliveryReceipt || !input.expectedDelivery) {
    push('replay_delivery_missing');
  } else {
    if (deliveryReceipt.status !== 'delivered') push('replay_delivery_not_delivered');
    if (receiptString(deliveryReceipt, 'messageId') !== input.expectedDelivery.messageId
      || receiptString(deliveryReceipt, 'conversationId') !== input.expectedDelivery.conversationId) {
      push('replay_delivery_mismatch');
    }
  }

  for (const key of PERIOD_COUNT_KEYS) {
    if (input.countsAfter[key] !== input.countsBefore[key]) push(`replay_counts_changed:${key}`);
  }

  return { ok: reasons.length === 0, reasons };
}
