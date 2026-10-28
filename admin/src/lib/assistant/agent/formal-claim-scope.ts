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
