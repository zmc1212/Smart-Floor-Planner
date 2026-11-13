/** A cited standard's prerequisite is a conditional, not a project receipt.
 * Mask only the acceptance predicate inside that condition. Any independent
 * assertion in the same segment still reaches the original guard. */
export function projectCitedAcceptanceCondition(text: string, quotes: readonly string[]) {
  const prerequisites = [
    { subject: '基层', source: '防水施工前应确认基层已验收合格', prefix: /施工前(?:还)?(?:应|需|须)确认$/u },
    { subject: '防水层', source: '防水层验收合格后进行下一道工序', prefix: /(?:前提是|条件是)$/u },
  ];
  return text.split(/([，,。；;！？!?\n])/u).map(clause => {
    for (const { subject, source, prefix } of prerequisites) {
      const predicate = subject + '已经验收合格', short = subject + '已验收合格';
      const token = clause.includes(predicate) ? predicate : short;
      const start = clause.indexOf(token);
      if (start >= 0 && prefix.test(clause.slice(0, start)) && quotes.some(quote => quote.includes(source)))
        return clause.slice(0, start) + subject + '须经检查合格' + clause.slice(start + token.length);
    }
    return clause;
  }).join('');
}

export function projectUnconfirmedWaterproofAcceptance(text: string) {
  return text.split(/([，,。；;！？!?\n])/u).map(clause => clause.replace(
    /^(\s*(?:也|仍|目前)?(?:不能确认|无法确认|未能确认)(?:管根处理已完成或)?(?:基层|防水层))已验收合格(?=$|\s*$)/u,
    '$1的核对状态',
  )).join('');
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
