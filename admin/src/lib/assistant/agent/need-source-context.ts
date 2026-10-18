import { referenceOnlyClause } from '../knowledge/reference-intent';
import { explicitNeedRoomPattern } from '../requirements/room-names';

type Span = { start: number; end: number };
type Room = Span & { name: string };
type SourceNeed = { room: string; value: string; quote: string };
const sentenceBoundary = /[。！？?；;\n]/;
const clauseBoundary = /[，,。！？?；;\n]/;

function occurrences(text: string, value: string): Span[] {
  if (!value) return [];
  const spans: Span[] = [];
  for (let start = text.indexOf(value); start >= 0; start = text.indexOf(value, start + value.length)) {
    spans.push({ start, end: start + value.length });
  }
  return spans;
}

function context(text: string, span: Span, boundary: RegExp) {
  let { start, end } = span;
  while (start > 0 && !boundary.test(text[start - 1])) start--;
  while (end < text.length && !boundary.test(text[end])) end++;
  return { start, end, text: text.slice(start, end) };
}

function sourceRooms(text: string, requested: string): Room[] {
  const literal = occurrences(text, requested).map(span => ({ ...span, name: requested }));
  const known = [...text.matchAll(new RegExp(explicitNeedRoomPattern.source, 'g'))]
    .map(match => ({ start: match.index, end: match.index + match[0].length, name: match[0] }))
    .filter(room => !literal.some(span => span.start <= room.start && span.end >= room.end));
  return [...known, ...literal].sort((a, b) => a.start - b.start);
}

function roomContext(text: string, value: Span, rooms: Room[], requested: string) {
  if (!requested) return { matches: true, quoteEnd: value.end };
  const sentence = context(text, value, sentenceBoundary);
  const before = rooms.findLastIndex(room => room.start <= value.start);
  // A postposed room must be in the same sentence and inside the actual quote.
  if (before < 0 || rooms[before].start < sentence.start) {
    const after = rooms.filter(room => room.start >= value.start && room.end <= sentence.end);
    if (after.length) return { matches: after.every(room => room.name === requested), quoteEnd: after.at(-1)!.end };
  }
  if (before < 0) return { matches: false, quoteEnd: value.end };
  const subjects = [rooms[before]];
  for (let i = before - 1; i >= 0; i--) {
    if (!/^\s*(?:和|与|及|、|跟|以及)\s*$/.test(text.slice(rooms[i].end, rooms[i + 1].start))) break;
    subjects.push(rooms[i]);
  }
  return { matches: subjects.some(room => room.name === requested), quoteEnd: value.end };
}

function directStatement(text: string, span: Span) {
  const clause = context(text, span, clauseBoundary);
  const sentence = context(text, span, sentenceBoundary);
  return !referenceOnlyClause(clause.text)
    && !/如果|假如|假设|先讨论|先聊|(?:图纸|方案).{0,8}(?:写|标|建议)|(?:设计师|师傅|小K|他|她|你).{0,4}(?:说|建议)|只是引用/.test(sentence.text);
}

function qualifiersRetained(text: string, span: Span) {
  const clause = context(text, span, clauseBoundary);
  // Only inspect qualifiers outside value: a full literal negative or unknown
  // statement is still a customer statement, and must not become its opposite.
  const prefix = text.slice(clause.start, span.start).split(/而是|但是|但/).at(-1)!;
  const suffix = text.slice(span.end, clause.end);
  return !/(?:不是|并非|不再|不需要|不想|不愿|不用|不要|不能|不适合|不支持|不打算|暂不|否认|取消|未确定|未决定|还没确定|还没决定|尚未确定|尚未决定|不确定|不一定|未必|可能|考虑|暂定|是否|要不要|能不能)[^，,。！？?；;\n]{0,12}$/.test(prefix)
    && !/^\s*(?:还(?:没|未)(?:定|确定|决定)|尚未(?:确定|决定)|没(?:有)?(?:定|确定|决定)|未(?:定|确定|决定)|待(?:确认|定)|(?:还)?(?:需要|需|有待)(?:再)?(?:确认|讨论|决定)|不(?:需要|再|用|要)|先不|(?:已经|已)?取消|是不是|是否|吗|[？?])/.test(suffix);
}

/** Bounded literal proof, not general language inference. No history mutation.
 * Match the value at its quoted position, retain nearby denial/uncertainty, and
 * require its explicit room subject. A later direct denial beats an older hit.
 */
export function needSourceContextSupported(need: SourceNeed, text: string): boolean {
  if (!need.quote.includes(need.value) || (need.room && !text.includes(need.room))) return false;
  const quotes = occurrences(text, need.quote), rooms = sourceRooms(text, need.room);
  const direct = occurrences(text, need.value).filter(span => directStatement(text, span))
    .map(span => ({ ...span, ...roomContext(text, span, rooms, need.room) })).filter(span => span.matches);
  if (!direct.length || !qualifiersRetained(text, direct.at(-1)!)) return false;
  return direct.some(span => qualifiersRetained(text, span)
    && quotes.some(quote => quote.start <= span.start && quote.end >= Math.max(span.end, span.quoteEnd)));
}
