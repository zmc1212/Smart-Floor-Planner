import type { SynthesisAnswer, SynthesisSource } from './synthesis';
import { resolveCatalogCitation, sourceCitationCatalog } from './citation-catalog';
import { originalAnswerOnly, independentAdviceRequested } from './read-tool-input';

export type ResponseReviewIssue = { segment: number; code: 'unscoped_measurement_gap' | 'repeated_known_need' | 'internal_wording'
  | 'reopened_unavailable_need' | 'unsolicited_unknown_plan' | 'unsupported_work_absence' | 'unscoped_work_readiness' | 'misattributed_shared_need'
  | 'misattributed_project_quantity' | 'misattributed_project_observation' | 'unsupported_evidence_mechanism'
  | 'contradictory_measurement_comparison' | 'unmeasured_compliance_claim' | 'misattributed_rule_comparison' | 'misattributed_project_status'
  | 'source_answer_scope' | 'independent_advice_scope' | 'unsupported_source_condition' | 'misattributed_project_room' };
export type SynthesisReviewContext = { currentQuestion?: string; currentOriginal?: { messageId: string; hash: string };
  /** Bound only by the knowledge-off ordinary-dialogue run policy. Uncited
   * advice is model knowledge, not an assertion from an enterprise/site source. */
  generalKnowledge?: boolean;
  enterpriseKnowledgeAuthority?: boolean;
  /** Server-owned stage label after currentReportStageEvent authorization.
   * Historical reports and ordinary chat must not bind this current fact. */
  currentProjectStage?: string;
  /** Server-owned source-answer context, never supplied by a client. Legacy
   * explanation runs additionally require their durable semantic proof;
   * explicitly bound source-boundary runs use the strict original parser. */
  specialistAcceptance?: boolean;
  /** Current room of a room-scoped specialist run. Project originals from any
   * other room cannot support this answer, even when the source is still valid. */
  currentRoom?: string;
  knowledgeExplanation?: 'reviewed-knowledge-explanation-v1' | 'natural-knowledge-answer-v1';
  currentNeeds?: { version: number; facts: Array<{ sourceMessageId: string; sourceHash: string; quote: string; value: string }> } };

function quantityTokens(text: string) {
  const units: Record<string, string> = { '毫米': 'mm', '㎜': 'mm', '厘米': 'cm', '公分': 'cm', '米': 'm' };
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m\b|毫米|㎜|厘米|公分|米|万元|元|小时|分钟|秒|天|%)/giu)]
    .map(match => match[1] + ':' + (units[match[2]] || match[2].toLowerCase()));
}

type Citations = SynthesisAnswer['segments'][number]['citations'];
function actualProjectCitations(citations: Citations, sources: SynthesisSource[]) {
  return citations.filter(citation => sources.some(source => source.sourceId === citation.sourceId
    && source.kind === 'project' && !source.material?.need && source.material?.ref.type !== 'formal_plan'));
}

/** A selected record excerpt, rather than the query's unrelated missing-material
 * list or a current-state excerpt from the same aggregate source. */
function actualRecordCitations(citations: Citations, sources: SynthesisSource[]) {
  return actualProjectCitations(citations, sources).filter(citation => sources.some(source => source.sourceId === citation.sourceId
    && (source.material?.ref.type === 'site_record' || !source.material && !source.followup
      && /现场记录|施工部位[:：]|本次完成[:：]|尚未完成[:：]/u.test(citation.quote))));
}

/** A room-scoped run cannot borrow another room's record. The room is owned by
 * the specialist binding, never parsed from the customer's question here. */
function crossRoomCitations(citations: Citations, sources: SynthesisSource[], currentRoom?: string) {
  if (!currentRoom) return false;
  return citations.some(citation => sources.some(source => source.sourceId === citation.sourceId
    && source.kind === 'project' && typeof source.material?.roomName === 'string'
    && !!source.material.roomName && source.material.roomName !== currentRoom));
}

function nonassertive(clause: string) {
  return /如果|假如|假设|是否|能否|无法|不能|不足以|尚不能|示例|例如|譬如|(?:不足|不够|不符合|不达标)时/u.test(clause);
}

/** Original-only explanations may preserve a cited business condition, never
 * add one under advice/uncertainty or borrow an unrelated real citation. Only
 * explicit obligation/condition language is checked; this is not an arbitrary
 * passage entailment score. Preserve exact relation wording for such claims. */
function unsupportedSourceCondition(text: string, citations: Citations, sources: SynthesisSource[]) {
  const normalize = (value: string) => value.replace(/[\s\p{P}]/gu, '');
  const originals = citations.filter(c => sources.some(s => s.sourceId === c.sourceId && s.kind === 'knowledge')).map(c => normalize(c.quote));
  return text.split(/[。！？!?；;\n]/u).some(sentence => {
    const claim = sentence.trim().replace(/^(?:根据)?(?:原文|文件|手册|该段|说明)(?:中)?(?:规定|要求|写明|明确)?[：:]/u, '');
    // A statement that the original does not specify a condition is a gap,
    // not a new positive requirement. Later clauses still get their own check.
    return claim.split(/[，,]|但是|不过|然而|但|并(?=要求|必须|需|须|应当|依赖)/u).some(clause => {
      if (/^(?:(?:本次|本轮|这次)(?:可用)?)?(?:原文|文件|该段|资料)(?:中)?(?:未|没有)(?:说明|写明|规定|给出|明确)/u.test(clause.trim())) return false;
      if (!/必须|需(?!求)|须|应当|依赖|前提|只有|才能|要求|建议|最好|不妨|以[^。；\n]{1,32}为准/u.test(clause)) return false;
      const normalized = normalize(clause);
      return !originals.some(original => original.includes(normalized));
    });
  });
}

/** A prescription cannot stand in for an explicitly attributed observation,
 * including an observation with no digits. Missing query data is not a claim
 * about the site. This check does not infer observations from the question. */
function unsupportedProjectObservation(text: string, citations: Citations, sources: SynthesisSource[]) {
  const projects = actualRecordCitations(citations, sources);
  const hasTypedSiteRecord = sources.some(source =>
    source.material?.ref.type === 'site_record' && typeof source.material.siteCompleted === 'string');
  const siteCompletions = projects.flatMap(citation => {
    const material = sources.find(source => source.sourceId === citation.sourceId)?.material;
    return material?.ref.type === 'site_record' && typeof material.siteCompleted === 'string'
      ? [{ quote: citation.quote, completed: material.siteCompleted }] : [];
  });
  return text.split(/[，,。！？!?；;\n]/u).some(clause => {
    // A whole-record citation can contain the requested action without proving
    // it happened. Use the published completion field, including for multiline excerpts.
    const marking = hasTypedSiteRecord && /现场.{0,10}?(?:已(?:经)?标记|标记了)/u.exec(clause);
    if (marking) {
      const claim = clause.slice(0, marking.index + marking[0].length);
      if (!nonassertive(claim) && !/不一定|尚待|尚未|并未|没有|未能/u.test(claim)
        && !siteCompletions.some(({ quote, completed }) => quote.includes('标记') && completed.includes('标记')
          && (quote.includes(completed) || completed.includes(quote)))) return true;
    }
    if (nonassertive(clause)) return false;
    const marker = /(?:现场(?:记录|观察|看到)|记录(?:本身)?(?:也|只)?(?:注明|看到|写的是|写明|显示)|(?:这条|该条|本次|当前)(?:现场)?记录(?:写|显示|中|里))/u.exec(clause);
    if (!marker) return false;
    const predicate = clause.slice(marker.index + marker[0].length);
    // “Comparing the reference with a published record” describes provenance,
    // not an observed site fact. Metadata preceding the marker is irrelevant.
    if (!/注明|看到|写的是|写明|显示/u.test(marker[0])
      && !/看到|写的是|写明|显示|只写了|只写到|未量测|未测量|已布置|已涂刷|已完成|未完成|同槽|共用|包裹|实测/u.test(predicate)) return false;
    const terms = predicate.match(/同槽|共用线盒|包裹|未量测|未测量|布置|涂刷|抽测|高度/gu) || [];
    return !projects.length || terms.some(term => !projects.some(citation => citation.quote.includes(term)));
  });
}

/** Only the observed construction-record fields, not arbitrary semantic
 * entailment. A needs/drawing gap says nothing about trial or curing records. */
function unsupportedRecordGap(segment: SynthesisAnswer['segments'][number], citations: Citations, sources: SynthesisSource[]) {
  const onlyAnswerInputs = segment.basis === 'uncertainty' && !citations.length && !sources.some(source => source.kind === 'project');
  // With no project source consulted, a statement about what the assistant
  // has in hand is an input limitation. It is not a finding from a site query.
  const receivedNothing = /^(?:本轮|本次|这次|此次|我(?:这边|手头)(?:目前|当前)?|我(?:目前|当前))(?:\s*我(?:这边|手头)?)?\s*(?:没有|尚无|未(?:收到|取得|获得|拿到))/u;
  const claimsRecordContent = /(?:查到|查过|查阅|查遍|查询|显示|记录里|记录中|未记录|未提供|从未|不存在|没有做)/u;
  return segment.text.split(/[。！？!?；;\n]/u).some(sentence => {
    if (!/本次|本轮|这次|当前|目前|现场|记录/u.test(sentence) || !sentence.split(/[，,]/u).some(clause => {
      if (onlyAnswerInputs && receivedNothing.test(clause.trim()) && !claimsRecordContent.test(clause)) return false;
      const field = /保养|蓄水|楼下(?:检查|查看)|(?:施工|涂刷|防水)(?:完成)?(?:的)?(?:具体)?(?:时间|时刻)|验收(?:结论|结果)/u.exec(clause);
      if (!field || !/没有|未(?:提供|记录|核实|确认)|缺少|缺失/u.test(clause) || /有没有|(?:是否|能否)(?:有|没有|未|缺)/u.test(clause)) return false;
      // A question-valued field such as “保养是否满足要求” may itself be
      // unavailable. Do not erase that absence assertion because 是否 occurs
      // inside its object; only a preceding hypothesis/denial scopes the claim.
      const prefix = clause.slice(0, field.index);
      if (nonassertive(prefix)) return false;
      return !/手册|规范|条款/u.test(prefix) || /现场|记录|(?:本次|本轮|这次)(?:授权)?(?:查询|资料)/u.test(prefix);
    })) return false;
    const records = actualRecordCitations(citations, sources);
    const rooms = [...new Set(sources.map(source => source.material?.roomName).filter((room): room is string => !!room))]
      .filter(room => sentence.includes(room));
    return !records.some(citation => !rooms.length || rooms.some(room => citation.quote.includes(room)
      || sources.some(source => source.sourceId === citation.sourceId && source.material?.roomName === room)));
  });
}

type ProjectStatusClaim = { field: 'stage' | 'phone'; value: string };
/** Only explicit current-stage/phone statements observed in the preserved
 * replies. Source access and current-version checks remain with the adapters. */
function projectStatusClaims(text: string, stageValues: string[] = []): ProjectStatusClaim[] {
  return text.split(/[，,。！？!?；;\n]/u).flatMap(clause => {
    const conditional = (index: number) => /如果|假如|假设|示例|例如|无法确认|不能确认/u.test(clause.slice(0, index));
    const claims: ProjectStatusClaim[] = [];
    for (const match of clause.matchAll(/(?:当前(?:项目|团队)?(?:标记的)?|(?:团队|项目)(?:当前)?(?:标记的)?)(?:的)?(?:施工)?(?:节点|阶段)(?:登记为|标为|显示在|是(?!否)|为|[:：])\s*([\p{Script=Han}]{2,16})/gu)) {
      const value = match[1].replace(/(?:施工)?阶段$/u, '');
      if (conditional(match.index!) || /^(?:什么|哪|阶段标记|状态标签)/u.test(match[1]) || /吗$/u.test(value)) continue;
      claims.push({ field: 'stage', value });
    }
    // Match an actual returned field value after an explicit current-stage
    // subject, independently of the model's choice of linking verb. This is
    // still a bounded field check, not a general semantic judge.
    for (const match of clause.matchAll(/(?:当前(?:项目|团队)?|(?:团队|项目)(?:当前)?)(?:的)?(?:施工)?(?:节点|阶段)/gu)) {
      const predicate = clause.slice(match.index! + match[0].length);
      if (conditional(match.index!) || /是否|能否|哪|什么|不是|并非|不在|尚未进入/u.test(predicate)) continue;
      for (const value of stageValues) {
        const offset = predicate.indexOf(value);
        if (offset < 0 || offset > 24 || !/^(?:阶段)?(?:\s|$)/u.test(predicate.slice(offset + value.length))) continue;
        claims.push({ field: 'stage', value });
      }
    }
    for (const match of clause.matchAll(/阶段(?:的)?(?:联系)?电话(?:入口)?(?:也|还|尚|仍|暂)*(未配置|未提供|已配置|已提供)/gu)) {
      if (conditional(match.index!) || clause.slice(match.index! + match[0].length).startsWith('时')) continue;
      claims.push({ field: 'phone', value: match[1].startsWith('未') ? 'unconfigured' : 'configured' });
    }
    return claims;
  });
}

function unsupportedProjectStatus(text: string, citations: Citations, sources: SynthesisSource[], currentStage?: string) {
  const quoted = [...actualProjectCitations(citations, sources).flatMap(citation => projectStatusClaims(citation.quote)),
    ...(currentStage ? projectStatusClaims('当前阶段为' + currentStage).filter(claim => claim.field === 'stage') : [])];
  const values = [...new Set(sources.filter(source => source.kind === 'project' && !source.material && !source.followup)
    .flatMap(source => projectStatusClaims(source.text)).filter(claim => claim.field === 'stage').map(claim => claim.value))];
  return projectStatusClaims(text, values).some(claim => !quoted.some(original => original.field === claim.field && original.value === claim.value));
}

/** Candidate IDs only, never a repaired selection or new source. Full original
 * snapshots stay in the model input; distinct catalog excerpts stay distinct. */
export function synthesisStatusCitationCandidates(sources: SynthesisSource[]) {
  return sources.filter(source => source.kind === 'project' && !source.material && !source.followup)
    .flatMap(source => sourceCitationCatalog(source).flatMap(citation => {
      const states = projectStatusClaims(citation.quote);
      return states.length ? [{ citationId: citation.citationId, states, candidateOnly: true }] : [];
    })).slice(0, 2);
}

/** Only the observed mechanism vocabulary is checked. This is not entailment
 * scoring: prescriptions may explain their own mechanisms, while uncited
 * general explanations must retain advice status. */
function unsupportedEvidenceMechanism(text: string, citations: Citations) {
  const quoted = citations.map(citation => citation.quote).join('\n');
  return text.split(/[。！？!?；;\n]/u).some(sentence => /风险|会|容易|导致|造成|影响|问题在于|防止|避免|意味着|就|使/u.test(sentence)
    && [...sentence.matchAll(/干扰|检修|返工|渗漏|开裂|脱落|触电|短路|耐久|寿命|代价/gu)].some(match => !quoted.includes(match[0])));
}

function metricMatches(text: string, metric: string) {
  const normalized = text.replace(/[^\p{Script=Han}]/gu, '').replace(/(?:应当|必须|应|须)$/u, '');
  if (normalized.endsWith(metric)) return true;
  // An explicit metric such as “平行间距” may be written “平行布置，间距”.
  // Require both halves in order near the predicate, never match digits alone.
  const head = metric.slice(0, 2), tail = metric.slice(2);
  const index = normalized.lastIndexOf(head);
  return metric.length === 4 && normalized.endsWith(tail) && index >= 0
    && normalized.length - index - metric.length <= 12;
}

function mentionsMetric(clause: string, metric: string) {
  return metric.length === 4 ? clause.includes(metric.slice(0, 2)) && clause.includes(metric.slice(2)) : clause.includes(metric);
}

const constraintPattern = /([\p{Script=Han}，,、\s]{2,80}?)(不得小于|不得大于|不小于|不低于|不少于|不大于|不高于|不多于|不超过|至少|至多|大于|小于)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m\b|毫米|厘米|公分|米|小时|分钟|秒|天)/giu;
const observationPattern = /([\p{Script=Han}]{2,24})\s*(\d+(?:\.\d+)?)\s*(mm|cm|m\b|毫米|厘米|公分|米|小时|分钟|秒|天)/giu;
function compareDecimals(left: string, right: string) {
  const [li, lf = ''] = left.split('.'), [ri, rf = ''] = right.split('.'), scale = Math.max(lf.length, rf.length);
  const l = BigInt(li + lf.padEnd(scale, '0')), r = BigInt(ri + rf.padEnd(scale, '0'));
  return l < r ? -1 : l > r ? 1 : 0;
}

/** Reuse the validator's exact quoted pairs for repair data. No new value,
 * conversion, authority or engineering acceptance is produced. */
function quotedComparisons(citations: Citations, sources: SynthesisSource[]) {
  const constraints = citations.filter(c => sources.some(s => s.sourceId === c.sourceId && s.kind === 'knowledge'))
    .flatMap(citation => [...citation.quote.matchAll(constraintPattern)].map(match => ({ citation, match })));
  return actualProjectCitations(citations, sources).flatMap(project => [...project.quote.matchAll(observationPattern)].flatMap(observation => {
    const metric = observation[1].slice(-4), unit = quantityTokens(observation[2] + observation[3])[0]?.split(':')[1];
    const matched = constraints.filter(({ match }) => metricMatches(match[1], metric)
      && quantityTokens(match[3] + match[4])[0]?.split(':')[1] === unit);
    const distinct = [...new Map(matched.map(item => [item.match[2] + ':' + item.match[3], item])).values()];
    if (distinct.length !== 1) return [];
    const { citation: rule, match } = distinct[0], order = compareDecimals(observation[2], match[3]);
    const lower = ['不得小于', '不小于', '不低于', '不少于', '至少', '大于'].includes(match[2]);
    const strict = ['大于', '小于'].includes(match[2]);
    const meetsTextualBound = lower ? strict ? order > 0 : order >= 0 : strict ? order < 0 : order <= 0;
    const relation = lower ? order < 0 ? 'below_minimum' : order > 0 ? 'above_minimum' : strict ? 'at_excluded_minimum' : 'at_minimum'
      : order > 0 ? 'above_maximum' : order < 0 ? 'below_maximum' : strict ? 'at_excluded_maximum' : 'at_maximum';
    return [{ metric, unit, observed: observation[2], projectSourceId: project.sourceId, operator: match[2], threshold: match[3],
      ruleSourceId: rule.sourceId, relation, meetsTextualBound }];
  }));
}

function unmeasuredMetrics(citations: Citations, sources: SynthesisSource[]) {
  return actualProjectCitations(citations, sources).flatMap(citation =>
    [...citation.quote.matchAll(/([\p{Script=Han}]{2,24})(?:未量测|未测量|尚待实测)/gu)]
      .map(match => ({ metric: match[1], projectSourceId: citation.sourceId })));
}

export function synthesisComparisonRepairData(answer: SynthesisAnswer, sources: SynthesisSource[], issues?: ResponseReviewIssue[]) {
  const relevant = issues && new Set(issues.filter(issue => ['contradictory_measurement_comparison', 'unmeasured_compliance_claim',
    'misattributed_rule_comparison', 'misattributed_project_quantity'].includes(issue.code)).map(issue => issue.segment - 1));
  const comparisons = new Map<string, ReturnType<typeof quotedComparisons>[number]>();
  const unmeasured = new Map<string, ReturnType<typeof unmeasuredMetrics>[number]>();
  const paths: string[] = [];
  answer.segments.forEach((segment, index) => {
    if (relevant && !relevant.has(index)) return;
    const citations = segment.citations.map(c => resolveCatalogCitation(c as unknown as Record<string, unknown>, sources) || c);
    const pairs = quotedComparisons(citations, sources).slice(0, 4), unknown = unmeasuredMetrics(citations, sources).slice(0, 4);
    if (pairs.length || unknown.length) paths.push(`segments[${index}].text`);
    for (const pair of pairs) comparisons.set(JSON.stringify(pair), pair);
    for (const item of unknown) unmeasured.set(JSON.stringify(item), item);
  });
  return paths.length ? [{ paths, comparisons: [...comparisons.values()], unmeasured: [...unmeasured.values()],
    scope: 'quoted_values_only_not_project_acceptance' }] : [];
}

function unsupportedRuleComparison(text: string, citations: Citations, sources: SynthesisSource[]) {
  if (!/现场|记录|抽测|实测/u.test(text)) return false;
  const claims = text.split(/[，,。！？!?；;\n]/u).filter(clause => !nonassertive(clause) && /手册|规范|条款/u.test(clause));
  const knowledge = citations.filter(c => sources.some(s => s.sourceId === c.sourceId && s.kind === 'knowledge'));
  return claims.some(clause => /低于|高于|下限|上限/u.test(clause)
    ? !knowledge.some(c => [...c.quote.matchAll(constraintPattern)].length)
    : /不符|要求之外|有差距|有偏差|不一致|相抵触/u.test(clause) && !knowledge.some(c => /不得|严禁|须|应/u.test(c.quote)));
}

/** Bounded, same-unit, explicitly named measurement comparisons. No unit
 * conversion, derived quantity, project acceptance or general semantic judge.
 * Ambiguous/different metrics are left to source-scoped model regression. */
function projectAssessmentIssues(text: string, basis: SynthesisAnswer['segments'][number]['basis'], citations: Citations, sources: SynthesisSource[]) {
  const issues = new Set<'contradictory_measurement_comparison' | 'unmeasured_compliance_claim'>();
  const comparisons = quotedComparisons(citations, sources), unknown = unmeasuredMetrics(citations, sources);
  for (const sentence of text.split(/[。！？!?\n]/u)) {
    const genericRisk = basis === 'advice' && /从一般原理看|一般风险|从一般施工经验看|通用机理/u.test(sentence);
    for (const group of sentence.split(/[；;]/u)) for (const clause of group.split(/[，,]/u)) {
      if (nonassertive(clause)) continue;
      const verdict = /不达标|不符合|不满足|不相符|不一致|不符|不够|不足|没形成有效屏蔽|无效|达标|符合|满足|足够|够(?:的|了)|要求之外/u.exec(clause);
      if (!verdict) continue;
      // A generic conditional risk is not an assertion that this site's unknown
      // length is insufficient. Keep actual findings (including adjacent clauses)
      // and all definite compliance/effectiveness conclusions under the guard.
      if (genericRisk && /^(?:不足|不够)$/u.test(verdict[0]) && /会|可能|风险|容易|削弱|则/u.test(group)
        && !/现场|记录|本次|当前|此处|该处|这里|这处|这段|只(?:包|有)|抽测|实测/u.test(group)) continue;
      if (unknown.some(({ metric }) => {
        const terms = metric.match(/.{1,2}/gu) || [];
        const inScope = (part: string) => terms.filter(term => part.includes(term)).length >= Math.min(2, terms.length);
        return inScope(clause) || /都|全部|均/u.test(clause) && inScope(text)
          || /没形成有效屏蔽|无效/u.test(verdict[0]) && inScope(sentence);
      })) issues.add('unmeasured_compliance_claim');
      for (const comparison of comparisons) {
        if (!mentionsMetric(clause, comparison.metric)) continue;
        const negative = verdict[0].startsWith('不') || verdict[0] === '要求之外';
        if (comparison.meetsTextualBound === negative) issues.add('contradictory_measurement_comparison');
      }
    }
  }
  return issues;
}

/** A narrow source-role check for explicit site measurements/comparisons.
 * Equal digits in a rule are not a site observation. This is not a general
 * semantic judge and never infers actual conditions from the question. */
function unsupportedProjectQuantity(text: string, citations: SynthesisAnswer['segments'][number]['citations'], sources: SynthesisSource[]) {
  const projectQuotes = actualProjectCitations(citations, sources);
  const supported = new Set(projectQuotes.flatMap(citation => quantityTokens(citation.quote)));
  for (const clause of text.replace(/“[^”]*”|「[^」]*」/gu, '').split(/[，,。！？!?；;\n]/u)) {
    if (/如果|假如|假设|是否|能否|示例|例如|譬如|(?:你|您)(?:说|提到|的原话)/u.test(clause)) continue;
    const marker = /现场(?:记录|抽测|量测|实测|测得)|记录(?:里|中)的?|记录(?:写明|显示|只看到)|(?:本次|这次|当前|这条|该条)(?:现场)?记录(?:的|里|中|写|显|为|是)/u.exec(clause);
    if (!marker) continue;
    const scope = clause.slice(marker.index).split(/手册|规范|条款|标准要求|企业要求/u)[0];
    const quantities = quantityTokens(scope);
    const comparison = /低于|高于|超过|不满足|达不到/u.test(clause);
    if (!quantities.length && (!comparison || /无法|不能|不足以/u.test(clause))) continue;
    if (!projectQuotes.length || quantities.some(quantity => !supported.has(quantity))) return true;
  }
  return false;
}

// These exceptions only permit discussion. They grant no source access or
// business operation, and never make an unavailable preference current again.
export function occupancyDiscussionRequested(question: string) {
  return question.split(/[。！？!?；;\n]/).some(sentence => !/(?:不要|不想|不用|无需|不必).{0,12}(?:假设|比较|对比|预留|安排|布置)/.test(sentence)
    && /(?:请|帮我|想|能否).{0,12}(?:比较|对比)|(?:如果|假设).{0,20}(?:单人|双人|一人|两人).{0,16}(?:办公|使用)|(?:能否|能不能|是否可以).{0,16}(?:先|暂).{0,16}(?:预留|安排|布置)/.test(sentence));
}

export function occupancyReentryRequested(question: string) {
  return question.split(/[。！？!?；;\n]/).some(sentence => !/(?:不要|不想|不用|无需|不必).{0,8}(?:重新|再).{0,8}(?:说明|明确|补充|确认)/.test(sentence)
    && /(?:我想|我要|我来|让我).{0,8}(?:重新|再).{0,8}(?:说明|明确|补充|确认).{0,8}(?:人数|几人|办公)/.test(sentence));
}

function currentOccupancySources(sources: SynthesisSource[]) {
  return sources.filter(source => source.material?.ref.type === 'customer_need'
    && source.material.need?.field === 'use' && source.material.status === 'current'
    && /(?:单人|一人|双人|两人|多人).{0,6}(?:办公|使用)/.test(source.material.need.value));
}

/** Read-only scope shared by model-view guidance and final response validation. */
export function unavailableOccupancyRooms(sources: SynthesisSource[]): string[] {
  const known = new Set(currentOccupancySources(sources).map(source => source.material!.roomName));
  return [...new Set(sources.filter(source => source.material?.ref.type === 'customer_need'
    && source.material.status === 'current' && source.material.need?.interpretation?.field === 'use'
    && source.material.need.interpretation.currentFactId === null && !known.has(source.material.roomName))
    .map(source => source.material!.roomName).filter(room => typeof room === 'string' && !!room))];
}

/** Narrow, reproducible defects observed in configured-model answers, not a
 * general semantic judge. Never rewrite an answer or its source quotations.
 * Call only after provenance, numeric and formal-commitment validation. */
export function reviewSynthesisResponse(answer: SynthesisAnswer, sources: SynthesisSource[], context: SynthesisReviewContext = {}): ResponseReviewIssue[] {
  const knownUses = currentOccupancySources(sources);
  const rooms = [...new Set(sources.map(source => source.material?.roomName || source.followup?.room).filter((room): room is string => !!room))];
  const useRooms = new Set(knownUses.map(source => source.material!.roomName));
  const unavailableRooms = unavailableOccupancyRooms(sources);
  const sharedDimensionOnly = sources.filter(source => source.material?.ref.type === 'shared_need'
    && /(?:单人|双人|一人|两人).{0,6}(?:办公|使用)/.test(source.text)
    && /尺寸.{0,4}待(?:核对|核实)/.test(source.text) && !/人数.{0,12}(?:待核对|待核实|未定|待定)/.test(source.text));
  const unassigned = sources.filter(source => source.followup?.waitingFor === 'unassigned'
    && ['awaiting_customer', 'awaiting_owner', 'awaiting_review'].includes(source.followup.status));
  const allowPlanning = occupancyDiscussionRequested(context.currentQuestion || '');
  const allowReentry = allowPlanning || occupancyReentryRequested(context.currentQuestion || '');
  const questionRooms = rooms.filter(room => context.currentQuestion?.includes(room));
  const inRoom = (sentence: string, room: string) => {
    const mentioned = rooms.filter(name => sentence.includes(name));
    return mentioned.length ? mentioned.includes(room) : questionRooms.length === 1 ? questionRooms[0] === room : rooms.length === 1;
  };
  const issues: ResponseReviewIssue[] = [];
  const sourceOnly = !context.knowledgeExplanation && originalAnswerOnly(context.currentQuestion || '');
  const independentAdvice = independentAdviceRequested(context.currentQuestion || '');
  for (const [index, segment] of answer.segments.entries()) {
    const codes = new Set<ResponseReviewIssue['code']>();
    // Final validation receives canonical references; bounded repair can read
    // the original model catalog IDs. Resolve both through the same catalog.
    const citations = segment.citations.map(citation => resolveCatalogCitation(citation as unknown as Record<string, unknown>, sources) || citation);
    if (independentAdvice && citations.some(c => !sources.some(s => s.sourceId === c.sourceId && ['knowledge', 'web'].includes(s.kind))))
      codes.add('independent_advice_scope');
    if (sourceOnly) {
      if (segment.basis === 'advice' || citations.some(c => !sources.some(s => s.sourceId === c.sourceId && s.kind === 'knowledge')))
        codes.add('source_answer_scope');
      if (unsupportedSourceCondition(segment.text, citations, sources)) codes.add('unsupported_source_condition');
    }
    if (crossRoomCitations(citations, sources, context.currentRoom)) codes.add('misattributed_project_room');
    if (unsupportedProjectQuantity(segment.text, citations, sources)) codes.add('misattributed_project_quantity');
    if (unsupportedProjectObservation(segment.text, citations, sources)) codes.add('misattributed_project_observation');
    if (unsupportedRecordGap(segment, citations, sources)) codes.add('misattributed_project_observation');
    if (unsupportedProjectStatus(segment.text, citations, sources, context.currentProjectStage)) codes.add('misattributed_project_status');
    if (unsupportedRuleComparison(segment.text, citations, sources)) codes.add('misattributed_rule_comparison');
    // Natural explanations require the existing source-bound semantic proof
    // before commit. Causal entailment belongs to that review: a vocabulary
    // match cannot distinguish a synonym from an unsupported explanation.
    // Legacy paths retain their original heuristic; hard guards above remain.
    if (context.knowledgeExplanation !== 'natural-knowledge-answer-v1'
      && segment.basis === 'evidence' && unsupportedEvidenceMechanism(segment.text, citations)) codes.add('unsupported_evidence_mechanism');
    for (const code of projectAssessmentIssues(segment.text, segment.basis, citations, sources)) codes.add(code);
    if (/混合(?:行|原话)|最小待核实项|qualifiedBy|currentFactId|supersedes/.test(segment.text)) codes.add('internal_wording');
    for (const sentence of segment.text.split(/[。！？!?；;\n]/)) {
      const mentionedRooms = rooms.filter(room => sentence.includes(room));
      const knownUse = knownUses.some(source => mentionedRooms.length ? mentionedRooms.includes(source.material!.roomName) : useRooms.size === 1);
      const unavailableUse = unavailableRooms.some(room => inRoom(sentence, room));
      const measurementGap = /(?:缺的(?:是|仍是)|(?:还|尚)?没有|尚无|缺少).{0,24}(?:可量测(?:的)?(?:依据|现场|尺寸)|现场(?:的)?(?:尺寸|坐标|点位|依据)|点位依据)/.test(sentence);
      // A later disclaimer cannot scope an earlier absolute claim. Conditional
      // advice and explicitly attributed records remain valid explanations.
      const scoped = /本轮|本次|这次|此次|(?:可用|当前|现有)(?:的)?(?:资料|依据)|查询|(?:团队|设计师).{0,12}(?:回传|记录|说明)|(?:记录|原文|资料|说明)(?:中|里).{0,8}(?:写|说|显示)|如果|假如|若|是否/.test(sentence);
      if (measurementGap && !scoped) codes.add('unscoped_measurement_gap');
      const readiness = sentence.match(/(?:底盒(?:固定)?|插座(?:位置)?|现场|施工|工程|工地)[^。！？!?；;\n]{0,28}(?:(?:就|暂时|仍|还|尚)?(?:没法往下走|无法继续(?:施工)?|不能继续施工|不能施工|尚未具备施工条件|还没落到可施工的程度))/);
      const citedSiteReport = readiness && citations.some(citation => citation.quote.includes(readiness[0])
        && sources.some(source => source.sourceId === citation.sourceId && source.kind === 'project'));
      if (readiness && !citedSiteReport && !/如果|假如|若|是否|能否/.test(sentence)) codes.add('unscoped_work_readiness');
      // Assignment is a system state, not a census of what people are doing.
      // Do not let an unrelated closed/cancelled issue authorize this claim.
      if (unassigned.some(source => inRoom(sentence, source.followup!.room))) {
        const statement = sentence.replace(/(?:不代表|不意味着|并非|不是)(?:没有人在(?:等|处理)|没有待处理的事|无需处理)/g, '')
          .replace(/不代表无需处理/g, '');
        if (/没有人在(?:等|处理)|没有待处理的事|不是已经有人在处理/.test(statement)) codes.add('unsupported_work_absence');
      }
      if (unavailableUse && !allowReentry) {
        const statement = sentence.replace(/(?:不代表|不意味着|并非|不是)(?:你)?(?:还)?没有(?:确定|决定)(?:人数|需求)/g, '')
          .replace(/(?<!不是|并非|不能|不)(?:不代表|不意味着|并非|不是)(?:人数|几人)(?:还|尚|暂时)?(?:没定|未定|定不下来|待定)/g, '');
        if (/(?:人数|几人)[^，,]{0,8}(?:没定|未定|定不下来|没有确定|尚未确定)|人数.{0,12}按你.{0,12}定下来|人数.{0,12}定下来(?:之前|以前|前)|人数.{0,28}才(?:能)?定/.test(statement)) codes.add('reopened_unavailable_need');
      }
      if (unavailableUse && /人数.{0,4}(?:和|与|及).{0,4}尺寸.{0,8}(?:都|均).{0,6}(?:标|写).{0,6}(?:待核对|待定)/.test(sentence)
        && sharedDimensionOnly.some(source => inRoom(sentence, source.material!.roomName) && citations.some(c => c.sourceId === source.sourceId))) {
        codes.add('misattributed_shared_need');
      }
      if (unavailableUse && !allowPlanning && /(?:先|暂时|暂按).{0,24}(?:预留|排布|布置|安排).{0,18}(?:点位|插座|通道|书桌)|(?:点位|插座|通道|书桌).{0,20}(?:先|暂按).{0,20}(?:预留|排布|布置|安排)/.test(sentence)) {
        codes.add('unsolicited_unknown_plan');
      }
      const occupancyPlan = /(?:单人|双人|一人|两人|一个人|两个人|多人).{0,12}(?:办公|使用|主用|陪坐|用电脑).{0,24}(?:预留|排布|布置|安排|备用|插座|点位|通道|书桌|桌长)/.test(sentence);
      if (unavailableUse && !allowPlanning && occupancyPlan
        && (segment.basis === 'advice' || /建议|最好|可以|不妨|预留/.test(sentence))) codes.add('unsolicited_unknown_plan');
      if (knownUse && /(?:不替|不能替|不会替)(?:你|您)(?:改|修改|更改)需求/.test(sentence)) codes.add('repeated_known_need');
      for (const clause of sentence.split(/[，,]|但是|不过|然而/)) {
        const customerRequest = /(?:需要你|请你|请您|你可以|您可以|你直接|您直接|你再|您再|你重新|您重新).{0,18}(?:明确|确认|补充|告知|说明|说清|告诉).{0,24}(?:人数|几人|单人|双人|一个人|两个人|两人)/.test(clause)
          || /(?:人数|几人).{0,8}(?:你|您).{0,12}(?:说清|明确|确认|补充|说明|告诉)/.test(clause)
          || /(?:你|您).{0,6}(?:希望|想要|打算).{0,12}(?:哪种|什么样).{0,8}(?:使用方式|办公方式)/.test(clause)
          || /(?:你|您)(?:方便时|有空时|有空|愿意的话)?.{0,18}(?:人数|几人|几个人|单人|双人).{0,12}(?:说一句|说一下|说一遍|补充|说明|告诉|明确|确认)/.test(clause);
        const negativeRequest = /(?:无需|不用|不必|不需要|不再).{0,10}(?:明确|确认|补充|告知|说明|说清|告诉|说一句|说一下|说一遍)/.test(clause);
        if (unavailableUse && !allowReentry && customerRequest && !negativeRequest) codes.add('reopened_unavailable_need');
        // A bare second-person subject can narrate a formal version or an old
        // statement. Require a request marker, not just “your ... supplements”.
        if (knownUse && (/(?:请|可以|需要|还需|(?:你|您)(?=再|重新|继续|(?:确认|补充|告知|说明)(?:一下|下))).{0,16}(?:确认|补充|告知|说明).{0,16}(?:人数|单人办公|双人办公|几人)/.test(clause)
          || /(?:请|可以|需要|还需|(?:你|您)(?=再|重新|继续)).{0,18}(?:人数|单人办公|双人办公).{0,12}(?:补充|说明|确认)/.test(clause))
          && !/(?:团队|设计师|施工人员).{0,8}(?:确认|核对|核实|复核|补充)|(?:无需|不用|不必|不需要|不再).{0,8}(?:确认|补充|告知|说明)/.test(clause)) codes.add('repeated_known_need');
      }
    }
    for (const code of codes) issues.push({ segment: index + 1, code });
  }
  return issues;
}
