import type { BusinessSnapshot } from './business-tools';
import type { ReportBusinessReference } from './report-context';

export const reportFinalProtocol = 'report-originals-sourced-answer-v1';

/** A discriminator for a service-authored report read, not an authorization
 * resolver. Callers must obtain it from a paired tool result or a revalidated
 * durable service checkpoint, never user/provider-authored source data. */
export function isReportAnswerSnapshot(value: unknown): value is BusinessSnapshot & { reportReference: ReportBusinessReference } {
  const packet = value as { query?: { domain?: unknown }; reportReference?: ReportBusinessReference } | null;
  const selection = packet?.reportReference?.selection;
  return packet?.query?.domain === 'construction' && !!selection
    && ['bindingId', 'reportId', 'projectId', 'conversationId', 'factsHash'].every(key =>
      typeof selection[key as keyof typeof selection] === 'string' && !!selection[key as keyof typeof selection])
    && Number.isSafeInteger(selection.revision) && selection.revision > 0;
}

/** A report snapshot is an answer source. Its display receipt cannot stand in
 * for answering a natural follow-up. The ordinary synthesis decoder continues
 * to own citations, quantities, commitments and response semantics. */
export function reportFinalResponseIssue(raw: string, snapshot: unknown) {
  if (!isReportAnswerSnapshot(snapshot)) return null;
  let kind: unknown;
  try { kind = JSON.parse(raw)?.kind; } catch { return null; }
  if (kind === 'synthesis') return null;
  return { code: 'invalid_model_answer', feedback: JSON.stringify({ status: 'report_answer_required', protocol: reportFinalProtocol,
    allowedKinds: ['synthesis'], instruction: '所选报告的读取回执是回答来源，不能以business整段显示代替回答。沿本轮已有synthesisSources和citationOptions，用kind=synthesis及segments回答当前追问；用户更正仍是用户原话，原报告及截止后未知不变。只修复最终回答，不再调用查询、保存或其他业务工具；仍须通过原引用、数值、承诺和权限校验，沿原一次最终校验恢复预算。' }) };
}
