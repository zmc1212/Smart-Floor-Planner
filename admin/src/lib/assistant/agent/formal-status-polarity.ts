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

const previewDenial = /^(?:这(?:些|两|几)(?:项|条)(?:都|均)?)?(?:不代表|不是(?:确认)?|避免被理解成|不(?:要|应)?(?:把[\p{Script=Han}]{1,12}?写成|写(?:成)?)|(?:不能|不可|不宜)(?:据此|直接|替(?:项目)?团队)?(?:确认|认定|视为|作为|当[成作]|看[成作])|未证明)/u;
const previewStatus = /^(?:现场|上述现场事项)?(已(?:经)?(?:成功)?(?:正式)?(?:批准|确认|排期|开工|完工|完成|验收|定版))/u;
const statusObject = /^(?:施工|做法|变更|核对|合格)?$/u;

function unquoteStatus(value: string): string {
  const trimmed = value.trim();
  const pair = [['“', '”'], ['「', '」'], ['"', '"']].find(([open, close]) =>
    trimmed.startsWith(open) && trimmed.endsWith(close));
  return pair ? trimmed.slice(1, -1).trim() : trimmed;
}

function projectDeniedStatus(item: string): string | null {
  const value = unquoteStatus(item);
  const match = previewStatus.exec(value);
  if (!match) return null;
  const tail = value.slice(match[0].length);
  if (!statusObject.test(tail) && !(tail.startsWith('的') && tail.length > 1)) return null;
  const start = item.indexOf(value) + match[0].length - match[1].length;
  return item.slice(0, start) + '待核实状态' + item.slice(start + match[1].length);
}

/** Analyze a denied state or a coordinated list. An attributive phrase can
 * name what was denied, and any claims in that phrase remain in the guard view. */
export function projectPreviewStatusDenials(text: string): string {
  return text.replace(/\[[A-Za-z0-9_-]+\]\(CITE\)/g, '').split(/([，,。；;！？!?\n：:（）()])/u).map(clause => {
    const value = lead(clause.trim().replace(/^[#>*_\s]+|[*_\s]+$/gu, ''));
    const denial = previewDenial.exec(value);
    if (!denial) return clause;
    const operand = value.slice(denial[0].length);
    const statuses = unquoteStatus(operand).split(/(、|或(?:者)?)/u);
    const projected = statuses.map((item, index) => index % 2 ? item : projectDeniedStatus(item));
    if (projected.includes(null)) return clause;
    const start = clause.lastIndexOf(value) + denial[0].length;
    return clause.slice(0, start) + projected.join('') + clause.slice(start + operand.length);
  }).join('');
}
