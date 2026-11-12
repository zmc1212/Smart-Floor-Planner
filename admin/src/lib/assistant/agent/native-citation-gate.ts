import { ragAnswerParts, type RagCitationSource, type RagPart } from '../fastgpt/native-rag';

/** The catalog mixes three kinds of ids: conversation history that stays
 * citable, this run's fresh retrievals, and this run's recovered retrievals.
 * Only the last two satisfy this run's citation requirement; history alone
 * must never masquerade as fresh evidence. Legacy entries persisted without an
 * `origin` are conversation history, not this run's sources. */
function classifyNativeMarkers(draft: string, sources: RagCitationSource[]) {
  const byId = new Map(sources.map(source => [source.nativeId, source]));
  const history = new Set<string>(), run = new Set<string>(), invalid = new Set<string>();
  for (const match of draft.matchAll(/\[([^\]]+)\]\(CITE\)/g)) {
    const citation = match[1].trim(), source = byId.get(citation);
    if (!source) invalid.add(citation);
    else if (source.origin === 'current' || source.origin === 'recovered') run.add(citation);
    else history.add(citation);
  }
  return { history: [...history], run: [...run], invalid: [...invalid] };
}

/** The marker ids actually used by the draft, split by catalog origin. */
export function scanNativeCitationMarkers(draft: string, catalog: Iterable<RagCitationSource>) {
  const { history, run, invalid } = classifyNativeMarkers(draft, [...catalog]);
  return { valid: [...history, ...run], invalid };
}

export type NativeCitationAssessment = {
  /** Cited ids that only exist in conversation history (or legacy no-origin). */
  validHistory: string[];
  /** Cited ids this run returned as current or recovered sources. */
  validRun: string[];
  /** Cited ids the catalog never issued. */
  invalid: string[];
  /** Unique current/recovered ids actually cited by this draft. */
  runCitations: number;
  /** Current/recovered sources the catalog holds for this run. */
  runSources: number;
  /** This run handed a knowledge or web original to the model. It is distinct
   * from `runSources`: a long web original without a complete citable clause
   * reaches the model while the catalog stays empty. */
  runEvidence: boolean;
  /** Parsed parts; absent while invalid ids exist (they must stay visible). */
  parts?: RagPart[];
};

/** One shared assessment of a final draft against the run's catalog. Invalid
 * ids are reported, never swallowed; a clean draft is parsed exactly like the
 * persisted answer path so validation and delivery judge the same text. */
export function assessNativeCitations(draft: string, catalog: Iterable<RagCitationSource>,
  runEvidence = false): NativeCitationAssessment {
  const sources = [...catalog];
  const { history, run, invalid } = classifyNativeMarkers(draft, sources);
  const runSources = sources.filter(source => source.origin === 'current' || source.origin === 'recovered').length;
  const assessment: NativeCitationAssessment = {
    validHistory: history, validRun: run, invalid, runCitations: run.length, runSources, runEvidence,
  };
  return invalid.length ? assessment : { ...assessment, parts: ragAnswerParts(draft, sources) };
}

/** One-shot repair guidance for a draft that failed citation validation. A
 * business resultKey / snapshot version hash is never a citation id: it is
 * reported as invalid and never accepted or auto-replaced. When this run did
 * return knowledge or web sources, deleting every marker is explicitly not an
 * acceptable repair; when nothing was retrieved, removing them is the only
 * honest answer. Validation itself stays strict and fail-closed. */
export function nativeCitationFeedback(draft: string, catalog: Iterable<RagCitationSource>) {
  const sources = [...catalog];
  const runSources = sources.filter(source => source.origin === 'current' || source.origin === 'recovered');
  const { valid, invalid } = scanNativeCitationMarkers(draft, sources);
  const invalidText = invalid.join('、');
  if (valid.length) {
    return `最终回答未通过引用校验：已合法引用的 id（${valid.join('、')}）必须保留；${invalidText} 不是本轮任何工具返回的 cites[].id，业务 resultKey、版本号或内部 hash 不是引用 id。请删除或改正这些非法标记，不得自动替换或改写合法 id。请重新提交最终回答；无法核实的部分如实说明。`;
  }
  if (runSources.length) {
    return `最终回答未通过引用校验：本轮工具已返回可引用来源，但草稿没有有效引用。`
      + (invalidText ? `${invalidText} 不是引用 id（业务 resultKey、版本号或内部 hash 不是引用 id）；` : '')
      + '必须用本轮工具返回的 cites[].id 中真实有效的 id 引用对应内容，不得删除全部 CITE 标记来绕过引用要求。请重新提交最终回答；无法核实的部分如实说明。';
  }
  return '最终回答未通过引用校验：本轮工具没有返回任何可引用来源（cites 为空），回答中不得出现任何 CITE 引用标记或占位符；业务 resultKey、版本号或内部 hash 不是引用 id。请删除全部 CITE 标记后重新提交；无法核实的内容如实说明。';
}

/** The missing-citation repair that the first draft alone cannot trigger today:
 * this run returned knowledge or web sources but the draft cites none of them.
 * History ids are named as insufficient instead of being silently counted, and
 * the guidance never shows a copyable placeholder marker. */
export function nativeMissingRunCitationFeedback(draft: string, catalog: Iterable<RagCitationSource>) {
  const sources = [...catalog];
  const { history } = classifyNativeMarkers(draft, sources);
  const available = sources.filter(source => source.origin === 'current' || source.origin === 'recovered')
    .map(source => source.nativeId);
  const listed = available.slice(0, 4).join('、') + (available.length > 4 ? ' 等' : '');
  if (history.length) {
    return `最终回答未通过引用校验：${history.join('、')} 是历史对话里的引用，不能代替本轮检索来源。`
      + `本轮工具已返回可引用来源（${listed}），必须用本轮工具返回的 cites[].id 标记所引内容，不得只保留历史 id，也不得删除全部 CITE 标记来绕过引用要求。请重新提交最终回答；无法核实的部分如实说明。`;
  }
  return `最终回答未通过引用校验：本轮工具已返回可引用来源（${listed}），但草稿没有任何引用。`
    + '必须用本轮工具返回的 cites[].id 标记所引内容；历史引用 id、业务 resultKey、版本号或内部 hash 都不是本轮引用 id。请重新提交最终回答；无法核实的部分如实说明。';
}

export type NativeCitationIssue = { code: 'invalid_model_citation' | 'missing_citation'; feedback: string };

/** The single gate shared by the graph's validate node and final delivery.
 * Invalid ids are always fail-closed. A draft that ignores this run's sources
 * gets at most one repair (the graph's existing one-shot turn); once that
 * repair was issued the gate stays silent so delivery applies its own rule
 * (snapshot-only or missing_citation) instead of failing without a fallback.
 * Evidence without any issued id never earns a repair: there is no real id the
 * model could cite, so delivery alone rejects or downgrades that draft. */
export function nativeCitationGate(draft: string, catalog: Iterable<RagCitationSource>,
  repairIssued: boolean, runEvidence = false): { assessment: NativeCitationAssessment; issue: NativeCitationIssue | null } {
  const sources = [...catalog];
  const assessment = assessNativeCitations(draft, sources, runEvidence);
  if (assessment.invalid.length)
    return { assessment, issue: { code: 'invalid_model_citation', feedback: nativeCitationFeedback(draft, sources) } };
  if (!repairIssued && assessment.runSources > 0 && assessment.runCitations === 0)
    return { assessment, issue: { code: 'missing_citation', feedback: nativeMissingRunCitationFeedback(draft, sources) } };
  return { assessment, issue: null };
}
