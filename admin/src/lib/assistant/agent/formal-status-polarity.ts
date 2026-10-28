type WorkState = '落实' | '解决' | '关闭';
export type NegativeStatusSpan = { start: number; end: number; predicate: string; state: WorkState; scope: 'unconfirmed' | 'no_evidence' };
const leading = ['但是', '因此', '所以', '目前', '现在', '当前', '本次', '这次', '此次', '仍然', '既', '也', '但', '并', '仍'];
const subjects = ['该方案对应的事项', '该事项的现场', '该施工事项', '这条现场事项', '这条事项', '这一事项', '现场事项', '该事项', '本事项', '此事项', '这件事', '这项工作', '该工作', '事项', '现场'];
const sourceHeads = ['现有资料', '可用资料', '查询结果', '查询', '资料', '记录', '证据'];
const operators = ['尚未能确认', '尚未确认', '未能确认', '无法确认', '不能确认', '未确认', '未显示', '未表明', '未证明'];
function lead(value: string) {
  let result = value.trim();
  for (let n = 0; n < 8; n++) { const token = leading.find(t => result.startsWith(t)); if (!token) break; result = result.slice(token.length).trim(); }
  return result;
}
function afterHead(value: string) {
  const head = [...subjects, ...sourceHeads].find(t => value.startsWith(t));
  return head ? lead(value.slice(head.length)) : value;
}
function unconfirmed(prefix: string) {
  const value = afterHead(lead(prefix)), operator = operators.find(t => value.startsWith(t));
  if (!operator) return false;
  const subject = value.slice(operator.length).trim();
  return subject === '' || subjects.includes(subject);
}
function noEvidence(prefix: string, suffix: string) {
  const value = afterHead(lead(prefix));
  for (const [open, close] of [['“', '”'], ['「', '」'], ['"', '"'], ['', '']]) {
    if (open && !value.endsWith(open) || close && !suffix.startsWith(close)) continue;
    const head = open ? value.slice(0, -open.length).trim() : value;
    const tail = (close ? suffix.slice(close.length) : suffix).trim();
    if (['没有', '尚无', '未见', '没有可确认的', '没有实际的', '没有可用的'].includes(head)
      && ['证据', '的证据', '记录', '的记录', '结果', '的结果'].includes(tail)) return true;
  }
  return false;
}
/** Analyze a closed work-state predicate and its complete negative scope.
 * No unknown subject/outer negation/second assertion is consumed. Finance,
 * booking and contact verbs retain the original guard. Callers must separately
 * authorize the current formal-status sources before using this projection. */
export function negativeWorkStatusSpans(text: string): NegativeStatusSpan[] {
  const spans: NegativeStatusSpan[] = [];
  for (const clause of text.matchAll(/[^，,。；;！？!?\n]+/g)) for (const predicate of clause[0].matchAll(/已(?:经)?(?:成功)?(?:正式)?(落实|解决|关闭)/g)) {
    const prefix = clause[0].slice(0, predicate.index).trim(), suffix = clause[0].slice(predicate.index + predicate[0].length).trim();
    const scope = unconfirmed(prefix) ? 'unconfirmed' : noEvidence(prefix, suffix) ? 'no_evidence' : null;
    if (scope) spans.push({ start: clause.index + predicate.index, end: clause.index + predicate.index + predicate[0].length, predicate: predicate[0], state: predicate[1] as WorkState, scope });
  }
  return spans;
}
export function projectNegativeWorkStatus(text: string) {
  let analysis = text;
  for (const span of negativeWorkStatusSpans(text).reverse()) analysis = analysis.slice(0, span.start) + '待核实状态' + analysis.slice(span.end);
  return analysis;
}
