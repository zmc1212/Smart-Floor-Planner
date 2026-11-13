// Shared acceptance grammar. The object comes from the clause and its cited
// original, so another construction stage does not need another allowlist.
const acceptance = /(?:已(?:经)?(?:正式)?验收(?:合格|通过|完成)?|(?:通过|完成)(?:了)?(?:正式)?验收|(?:正式)?验收(?:结果(?:为|是)|已(?:经)?)?(?:合格|通过|完成|成功)|已(?:经)?(?:正式)?放行)/gu;
const prerequisite = /(?:应(?:当)?|须|需(?:要)?|必须|要|先|前)(?:先)?(?:确认|核对|检查|查验)|(?:前提(?:条件)?|条件|依据)是/u;
const nonAssertion = /^(?:(?:但(?:是)?|也|目前|本次|仍|因此|所以|同时|并)\s*)*(?:不(?:能|可|足以)(?:据此)?(?:确认|认定|判断|证明)|无法(?:确认|认定|判断)|未(?:能)?确认|不(?:等于|代表|证明|表明)|请(?:先)?(?:核对|确认|检查)|建议(?:先)?(?:核对|确认|检查))/u;
const conditionTail = /^(?:[”」』"])?(?:以后|后|之前|前|时)(?:\s*$|[，,]|才|方|再|应|可|须|进行|继续|进入|开展)/u;
const unsafeConnector = /(?:并且|而且|以及|同时|但|然而|不过|并已|都已|均已|又已|[：:])/u;
const receiptDenial = /^(?:[\p{Script=Han}]{1,12})?(?<!不是|并非|不能|不可|没有|不)(?:(?:不能|不宜|不可)(?:直接)?(?:作为|视为|当作)|并非|不是)/u;
const receiptTail = /^(?:或[\p{Script=Han}]{1,15})?的(?:回执|依据|证明|结论|结果|记录)/u;
const necessaryCondition = /^(?:才(?:能|可)|方可|为(?:前提|条件))/u;

function acceptanceCondition(prefix: string, suffix: string) {
  return prerequisite.test(prefix) || /(?:应(?:当)?|须|需(?:要)?|必须|要)(?:先)?$/u.test(prefix)
    || conditionTail.test(suffix) || /^(?:后|之前|前)[。；;！？!?\n]$/u.test(suffix)
    || necessaryCondition.test(suffix);
}

/** The original must itself state a prerequisite for the same subject.
 * Match the governed predicate, not merely an acceptance word on the page. */
function citedAcceptance(prefix: string, suffix: string, quotes: readonly string[]) {
  const nominalSubject = /^的(?:确认|核对|检查)(?:[。；;！？!?\n]|$)/u.test(suffix)
    ? prefix.replace(/^(?:以及|和|与|及)/u, '') : null;
  const localSubject = prefix.split(prerequisite).at(-1) ?? prefix;
  if (nominalSubject === null && (!acceptanceCondition(prefix, suffix) || unsafeConnector.test(localSubject))) return false;
  if (/(?:已经?|已经?正式)$/u.test(prefix)) return false;
  const subject = prefix.replace(/(?:应(?:当)?|须|需(?:要)?|必须|要)(?:先)?$/u, '')
    .match(/[\p{Script=Han}]{1,30}$/u)?.[0] ?? '';
  if (/你家|您家|本项目|该项目|本工程|我家|当前项目|这个项目|都|均/u.test(localSubject)) return false;
  return quotes.some(quote => [...quote.matchAll(acceptance)].some(predicate => {
    const before = quote.slice(0, predicate.index), after = quote.slice(predicate.index + predicate[0].length);
    const local = before.split(/[，,。；;！？!?\n]/u).at(-1) ?? '';
    if (!acceptanceCondition(local, after)) return false;
    const operator = [...local.matchAll(new RegExp(prerequisite.source, 'gu'))].at(-1);
    const object = (operator ? local.slice(operator.index + operator[0].length)
      : local.replace(/^(?:[\d.]+\s*)?(?:应(?:当)?|须|需(?:要)?|必须)?在/u, '')).trim();
    if (!object) return false;
    if (nominalSubject !== null) return nominalSubject === object;
    // A subject omitted in an explicit prerequisite is still conditional.
    // It can restate the sole selected acceptance rule without asserting that
    // an identified object has passed.
    if (!prefix && necessaryCondition.test(suffix)) {
      return quotes.filter(quote => hasAcceptanceClaim(quote)).length === 1;
    }
    if (!subject.endsWith(object)) return false;
    // A rule scoped to a named object cannot certify this project or an
    // additional object joined into the same assertion.
    const lead = subject.slice(0, -object.length);
    return !/都|均|(?:以及|和|与|及|或|、)$/u.test(lead);
  }));
}

/** Project only a governed predicate for the shared commitment guard. Keep the
 * saved answer, its numerical checks and every independent assertion intact. */
export function projectAcceptanceClaims(text: string, quotes: readonly string[]) {
  return text.split(/(?<=[，,。；;！？!?\n])/u).map(clause => clause.replace(acceptance,
    (predicate: string, start: number) => {
      const prefix = clause.slice(0, start).trim(), suffix = clause.slice(start + predicate.length);
      const queried = /(?:是否|能否|有没有)(?:已经?|正式)?$/u.test(prefix)
        || /^(?:是否|能否)(?:已(?:经)?)?(?:合格|通过)/u.test(suffix);
      const operator = nonAssertion.exec(prefix);
      const governed = operator ? prefix.slice(operator[0].length) : '';
      const scoped = !!operator && !unsafeConnector.test(governed)
        && !/^(?:并?不|无法|未|尚)/u.test(governed)
        && !/吗[？?]?$/u.test(clause.trim())
        && (!hasAcceptanceClaim(governed) || /或(?:者)?[^，、]{0,18}$/u.test(governed));
      const advice = !predicate.startsWith('已') && conditionTail.test(suffix) && /^建议(?:先|等|在)/u.test(prefix);
      const denialOperator = receiptDenial.exec(prefix);
      const recordBoundary = !!denialOperator && !unsafeConnector.test(prefix) && !hasAcceptanceClaim(prefix)
        && !/^(?:并?不|无法|未|尚)/u.test(prefix.slice(denialOperator[0].length)) && receiptTail.test(suffix);
      return queried || scoped || advice || recordBoundary || citedAcceptance(prefix, suffix, quotes) ? '核对状态' : predicate;
    })).join('');
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
