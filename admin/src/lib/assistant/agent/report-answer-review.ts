import { fail } from '../contracts';
import type { ModelMessage, ModelTool } from '../contracts/model';
import { parseSynthesis, type SynthesisSource } from './synthesis';
import type { SynthesisReviewContext } from './synthesis-review';
import { reportAnswerSynthesis, reportQuestionCoverage } from './report-final';
import { prepareSourceAnswerReview, acceptKnowledgeExplanation, type KnowledgeExplanationDraft } from './knowledge-explanation';
import { reportAnswerGroundingProtocol } from './report-source-scope';
import type { SourceQuestionCoverage } from './source-question-coverage';
import { modelCitationCatalog, resolveCatalogCitation } from './citation-catalog';
import { groundedNumberTokens, printedNumberSupported } from './prose-number-view';
import { toolSchemaIssue } from './tool-protocol';

/** Report-only reviewer guidance. A report may legitimately have no published
 * site item; the answer then names that absence and keeps the recorded stage
 * and pending item. The reviewer must not demand a fact the report never had,
 * and its verdict stays short enough for its own schema. */
export const reportReviewGuidance = '这是所选报告的追问复核。报告没有记录某项具体施工动作时，正文写明该缺失并保留来源中已有的阶段标记和待核对项，即为已回答该项；不得因缺少来源中不存在的施工动作判false。reason不超过八十字。';

/** Name exactly which planned questions the draft dropped. A merged answer
 * cannot stand in for two separate questions: the reviewer judges each one
 * alone, so the repair must restore the missing Q keys. */
export function reportCoverageGapFailure(raw: string, coverage: SourceQuestionCoverage) {
  let answers: Record<string, unknown>;
  try { answers = (JSON.parse(raw) as { answers?: Record<string, unknown> }).answers || {}; } catch { return null; }
  const keys = coverage.questions.map((_, index) => 'Q' + (index + 1));
  const missing = keys.filter(key => !Array.isArray(answers[key]) || !(answers[key] as unknown[]).length);
  if (!missing.length) return null;
  return { code: 'incomplete_model_answer', feedback: JSON.stringify({ status: 'report_questions_missing',
    protocol: coverage.protocol, missing, questions: Object.fromEntries(keys.map((key, index) => [key, coverage.questions[index]])),
    instruction: '这些问项在answers里缺失或为空。必须逐项保留Q编号并给出非空basis/text/citations段落，不能把两个问项合并成一段答复；每项只回答该问句本身，其余问项保持原样，仍提交kind=report_answer及answers。' }) };
}

/** A report with no published record must say so inside every question that
 * quotes its originals: otherwise the customer reads an isolated stage marker or
 * pending item as if it were a current site result. Questions that only give
 * advice carry no report citation and are exempt.
 *
 * The same report can appear twice in the synthesis context: the persisted
 * tool receipt (`B{run}:…`) and the current projection (`Breport:{run}:…`).
 * They carry different citation ids for the same report facts, so the guard
 * checks the cited source's report identity and kind, never one hard-coded
 * sourceId. Citing report 536's stage sources still requires report 536's
 * metadata source; a citation from another report never satisfies it. */
const reportIdentity = (scope: NonNullable<SynthesisSource['reportScope']>) =>
  scope.reportId + ':' + scope.revision + ':' + scope.factsHash;

export function reportAbsenceScopeFailure(raw: string, sources: SynthesisSource[], coverage: SourceQuestionCoverage) {
  if (sources.some(source => source.reportScope?.kind === 'record')) return null;
  const metadata = sources.filter(source => source.reportScope?.kind === 'metadata');
  if (!metadata.length) return null;
  let answers: Record<string, unknown>;
  try { answers = (JSON.parse(raw) as { answers?: Record<string, unknown> }).answers || {}; } catch { return null; }
  const missing: string[] = [];
  let suggested = metadata[0];
  for (const [index] of coverage.questions.entries()) {
    const key = 'Q' + (index + 1);
    const segments = Array.isArray(answers[key]) ? answers[key] as Array<{ citations?: unknown }> : [];
    const resolved: SynthesisSource[] = [];
    for (const segment of segments) for (const citation of (Array.isArray(segment?.citations) ? segment.citations : []) as Array<Record<string, unknown>>) {
      try {
        const found = resolveCatalogCitation(citation, sources);
        const source = found && sources.find(candidate => candidate.sourceId === found.sourceId);
        if (source) resolved.push(source);
      } catch { /* The citation guard owns invalid identifiers. */ }
    }
    const reportSources = resolved.filter(source => source.reportScope);
    if (!reportSources.length) continue;
    const evidence = reportSources.filter(source => source.reportScope!.kind !== 'metadata');
    const citedMetadata = reportSources.filter(source => source.reportScope!.kind === 'metadata');
    const identities = [...new Set(evidence.map(source => reportIdentity(source.reportScope!)))];
    const grounded = evidence.length
      ? identities.every(identity => citedMetadata.some(source => reportIdentity(source.reportScope!) === identity))
      : citedMetadata.length > 0;
    if (!grounded) { missing.push(key); continue; }
    suggested = metadata.find(source => identities.includes(reportIdentity(source.reportScope!))) || citedMetadata[0] || suggested;
  }
  if (!missing.length) return null;
  return { code: 'incomplete_model_answer', feedback: JSON.stringify({ status: 'report_absence_unstated',
    protocol: reportAnswerGroundingProtocol, questions: missing,
    source: { title: suggested.title, citationIds: modelCitationCatalog(suggested).slice(0, 3).map(choice => choice.citationId) },
    instruction: '这是同轮唯一一次最终修复：上述问项引用了报告原文，却没有同时引用 source.citationIds 里的原报告周期与事实截止来源。本期报告没有已发布现场记录，必须在同一问项中用evidence引用该来源，直接写明“本期报告没有记录最近完成的施工内容”，再说明阶段标记与待核对项；不能把阶段标记或待核对项单独当成现场结果。其余问项保持原样，仍提交kind=report_answer及answers。' }) };
}

/** A report with no published record cannot answer “what was done” with an
 * action. Its completeness is structural: that question's segments name the
 * report period/cutoff from the report's own metadata, keep the recorded stage
 * and cover every published pending item. The reviewer still owns support and
 * condition preservation, and a draft omitting a pending item is still rejected. */
export function reportAbsentQuestionCompleteness(sources: SynthesisSource[], coverage: SourceQuestionCoverage,
  answers: Record<string, unknown>) {
  if (sources.some(source => source.reportScope?.kind === 'record')) return {};
  // The same report may appear as the persisted receipt and the current
  // projection. Require one cited source per report item identity, not every
  // duplicate copy, or a correctly grounded answer could never look complete.
  const pending = new Map<string, string[]>();
  for (const source of sources.filter(source => source.reportScope?.kind === 'published_pending')) {
    const scope = source.reportScope!;
    const key = reportIdentity(scope) + ':' + (scope.itemId ?? source.sourceId);
    pending.set(key, [...(pending.get(key) || []), source.sourceId]);
  }
  const stages = new Set(sources.filter(source => source.reportScope?.kind === 'stage').map(source => source.sourceId));
  const keys = coverage.questions.map((_, index) => 'Q' + (index + 1));
  const cited = new Map<string, Set<string>>();
  for (const key of keys) {
    const ids = new Set<string>();
    const segments = Array.isArray(answers[key]) ? answers[key] as Array<{ citations?: unknown }> : [];
    for (const segment of segments) for (const citation of (Array.isArray(segment?.citations) ? segment.citations : []) as Array<Record<string, unknown>>) {
      try { const resolved = resolveCatalogCitation(citation, sources); if (resolved) ids.add(resolved.sourceId); }
      catch { /* The citation guard owns invalid identifiers. */ }
    }
    cited.set(key, ids);
  }
  const complete: Record<string, true> = {};
  for (const key of keys) {
    const ids = cited.get(key) || new Set<string>();
    const period = [...ids].some(id => sources.find(source => source.sourceId === id)?.reportScope?.kind === 'metadata');
    const stage = !stages.size || [...stages].some(id => ids.has(id));
    const covered = ids.size > 1 && period && stage && [...pending.values()].every(group => group.some(id => ids.has(id)));
    if (covered) complete[key] = true;
  }
  return complete;
}

export function prepareReportAnswerReview(raw: string, sources: SynthesisSource[], context: SynthesisReviewContext, history: ModelMessage[] = [],
  plannedCoverage?: SourceQuestionCoverage) {
  if (!context.currentQuestion || !sources.some(source => source.reportScope?.protocol === reportAnswerGroundingProtocol)) fail('context_changed');
  const coverage = plannedCoverage ?? reportQuestionCoverage(context.currentQuestion);
  const answer = parseSynthesis(reportAnswerSynthesis(raw, coverage), sources, context);
  const answers = (JSON.parse(raw) as { answers: Record<string, unknown> }).answers;
  const draft = prepareSourceAnswerReview(raw, answer, sources, coverage, context, answers, history, reportAnswerGroundingProtocol, undefined, reportReviewGuidance);
  const completeQuestions = reportAbsentQuestionCompleteness(sources, coverage, answers);
  return Object.keys(completeQuestions).length ? { ...draft, completeQuestions } : draft;
}

export function assertReportAnswerReview(draft: KnowledgeExplanationDraft, output: Parameters<typeof acceptKnowledgeExplanation>[1], binding: string) {
  if (acceptKnowledgeExplanation(draft, output, binding, true)) fail('ungrounded_response_scope', 502);
}

/** A semantic review rejection still consumes the run's single bounded final
 * repair, exactly like a structural defect. The reviewer only names missing
 * facts; it never selects sources or writes the replacement answer. The reason
 * is capped so the repair fits the same fixed input envelope. */
export function reportSemanticRepair(issue: { code: string; feedback: string }) {
  const at = issue.feedback.indexOf('校验发现：');
  const reasons = at < 0 ? issue.feedback : issue.feedback.slice(at);
  return { code: issue.code, feedback: ('这是同轮唯一一次最终修复：报告回答的语义复核未通过。只修改最终回答，不调用查询、保存或其他业务工具，不新增来源或事实；保留本轮全部Q编号，仍提交kind=report_answer及answers。逐项补齐复核指出的阶段更新、待核对项和事实截止说明，保留已有正确引用。' + reasons).slice(0, 1200) };
}

/** Structural, reference and numeric defects are corrected by the model before
 * the semantic reviewer reads anything: the reviewer judges meaning, never a
 * mistyped identifier or an uncited date. A semantic rejection is not one of
 * these and stops the draft. */
export const reportRepairableFailureCodes = ['invalid_model_answer', 'invalid_model_citation', 'incomplete_model_answer',
  'unsupported_model_commitment'] as const;

/** One bounded redraft, only for a defect the ordinary guards can name exactly.
 * The runtime owns the single-repair budget; after it the repaired draft still
 * passes every guard and the mandatory semantic review, which never rewrites. */
export function reportAnswerValidationFailure(issue: { code: string; feedback: string }, grounded: boolean) {
  if (!grounded || (reportRepairableFailureCodes as readonly string[]).includes(issue.code)) return issue;
  fail(issue.code, 502);
}

/** The exact citation identifiers this turn's final tool accepts. The item
 * schema may carry an anyOf branch per basis, so collect every citationId enum
 * from the same definition instead of assuming one nesting shape. */
export function reportCitationIds(tool: ModelTool) {
  const ids = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'citationId' && child && typeof child === 'object') {
        const list = (child as { enum?: unknown }).enum;
        if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') ids.add(id);
      }
      walk(child);
    }
  };
  walk(tool.parameters);
  return [...ids];
}

/** A citation identifier copied with a wrong character is a reference defect,
 * not new evidence. It is repairable only when the rest of the envelope is
 * already schema-valid, so a structurally broken answer still fails as before. */
export async function reportCitationOnlySchemaFailure(raw: string, tool: ModelTool) {
  const ids = reportCitationIds(tool);
  if (!ids.length) return false;
  const cited = [...raw.matchAll(/"citationId"\s*:\s*"([^"]*)"/g)].map(match => match[1]);
  if (!cited.some(id => !ids.includes(id))) return false;
  const repaired = raw.replace(/"citationId"\s*:\s*"([^"]*)"/g, `"citationId":"${ids[0]}"`);
  return (await toolSchemaIssue(tool, repaired)) === null;
}

/** Name the exact question/segment whose numbers lack that segment's own
 * quote. The guard stays authoritative; this only phrases the bounded repair
 * so the model does not repeat an uncited date or clock time. */
export function reportNumericFailure(raw: string, sources: SynthesisSource[]) {
  let answers: Record<string, unknown>;
  try { answers = (JSON.parse(raw) as { answers?: Record<string, unknown> }).answers || {}; } catch { return null; }
  const gaps: Array<{ question: string; position: number; numbers: string[] }> = [];
  for (const [question, segments] of Object.entries(answers)) {
    if (!Array.isArray(segments)) continue;
    segments.forEach((value, index) => {
      const segment = value as { text?: unknown; citations?: unknown };
      if (typeof segment?.text !== 'string' || !Array.isArray(segment.citations)) return;
      const quoted: string[] = [];
      for (const citation of segment.citations) {
        try {
          const resolved = resolveCatalogCitation(citation as Record<string, unknown>, sources);
          if (resolved) quoted.push(resolved.quote);
        } catch { /* The citation guard owns invalid references. */ }
      }
      const supported = new Set(groundedNumberTokens(quoted.join('\n')));
      const missing = [...new Set(groundedNumberTokens(segment.text))].filter(number => !printedNumberSupported(number, supported));
      if (missing.length) gaps.push({ question, position: index + 1, numbers: missing });
    });
  }
  if (!gaps.length) return null;
  return { code: 'unsupported_model_commitment', feedback: JSON.stringify({ status: 'report_numeric_rejected',
    protocol: reportAnswerGroundingProtocol, gaps,
    instruction: '这是同轮唯一一次最终修复：上述段落的数字/日期/时刻没有本段引用支持。优先把含这些数字的句子移到已经引用对应来源的段落并保留该引用；或在该段删除这些数字、改用“随后/最后”等相对表述；也可补选真正包含这些数字的citationId（每段最多四条）。不能借用其他段的引用，也不能改写成没有来源的新数量；不要原样重复被拒稿。其余正文保持原样，仍提交kind=report_answer及answers。' }) };
}

/** Citation identifiers belong in the structured citations array, never in the
 * customer prose. An inline "[C…]" marker is a structural defect the one repair
 * can name exactly; otherwise its digits also trip the numeric guard. */
export function reportInlineCitationFailure(raw: string) {
  let answers: Record<string, unknown>;
  try { answers = (JSON.parse(raw) as { answers?: Record<string, unknown> }).answers || {}; } catch { return null; }
  const inline: Array<{ question: string; position: number; markers: string[] }> = [];
  for (const [question, segments] of Object.entries(answers)) {
    if (!Array.isArray(segments)) continue;
    segments.forEach((value, index) => {
      const text = (value as { text?: unknown } | null)?.text;
      if (typeof text !== 'string') return;
      const markers = [...new Set(text.match(/\[C[A-Za-z0-9_-]{6,}\]/g) || [])];
      if (markers.length) inline.push({ question, position: index + 1, markers });
    });
  }
  if (!inline.length) return null;
  return { code: 'invalid_model_answer', feedback: JSON.stringify({ status: 'report_inline_citation_rejected',
    protocol: reportAnswerGroundingProtocol, inline,
    instruction: '正文中不要写citationId或任何“[C…]”引用标记；引用只能放在每段的citations数组。删除正文中的标记并保留对应citations，其余正文与引用保持原样，仍提交kind=report_answer及answers，不调用查询或保存工具。' }) };
}

/** Name segments that exceed the per-segment citation bound. The same report
 * original can legitimately need metadata plus every stage update, but a model
 * that packs them into one segment misses the native schema and otherwise gets
 * a generic repair. The fix stays structural: split the answer or keep only the
 * citations that support that segment. */
export function reportCitationCountFailure(raw: string) {
  let answers: Record<string, unknown>;
  try { answers = (JSON.parse(raw) as { answers?: Record<string, unknown> }).answers || {}; } catch { return null; }
  const over: Array<{ question: string; position: number; citations: number }> = [];
  for (const [question, segments] of Object.entries(answers)) {
    if (!Array.isArray(segments)) continue;
    segments.forEach((value, index) => {
      const citations = (value as { citations?: unknown[] } | null)?.citations;
      const count = Array.isArray(citations) ? citations.length : 0;
      if (count > 4) over.push({ question, position: index + 1, citations: count });
    });
  }
  if (!over.length) return null;
  return { code: 'invalid_model_answer', feedback: JSON.stringify({ status: 'report_citation_count_rejected',
    protocol: reportAnswerGroundingProtocol, over,
    instruction: '这是同轮唯一一次最终修复：上述段落的引用超过每段四条。把同一问项拆成多个非空段落，或只保留真正支持该段的最小引用（每段最多四条），不得删除有据的阶段更新或待核对项；其余正文与引用保持原样，仍提交kind=report_answer及answers，不调用查询或保存工具。' }) };
}

/** Name every rejected identifier and restate the exact authorized options.
 * This feeds the one repair; it never selects, rewrites or adds a citation and
 * never turns an unknown string into an accepted source. */
export function reportCitationFailure(raw: string, sources: SynthesisSource[]) {
  const catalog = sources.map(source => ({ title: source.title, options: modelCitationCatalog(source) }))
    .filter(source => source.options.length);
  const valid = new Set(catalog.flatMap(source => source.options.map(option => option.citationId)));
  const invalid = [...new Set([...raw.matchAll(/"citationId"\s*:\s*"([^"]*)"/g)].map(match => match[1])
    .filter(id => !valid.has(id)))];
  if (!invalid.length) return null;
  return { code: 'invalid_model_citation', feedback: JSON.stringify({ status: 'report_citation_rejected',
    protocol: reportAnswerGroundingProtocol, invalidCitationIds: invalid,
    citationOptions: catalog.slice(0, 8).map(source => ({ title: source.title, options: source.options })),
    instruction: '这是同轮唯一一次最终修复：只把每个无效citationId替换为下面某个来源的完整citationId，正文其他内容保持原样，不新增来源、事实或业务调用，仍提交kind=report_answer及answers。引用必须支持本段对象、条件与时间；没有对应来源时删除该引用或该无据主张。' }) };
}
