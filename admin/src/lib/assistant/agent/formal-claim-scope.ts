// Shared acceptance grammar. The object comes from the clause and its cited
// original, so another construction stage does not need another allowlist.
const acceptance = /(?:已(?:经)?(?:正式)?验收(?:合格|通过|完成)?|(?:通过|完成)(?:了)?(?:正式)?验收|(?:正式)?验收(?:结果(?:为|是)|已(?:经)?)?(?:合格|通过|完成|成功)|已(?:经)?(?:正式)?放行)/gu;
const prerequisite = /(?:应(?:当)?|须|需(?:要)?|必须|要|先|前)(?:先)?(?:确认|核对|检查|查验)|(?:前提(?:条件)?|条件|依据)是/u;
const nonAssertion = /^(?:(?:但(?:是)?|也|目前|本次|仍|因此|所以|同时|并)\s*)*(?:不(?:能|可|足以)(?:据此)?(?:确认|认定|判断|证明)|无法(?:确认|认定|判断)|未(?:能)?确认|不(?:等于|代表|证明|表明)|请(?:先)?(?:核对|确认|检查)|建议(?:先)?(?:核对|确认|检查))/u;
const conditionTail = /^(?:[”」』"])?(?:以后|后|之前|前|时)(?:\s*$|[，,]|才|方|再|应|可|须|进行|继续|进入|开展|不得|不(?:能|可|得|宜))/u;
const unsafeConnector = /(?:并且|而且|以及|同时|但|然而|不过|并已|都已|均已|又已|[：:])/u;
const receiptDenial = /^(?:[\p{Script=Han}]{1,12})?(?<!不是|并非|不能|不可|没有|不)(?:(?:不能|不宜|不可)(?:直接)?(?:作为|视为|当作)|并非|不是)/u;
const receiptTail = /^(?:或[\p{Script=Han}]{1,15})?的(?:回执|依据|证明|结论|结果|记录)/u;
const necessaryCondition = /^(?:才(?:能|可)|方可|(?:为|这一)(?:前提|条件))/u;
const normativeLead = /^(?:(?:而|且|并|所以|因此|同时)\s*)*(?:应(?:当)?|须|需(?:要)?|必须|要)(?:在|先)/u;
const assertivePrefix = /(?:已(?:经)?(?:正式)?|现在|目前|实际|确实|都|均|现场)/u;
const statusHeading = /(?:状态|进度|结果|结论|回执|记录)$/u;
const projectSubject = /你家|您家|本项目|该项目|本工程|我家|当前项目|这个项目/u;
const subsequentAction = /^(?:(?:并(?:取得|拿到|收到))?(?:合格|通过)(?:的)?(?:回执|记录|结论)?|的(?:回执|记录|结论))?(?:以后|后)(?:才|方|再)/u;

// Category B/C cues. These describe how the predicate is being used in the
// sentence (rule, decision criterion or explanation), not a construction stage.
const conditionSentence = /(?:前提|条件|依据|基础|关键(?:节点|在于)|判断|要看|取决于|为准|是否|能否|才|方可)/u;
const explanationSentence = /(?:也就是说|换句话说|意思是|看的是|本质|判断(?:的依据|标准)?是|说明|意味着)/u;
const basisTail = /^(?:的)?(?:基础|前提|条件|依据|标准|关键)/u;

type AcceptanceSubject = { subject: string; completion: boolean };
export type AcceptanceUse = 'standard_condition' | 'professional_explanation' | 'project_fact' | 'formal_conclusion';

/** The same four categories are used by the specialist prompt, final-response
 * validation and the saving layer. A rule or its explanation never becomes a
 * project completion, and a project completion needs a Construction receipt. */
export const acceptanceSemanticContract = '验收表述分四类：A标准规定（规范原文明确的条件）；B专业解释（对条文的解释、适用范围与一般建议）；C项目事实（本项目实际发生，须有当前获权施工记录）；D正式业务结论（须有Construction正式回执）。A、B不得写成C、D；同一段包含多类时分别判断。';

function localPrefix(prefix: string) {
  // The label of a quote, list item or explanation has its own scope.
  return prefix.split(/[：:]/u).at(-1)!.replace(/^[\s“「『"①-⑳]+/u, '');
}

function conjunctSubject(prefix: string) {
  return prefix.replace(/^(?:而且|以及|并且|所以|因此|同时|且|并|而|和|与|及)\s*/u, '');
}

function acceptanceRelation(suffix: string) {
  return necessaryCondition.test(suffix) || /^(?:(?:这一|的)(?:结果|结论|确认|核对|检查))(?:[。；;，,！？!?\n]|$)/u.test(suffix);
}

function acceptanceCondition(prefix: string, suffix: string) {
  return prerequisite.test(prefix) || /(?:应(?:当)?|须|需(?:要)?|必须|要)(?:先)?$/u.test(prefix)
    || conditionTail.test(suffix) || /^(?:后|之前|前)[。；;！？!?\n]$/u.test(suffix)
    || necessaryCondition.test(suffix);
}

/** A completion form asserts a result; a bare predicate states the standard. */
function isCompletion(predicate: string) {
  return /^已/u.test(predicate) || /放行/u.test(predicate) || /(?:通过|完成|成功|结果)/u.test(predicate);
}

function acceptanceSubjects(quotes: readonly string[]) {
  return quotes.flatMap(quote => [...quote.matchAll(acceptance)].flatMap(predicate => {
    const before = quote.slice(0, predicate.index), after = quote.slice(predicate.index + predicate[0].length);
    const local = localPrefix(before.split(/[，,。；;！？!?\n]/u).at(-1) ?? '');
    if (!acceptanceCondition(local, after)) return [];
    const operator = [...local.matchAll(new RegExp(prerequisite.source, 'gu'))].at(-1);
    const object = (operator ? local.slice(operator.index + operator[0].length)
      : local.replace(/^[\d.]+\s*/u, '').replace(normativeLead, '').replace(/^在/u, '')).trim();
    if (!object || projectSubject.test(object) || assertivePrefix.test(object)) return [];
    return [{ subject: object, completion: isCompletion(predicate[0]) } satisfies AcceptanceSubject];
  }));
}

function projectBound(prefix: string) {
  return projectSubject.test(prefix) || assertivePrefix.test(prefix)
    || /(?:我|我们)(?:家|这边|的项目)/u.test(prefix);
}

function subjectSupported(subject: string, completion: boolean, subjects: AcceptanceSubject[]) {
  return subjects.some(item => {
    if (completion && !item.completion) return false;
    const at = subject.indexOf(item.subject);
    if (at < 0) return false;
    const before = subject.slice(0, at), after = subject.slice(at + item.subject.length);
    // A coordinated pair ("基层和防水层") is not one governed object.
    return !subjects.some(other => other !== item && (
      after.startsWith('和' + other.subject) || after.startsWith('与' + other.subject)
      || after.startsWith('及' + other.subject) || after.startsWith('或' + other.subject)
      || after.startsWith('、' + other.subject) || after.startsWith('以及' + other.subject)
      || before.endsWith(other.subject + '和') || before.endsWith(other.subject + '与')
      || before.endsWith(other.subject + '及') || before.endsWith(other.subject + '或')
      || before.endsWith(other.subject + '、') || before.endsWith(other.subject + '以及')));
  });
}

/** A clause that omits its subject inherits the nearest previously mentioned
 * governed object in the same sentence ("防水层完整、验收合格的基础上"). */
function impliedSubject(sentence: string, index: number, subjects: AcceptanceSubject[]) {
  let best = '', bestAt = -1;
  for (const item of subjects) {
    const at = sentence.lastIndexOf(item.subject, index);
    if (at >= 0 && at > bestAt) { best = item.subject; bestAt = at; }
  }
  return best;
}

/** Classify one acceptance mention. Only a cited original can qualify a rule or
 * its explanation; project completion stays a business fact that needs a
 * construction receipt. */
function classifyAcceptance(prefix: string, suffix: string, sentence: string): AcceptanceUse {
  if (prerequisite.test(prefix) || /(?:应(?:当)?|须|需(?:要)?|必须|要)(?:先)?$/u.test(prefix)
    || conditionTail.test(suffix) || basisTail.test(suffix) || necessaryCondition.test(suffix)
    || acceptanceRelation(suffix) || conditionSentence.test(sentence)) return 'standard_condition';
  return explanationSentence.test(sentence) ? 'professional_explanation' : 'project_fact';
}

/** A checklist header only governs its listed checks, within the same
 * sentence. A report/status header or an independent subject gets no scope. */
function checklistHeader(clause: string) {
  const header = /^[^：:。！？!?\n]{0,80}(?:前(?:的)?|待(?:确认|检查|核对)(?:的)?)(?:检查清单|核对清单|验收清单|检查项|核对项)(?:可(?:归纳|整理|列)为|(?:有|包括)(?:以下)?|如下)?\s*[：:]/u.exec(clause);
  return !!header && !/已|实际|结果|记录|正式|目前|进度|状态/u.test(header[0]);
}

/** Project only a governed predicate for the shared commitment guard. Keep the
 * saved answer, its numerical checks and every independent assertion intact. */
export function projectAcceptanceClaims(text: string, quotes: readonly string[], generalAdvice = false) {
  const subjects = acceptanceSubjects(quotes);
  let checklist = false;
  return text.split(/(?<=[。！？!?\n])/u).map(sentence => {
    let offset = 0;
    return sentence.split(/(?<=[，,；;])/u).map(clause => {
    const clauseOffset = offset;
    offset += clause.length;
    const header = checklistHeader(clause);
    const projected = clause.replace(acceptance, (predicate: string, start: number) => {
      const original = clause.slice(0, start).trim();
      const prefix = localPrefix(original), suffix = clause.slice(start + predicate.length);
      const queried = /(?:是否|能否|有没有)(?:已经?|正式)?$/u.test(prefix)
        || /^(?:是否|能否)(?:已(?:经)?)?(?:合格|通过)/u.test(suffix);
      const operator = nonAssertion.exec(prefix);
      const governed = operator ? prefix.slice(operator[0].length) : '';
      const scoped = !!operator && !unsafeConnector.test(governed)
        && !/^(?:并?不|无法|未|尚)/u.test(governed)
        && !/吗[？?]?$/u.test(clause.trim())
        && (!hasAcceptanceClaim(governed) || /或(?:者)?[^，、]{0,18}$/u.test(governed));
      const completion = isCompletion(predicate);
      const advice = !completion && !assertivePrefix.test(prefix) && !projectSubject.test(prefix)
        && !unsafeConnector.test(prefix) && !hasAcceptanceClaim(prefix)
        && (generalAdvice && (subsequentAction.test(suffix) || /^等/u.test(prefix) && conditionTail.test(suffix))
          || conditionTail.test(suffix) && /^建议(?:先|等|在)/u.test(prefix));
      const denialOperator = receiptDenial.exec(prefix);
      const recordBoundary = !!denialOperator && !unsafeConnector.test(prefix) && !hasAcceptanceClaim(prefix)
        && !/^(?:并?不|无法|未|尚)/u.test(prefix.slice(denialOperator[0].length)) && receiptTail.test(suffix);
      const colon = Math.max(original.lastIndexOf('：'), original.lastIndexOf(':'));
      const label = colon < 0 ? '' : original.slice(0, colon).trim();
      const labeled = !label || /(?:原文|规定|要求|前提|条件)$/u.test(label) || normativeLead.test(prefix)
        || prerequisite.test(prefix) || conditionTail.test(suffix);
      // Category A/B: a rule or its explanation needs the same governed object
      // in an already selected original; category C/D never pass this scope.
      const localSubject = conjunctSubject((prefix.split(prerequisite).at(-1) ?? prefix).trim());
      const cleaned = localSubject.replace(normativeLead, '').trim();
      const mentionSubject = cleaned.replace(/(?:应(?:当)?|须|需(?:要)?|必须|要)(?:先)?$/u, '')
        .match(/[\p{Script=Han}]{1,30}$/u)?.[0] ?? '';
      const use = classifyAcceptance(prefix, suffix, sentence);
      const citedByUse = (use === 'standard_condition' || use === 'professional_explanation')
        && !unsafeConnector.test(cleaned) && !projectBound(cleaned) && !projectBound(prefix)
        && (mentionSubject
          ? subjectSupported(mentionSubject, completion, subjects)
          : (() => {
              const implied = impliedSubject(sentence, clauseOffset + start, subjects);
              if (implied) return subjectSupported(implied, completion, subjects);
              // The original clause-local rule: a necessary condition with one
              // selected governed object needs no repeated subject.
              return necessaryCondition.test(suffix) && subjects.length === 1
                && subjectSupported(subjects[0].subject, completion, subjects);
            })());
      // A list header owns only its listed checks.
      const citedByList = (checklist || header) && !!mentionSubject
        && subjectSupported(mentionSubject, completion, subjects);
      const conditional = !statusHeading.test(label)
        && (advice || labeled && (citedByUse || citedByList || header && acceptanceRelation(suffix)));
      return queried || scoped || recordBoundary || conditional ? '核对状态' : predicate;
    });
    checklist = (checklist || header) && /[；;]$/u.test(clause);
    return projected;
    }).join('');
  }).join('');
}

export function hasAcceptanceClaim(text: string) {
  return text.search(acceptance) >= 0;
}

// Project only an explicit, complete denial of approval for a closed list of
// business subjects. This changes the guard view, never the original answer.
const subjects = new Set(['方案', '费用', '工期', '现场落实', '验收']);
const denial = /^(?:但|但是|因此|所以)?(?:这(?:一点)?|客户需求|需求记录|当前资料|该记录)?(?:并)?(?:不代表|不证明|不能证明|不足以证明|不能说明|不意味着)/;
export function projectDeniedApprovalList(text: string): string {
  return text.split(/([，。；！？\n—,;!?])/).map(clause => {
    const value = clause.trim(), prefix = denial.exec(value);
    if (!prefix) return clause;
    const predicate = /已(?:经)?(?:成功)?(?:正式)?批准$/.exec(value);
    if (!predicate) return clause;
    const objects = value.slice(prefix[0].length, predicate.index).split(/、|或|以及|和|及/);
    if (objects.length < 2 || objects.length > subjects.size || objects.some(o => !subjects.has(o))) return clause;
    return '不能据此确认操作状态';
  }).join('');
}
