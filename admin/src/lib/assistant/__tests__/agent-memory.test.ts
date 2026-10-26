import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uncoveredNeedStatements, NeedWriteIncompleteError } from '../agent/memory';
import { applyNeedDelta, compactNeedMemory, needMemoryPolicy, parseNeedDelta, parseNeedWrites, readMemory, needWriteFeedback, hasExplicitNeedCorrection, needQualifications, needInterpretations, assertRecordedReply, needReconfirmationFeedback, explicitNeedRecordOnly, recordedNeedReceipt, onlyChatHistoryRequested, effectiveDeskPositions, currentNeedView, unavailableDeskReply, needDeskPositionFeedback, type NeedFact, type NeedMemory } from '../agent/memory';

test('exclusive chat recap recognizes the actual independent wording without requiring a second negative clause', () => {
  for (const text of ['只回顾这次聊天里的原话：书房、客厅和预算现在分别是什么？不要查工地或企业资料。', '哪些需求已改，哪些仍保留？只回顾本次聊天原话，给出当前需求和旧说法的区别。']) assert.equal(onlyChatHistoryRequested(text), true, text);
  for (const text of ['不要只回顾聊天原话，还要查工地进度', '只回顾聊天原话，另外查一下工地进度', '只回顾聊天原话，同时结合企业制度回答', '客户说“只回顾聊天原话”，现在请查现场资料', '书房现在的施工进度是什么？']) assert.equal(onlyChatHistoryRequested(text), false, text);
});

test('an explicit from-to desk correction hides the legacy position and never revives it after withdrawal', () => {
  let stored = readMemory({});
  for (const [room, field, value, quote, text, sourceMessageId] of [
    ['', 'desk', '书房书桌靠窗', '请记下：书房书桌靠窗', '请记下：书房书桌靠窗，保留收纳。', '1'],
    ['', 'storage', '保留收纳', '保留收纳', '请记下：书房书桌靠窗，保留收纳。', '1'],
    ['客厅', 'devices', '不要投影设备', '客厅不要投影设备', '请记下：客厅不要投影设备。', '2'],
    ['', 'timeline', '装修日期未定', '装修日期未定', '请记下：装修日期未定。', '3'],
  ] as const) stored = applyNeedDelta(stored, { room, field, value, quote, sourceMessageId, expectedVersion: stored.version },
    { id: sourceMessageId, text }, `${sourceMessageId}:${field}`, '');
  const before = JSON.stringify(stored);
  for (const quote of ['书房书桌从靠窗改为靠内墙', '更正并请保存：书房书桌从靠窗改为靠内墙']) {
    const text = '更正并请保存：书房书桌从靠窗改为靠内墙；书房保留收纳，客厅不要投影设备，装修日期未定，这些保持不变。';
    const next = applyNeedDelta(stored, { room: '书房', field: 'desk', value: '靠内墙', quote, sourceMessageId: '4', expectedVersion: stored.version }, { id: '4', text }, 'correction', '');
    const available = (facts: NeedFact[]) => currentNeedView({ ...next, facts, interpretations: needInterpretations(next, facts) });
    const view = available(next.facts), withdrawn = available(next.facts.filter(f => f.sourceMessageId !== '4'));
    assert.deepEqual(view.effectiveDeskPositions, [{ room: '书房', currentFactId: 'correction', value: '靠内墙', sourceMessageId: '4' }]);
    assert.deepEqual(view.facts.filter(f => f.field === 'desk').map(f => f.value), ['靠内墙']);
    assert.deepEqual(withdrawn.effectiveDeskPositions, [{ room: '书房', currentFactId: null, value: null, sourceMessageId: null }]);
    assert.equal(withdrawn.facts.some(f => f.field === 'desk'), false);
    for (const remaining of ['保留收纳', '不要投影设备', '装修日期未定']) assert.ok(view.facts.some(f => f.value === remaining) && withdrawn.facts.some(f => f.value === remaining));
    assert.equal(view.historicalFacts[0].value, '书房书桌靠窗');
  }
  assert.equal(JSON.stringify(stored), before, 'read interpretation does not rewrite persisted history');
  const otherRoom: NeedFact = { ...stored.facts[0], id: 'other', room: '次卧', value: '靠内墙', quote: '次卧书桌从靠窗改为靠内墙', sourceMessageId: '4' };
  assert.deepEqual(needInterpretations({ ...stored, facts: [...stored.facts, otherRoom] }, [...stored.facts, otherRoom]), []);
});

test('legacy desk position correction qualifies only the old position across a compound other row and a mislabeled style row', () => {
  const base: NeedFact = { id: 'old', room: '', field: 'other', value: '书房书桌靠窗，书房需要收纳。', quote: '请记下：书房书桌靠窗，书房需要收纳。', sourceMessageId: '1', provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: 'now' };
  const next: NeedFact = { ...base, id: 'next', room: '书房', field: 'style', value: '靠内墙', quote: '更正：书房书桌改为靠内墙；全屋预算改为18万元。其他需求保持原样。', sourceMessageId: '3' };
  const memory: NeedMemory = { version: 2, facts: [base,next] }, before = JSON.stringify(memory);
  assert.deepEqual(needInterpretations(memory, [base,next]), [{ factId: 'old', field: 'desk', room: '书房', currentFactId: 'next' }]);
  assert.deepEqual(needInterpretations(memory, [base]), [{ factId: 'old', field: 'desk', room: '书房', currentFactId: null }]);
  assert.deepEqual(needQualifications(base, [base,next], new Map([['1',base.quote],['3',next.quote]])), [{ factId: 'next', field: 'desk', room: '书房', value: '靠内墙', sourceMessageId: '3' }]);
  assert.equal(JSON.stringify(memory), before, 'Read projection never rewrites the durable quote, key or independent storage assertion');
  const view = currentNeedView({ ...memory, interpretations: needInterpretations(memory, memory.facts) });
  assert.equal(view.facts.find(f => f.id === 'old')?.value, '书房需要收纳'); assert.equal(view.facts.find(f => f.id === 'next')?.field, 'desk');
  assert.deepEqual(view.historicalFacts, [base]); assert.equal(JSON.stringify(memory), before);
  const hidden = currentNeedView({ version: 2, facts: [base], interpretations: needInterpretations(memory, [base]) });
  assert.equal(hidden.facts[0].value, '书房需要收纳'); assert.doesNotMatch(JSON.stringify(hidden), /靠内墙/);
  for (const unrelated of [{ ...next, room: '客厅' }, { ...next, sourceMessageId: '1' }, { ...next, quote: '书房墙面改为浅绿', value: '浅绿' }]) assert.deepEqual(needInterpretations({ version: 2, facts: [base,unrelated] }, [base,unrelated]), []);
});
test('legacy desk position uses the latest explicit correction even when it returns to an older value and never leaks an unavailable correction', () => {
  const old: NeedFact = { id: 'old', room: '', field: 'other', value: '书房书桌靠窗，书房需要收纳', quote: '请记下：书房书桌靠窗，书房需要收纳', sourceMessageId: '1', provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: 'now' };
  const middle: NeedFact = { ...old, id: 'middle', room: '书房', field: 'style', value: '靠内墙', quote: '更正：书房书桌改为靠内墙', sourceMessageId: '3' };
  const latest: NeedFact = { ...middle, id: 'latest', field: 'desk', value: '靠窗', quote: '更正：书房书桌改为靠窗', sourceMessageId: '5' };
  const stored: NeedMemory = { version: 3, facts: [old,middle,latest] };
  const memory = { ...stored, interpretations: needInterpretations(stored, stored.facts) };
  assert.deepEqual(effectiveDeskPositions(memory), [{ room: '书房', currentFactId: 'latest', value: '靠窗', sourceMessageId: '5' }]);
  assert.equal(needDeskPositionFeedback(JSON.stringify({ text: '书房书桌当前靠窗。' }), memory, '只回顾本次聊天原话，给出当前需求。'), null);
  const hidden = { version: 3, facts: [old,middle], interpretations: needInterpretations(stored, [old,middle]) };
  assert.deepEqual(effectiveDeskPositions(hidden), [{ room: '书房', currentFactId: null, value: null, sourceMessageId: null }]);
  assert.ok(needDeskPositionFeedback(JSON.stringify({ text: '书房书桌当前靠窗。' }), hidden, '只回顾本次聊天原话，给出当前需求。'));
});
test('legacy desk position repair separates actual current assertions from historical quotations, transitions and denials', () => {
  const old: NeedFact = { id: 'old', room: '', field: 'other', value: '书房书桌靠窗，书房需要收纳', quote: '请记下：书房书桌靠窗，书房需要收纳', sourceMessageId: '1', provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: 'now' };
  const next: NeedFact = { ...old, id: 'next', room: '书房', field: 'style', value: '靠内墙', quote: '更正：书房书桌改为靠内墙', sourceMessageId: '3' };
  const stored = { version: 2, facts: [old,next] }, memory = { ...stored, interpretations: needInterpretations(stored, stored.facts) }, question = '只回顾本次聊天原话，给出当前需求和旧说法的区别。';
  for (const text of ['书房书桌现在仍靠窗。', '书房以前靠窗，但现在还是靠窗。', '书桌当前靠窗，收纳保留。', '书房书桌从靠窗改为了靠内墙，但书桌目前还是靠窗。']) assert.ok(needDeskPositionFeedback(JSON.stringify({ text }), memory, question), text);
  for (const text of ['书房原话是书桌靠窗，现在书房书桌靠内墙，收纳保留。', '书房书桌不是靠窗，而是靠内墙。', '书房书桌从靠窗改为靠内墙。', '书房的书桌位置从靠窗改为了靠内墙。', '书房书桌由靠窗改成了靠内墙。', '客厅书桌靠窗。']) assert.equal(needDeskPositionFeedback(JSON.stringify({ text }), { ...memory, facts: [...memory.facts, { ...old, id: 'living', room: '客厅', sourceMessageId: '2' }] }, question), null, text);
  assert.equal(needDeskPositionFeedback(JSON.stringify({ text: '书房书桌靠窗。' }), memory, '只回顾最初聊天原话，不查工地。'), null);
  const hidden = { version: 2, facts: [old], interpretations: needInterpretations(stored, [old]) };
  assert.ok(needDeskPositionFeedback(JSON.stringify({ text: '书房书桌现在靠内墙。' }), hidden, question));
  assert.ok(needDeskPositionFeedback(JSON.stringify({ text: '书房不能确认靠内墙。' }), hidden, question), 'An unprovided location is not a supported historical quotation or a requested alternative');
});
test('an unavailable desk read reconstructs only its supported partial state without old values or unrelated rooms', () => {
  const old: NeedFact = { id: 'old', room: '', field: 'other', value: '书房书桌靠窗，书房需要收纳', quote: '请记下：书房书桌靠窗，书房需要收纳', sourceMessageId: '1', provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: 'now' };
  const next: NeedFact = { ...old, id: 'next', room: '书房', field: 'style', value: '靠内墙', quote: '更正：书房书桌改为靠内墙', sourceMessageId: '3' };
  const stored = { version: 2, facts: [old,next] }, available = { version: 2, facts: [old,{ ...old, id: 'living', room: '客厅', value: '不做开放柜' }], interpretations: needInterpretations(stored, [old]) };
  const text = unavailableDeskReply(available, '只回顾本次聊天原话，书房书桌现在的位置和仍可沿用的要求是什么？');
  assert.match(text!, /本次无法确认/); assert.match(text!, /书房需要收纳/); assert.doesNotMatch(text!, /靠窗|靠内墙|客厅|开放柜/);
  assert.equal(unavailableDeskReply({ ...stored, interpretations: needInterpretations(stored, stored.facts) }, '只回顾本次聊天原话，书房书桌现在的位置是什么？'), null);
  assert.equal(unavailableDeskReply(available, '只回顾最初聊天原话，书桌当时怎么摆？'), null);
  assert.equal(unavailableDeskReply(available, '按工地资料解释当前书桌施工条件。'), null);
});

test('direct receipt intent is confined to explicit pure recording and excludes mixed or untrusted actions', () => {
  for (const text of ['请记下：书房书桌靠窗，书房需要收纳', '更正：书房书桌改为靠内墙；全屋预算改为18万元。其他需求保持原样。']) {
    assert.equal(explicitNeedRecordOnly(text), true, text);
  }
  for (const text of ['把另一间的书桌也改一下，先确认具体房间再记录', '请记下书桌靠窗，可以吗？', '请记下：如果书房要办公就靠窗', '请记下：书房书桌靠窗；另外插座怎么确定？', '请记录设计师说书桌靠窗', '请记下：书桌靠窗，不要记录预算', '请记录其他客户的预算', '请记下：书房书桌靠窗，并发布正式方案', '只回顾本次聊天原话', '请记录：先确认具体房间再保存', '请记录我喜欢第一张参考图']) {
    assert.equal(explicitNeedRecordOnly(text), false, text);
  }
});

test('direct receipt lists only current authorized facts from this exact run and trigger', () => {
  const fact: NeedFact = { id: '9:0:0', room: '书房', field: 'desk', value: '书桌靠窗', quote: '书房书桌靠窗', sourceMessageId: '2', provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: 'now' };
  const memory: NeedMemory = { version: 4, facts: [fact, { ...fact, id: '90:0:0', value: '收纳' }, { ...fact, id: '9:0:1', sourceMessageId: '1', value: '预算18万元' }, { ...fact, id: '9:0:2', status: 'superseded', value: '靠内墙' }] };
  const actual = recordedNeedReceipt(memory, '9', '2');
  assert.deepEqual(actual?.facts, [fact]); assert.match(actual!.text, /书房：书桌靠窗/);
  assert.doesNotMatch(actual!.text, /收纳|18万元|靠内墙/); assert.match(actual!.text, /未列出的内容不视为已保存/);
  assert.equal(recordedNeedReceipt({ version: 4, facts: [] }, '9', '2'), null);
  assert.equal(recordedNeedReceipt(memory, '8', '2'), null);
});

test('explicit scoped recording rejects missing values without extracting or authorizing new needs', () => {
  const desk = { room: '书房', field: 'desk' as const, value: '书桌靠窗', quote: '书房书桌靠窗' };
  const source = '请记下：书房书桌靠窗，书房需要收纳。';
  assert.deepEqual(uncoveredNeedStatements(source, [desk]), ['书房需要收纳']);
  assert.deepEqual(uncoveredNeedStatements(source, [{ ...desk, quote: source }]), ['书房需要收纳'], 'A broad quote cannot conceal a missing persisted value');
  const feedback = needWriteFeedback(new NeedWriteIncompleteError(['书房需要收纳', '非当前来源']), source);
  assert.equal(feedback?.batchCommitted, false);
  assert.deepEqual(feedback?.missingStatements, ['书房需要收纳']);
  assert.deepEqual(uncoveredNeedStatements(source, [desk, { room: '书房', field: 'storage', value: '需要收纳', quote: '书房需要收纳' }]), []);
  assert.deepEqual(uncoveredNeedStatements('请记录：书房书桌靠窗，客厅不做开放柜，全屋预算18万元', [desk]), ['客厅不做开放柜', '全屋预算18万元']);
  assert.deepEqual(uncoveredNeedStatements('请记下：书房书桌靠窗，客厅书桌靠窗', [desk]), ['客厅书桌靠窗'], 'The same value in a different room is independently required');
  assert.deepEqual(uncoveredNeedStatements('请记录：主卧室需要衣柜，客厅需要餐厅收纳', [{ room: '主卧室', field: 'storage', value: '需要衣柜', quote: '主卧室需要衣柜' }, { room: '客厅', field: 'storage', value: '需要餐厅收纳', quote: '客厅需要餐厅收纳' }]), [], 'A later noun cannot change the explicit leading room');
  assert.deepEqual(uncoveredNeedStatements('请记下：书房书桌靠窗。其他需求保持原样。', [desk]), []);
  for (const text of ['书房书桌靠窗，书房需要收纳吗？', '请记下：如果书房书桌靠窗，书房需要收纳', '请记下：书房书桌靠窗，另外插座怎么确定？', '请记录设计师说书房需要收纳', '请记下：书房书桌靠窗，不要记录预算']) assert.deepEqual(uncoveredNeedStatements(text, [desk]), [], text);
});
import { parseAgentReply } from '../agent/context';

test('formal site completion claims require a business receipt while explicit absence/denial remains usable', () => {
  for (const text of ['已经落实。','事项已正式解决。','本事项已关闭。','关闭成功。','工程已验收。','我不能说已解决，但事项已关闭。'])
    assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text })), /unsupported_model_commitment/);
  for (const text of ['目前没有已正式关闭的记录，仍需团队核对。','我不能声称已解决。','照片不能代替验收，当前尚未关闭。'])
    assert.equal(parseAgentReply(JSON.stringify({ kind: 'general', text })), text);
});
test('source-linked field corrections preserve independent facts and immutable correction chain', () => {
  let memory = readMemory({});
  for (const [i, room, field, value] of [[1,'书房','daylight','采光好'],[2,'书房','desk','单人桌'],[3,'次卧','use','客房'],[4,'书房','desk','双人桌']] as const) {
    const text = room + '要' + value;
    memory = applyNeedDelta(memory, parseNeedDelta({ room, field, value, quote: text, sourceMessageId: String(i), expectedVersion: memory.version }),
      { id: String(i), text }, String(i), '2026-10-16');
  }
  assert.deepEqual(memory.facts.filter(f => f.status === 'current').map(f => f.value), ['采光好','客房','双人桌']);
  assert.equal(memory.facts[3].supersedes, '2'); assert.equal(memory.facts[1].value, '单人桌');
});

test('repeated corrections cross the old cumulative 300 limit without dropping independent current needs or history', () => {
  let memory = readMemory({});
  const archived: NeedFact[] = [];
  for (let i = 1; i <= 650; i++) {
    const room = i === 1 ? '厨房' : '书房', field = i === 1 ? 'devices' : 'desk', value = `方案${i}号桌`;
    const text = `${room}要${value}`;
    const next = applyNeedDelta(memory, { room, field, value, quote: text, sourceMessageId: String(i), expectedVersion: memory.version },
      { id: String(i), text }, `op:${i}`, '2026-10-19');
    const compacted = compactNeedMemory(next); archived.push(...compacted.archivedFacts); memory = compacted.memory;
    assert.ok(memory.facts.length <= needMemoryPolicy.compactAfterFacts);
  }
  const all = [...archived, ...memory.facts];
  assert.equal(all.length, 650); assert.equal(memory.version, 650);
  assert.deepEqual(memory.facts.filter(f => f.status === 'current').map(f => f.id), ['op:1', 'op:650']);
  assert.equal(new Set(all.map(f => f.id)).size, 650);
  for (let i = 3; i <= 650; i++) assert.equal(all.find(f => f.id === `op:${i}`)!.supersedes, `op:${i - 1}`);
  assert.ok(archived.every(f => f.status === 'superseded' && f.quote === `书房要${f.value}`));
});

test('a full current projection permits corrections but rejects the 301st distinct key without eviction', () => {
  const facts: NeedFact[] = Array.from({ length: 300 }, (_, i) => ({ id: `old:${i}`, room: `房间${i}`, field: 'desk', value: '靠窗',
    quote: `房间${i}靠窗`, sourceMessageId: String(i + 1), provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: '' }));
  const memory: NeedMemory = { version: 300, facts };
  const text = '房间0改为靠门';
  const updated = applyNeedDelta(memory, { room: '房间0', field: 'desk', value: '靠门', quote: text, sourceMessageId: '301', expectedVersion: 300 },
    { id: '301', text }, 'new', '');
  const compacted = compactNeedMemory(updated);
  assert.equal(compacted.memory.facts.length, 300); assert.deepEqual(compacted.archivedFacts, [{ ...facts[0], status: 'superseded' }]);
  assert.equal(compacted.memory.facts.at(-1)!.supersedes, facts[0].id);
  assert.deepEqual(memory, { version: 300, facts });
  const extra = '新房间靠窗';
  assert.throws(() => applyNeedDelta(memory, { room: '新房间', field: 'desk', value: '靠窗', quote: extra, sourceMessageId: '301', expectedVersion: 300 },
    { id: '301', text: extra }, 'extra', ''), /need_memory_limit/);
  assert.equal(compactNeedMemory(memory).memory, memory);
});

test('current desk corrections are not reopened as a conflict with historical wording during chat-only recall', () => {
  const memory: NeedMemory = { version: 302, facts: [{ id: 'new', room: '书房', field: 'desk', value: '靠内墙', quote: '书房书桌靠内墙',
    sourceMessageId: '302', provenance: 'customer_statement', status: 'current', supersedes: 'old', createdAt: '' }] };
  const question = '请只回顾聊天原话，不查图纸或项目进度：书房书桌原来和现在的位置有什么差别？';
  for (const text of ['书桌位置以哪一版为准，需要您确认后再由团队核对。',
    '现在书房书桌是靠内墙，与更正时说的靠门表述不一致，这一处需要您确认以哪个为准。']) {
    assert.ok(needReconfirmationFeedback(JSON.stringify({ kind: 'general', text }), memory, question));
    assert.ok(needReconfirmationFeedback(JSON.stringify({ kind: 'synthesis', segments: [{ text }] }), memory, question));
  }
  for (const text of ['书桌现在靠内墙，早先靠窗的需求已被更正，不用您再次确认。',
    '书桌的正式方案需要您确认以哪一版为准。', '现在的位置暂无获权原话，仍需核对。'])
    assert.equal(needReconfirmationFeedback(JSON.stringify({ text }), memory, question), null);
  const repeated = JSON.stringify({ text: '书桌位置以哪一版为准，需要您确认。' });
  assert.equal(needReconfirmationFeedback(repeated, { version: 302, facts: [] }, question), null);
  assert.equal(needReconfirmationFeedback(repeated, memory, '请查正式图纸需要同意哪一版？'), null);
});
test('a save acknowledgement requires this run committed memory or preference operation', () => {
  const source = { id: '1', text: '书房单人办公' }, empty = readMemory({});
  const saved = applyNeedDelta(empty, parseNeedDelta({ room: '书房', field: 'use', value: '单人办公', quote: source.text,
    sourceMessageId: source.id, expectedVersion: 0 }), source, '9:0:0', '');
  for (const text of ['已记录书房需求。', '我已经保存。', '书房人数已按你的更正记为单人办公。', '书房人数已按你的更正更新为单人办公。']) {
    assert.throws(() => assertRecordedReply(text, empty, '9'), /unsupported_model_commitment/);
    assert.throws(() => assertRecordedReply(text, saved, '90'), /unsupported_model_commitment/);
    assert.throws(() => assertRecordedReply(text, empty, '9', ['90:0:0']), /unsupported_model_commitment/);
    assertRecordedReply(text, saved, '9'); assertRecordedReply(text, empty, '9', ['9:preference']);
  }
  assertRecordedReply('沿用原工作记录，正式方案仍另行核对。', saved, '90');
  assertRecordedReply('当前正式方案已更新为新版本。', empty, '90');
});
test('conditional recording clarification does not claim a completed save', () => {
  const empty = readMemory({});
  for (const text of ["您提到需要修改另一间的书桌，但尚未明确具体是哪一间。请先告诉我具体是哪一间房间的书桌需要修改，我才能帮您记录需求。",
    '请先告诉我具体房间，我才会帮你保存这条需求。', '先说明是哪间房，小K才能帮您记录对应需求。']) {
    assert.doesNotThrow(() => assertRecordedReply(text, empty, '90'), text);
  }
});
test('conditional recording transition wording is future scoped and retains a separate save claim', () => {
  const empty = readMemory({});
  for (const text of ['请先确认具体是哪一间房间的书桌需要改动，然后我们可以帮您记录需求。',
    '先确认房间，所以我们就能帮您记录对应需求。', '明确房间后，再帮您记录这条需求。']) {
    assert.doesNotThrow(() => assertRecordedReply(text, empty, '90'), text);
    assert.throws(() => assertRecordedReply(text + '我已保存预算。', empty, '90'), /unsupported_model_commitment/);
  }
  for (const text of ['然后我们已经帮您记录需求。', '然后我们可以帮您记录好了需求。',
    '然后我们可以帮您记录需求吗？', '并不是然后我们可以帮您记录需求。']) {
    assert.throws(() => assertRecordedReply(text, empty, '90'), /unsupported_model_commitment/, text);
  }
});
test('conditional recording projection preserves independent completed saves and unscoped claims', () => {
  const empty = readMemory({}), conditional = "您提到需要修改另一间的书桌，但尚未明确具体是哪一间。请先告诉我具体是哪一间房间的书桌需要修改，我才能帮您记录需求。";
  for (const text of [conditional + '我已记录预算。', '我已经保存需求。' + conditional,
    '并不是我才能帮您记录需求。', '我才能帮您记录需求吗？', '我才能帮您记录好了需求。',
    '我会帮您记录需求。', '帮您保存需求。']) {
    assert.throws(() => assertRecordedReply(text, empty, '90'), /unsupported_model_commitment/, text);
  }
});
test('not asking again about saved needs does not acknowledge a new save or hide an independent write claim', () => {
  const source = { id: '1', text: '书房单人办公' }, empty = readMemory({});
  const saved = applyNeedDelta(empty, parseNeedDelta({ room: '书房', field: 'use', value: '单人办公', quote: source.text,
    sourceMessageId: source.id, expectedVersion: 0 }), source, '9:0:0', '');
  const reference = '暂时不用你重复确认已保存的单人办公、靠窗和设备需求。';
  assertRecordedReply(reference, saved, '90');
  for (const text of [reference + '我已保存新的需求。', '我已记录。' + reference,
    '不用你重复确认，我已保存。', '不用你确认已保存。', '我已经保存的书房需求是单人办公。'])
    assert.throws(() => assertRecordedReply(text, saved, '90'), /unsupported_model_commitment/);
  assertRecordedReply(reference + '我已保存新的需求。', saved, '9');
});

test('a direct correction before a new professional question is distinct from a proposal or another speaker', () => {
  assert.equal(hasExplicitNeedCorrection('更正一下，书房改为单人办公，设备不变。底盒现在怎样核对？'), true);
  for (const text of ['如果书房改为单人办公，该怎么做？', '更正一下，书房可以改为单人办公吗？',
    '他说“更正一下，书房改为单人办公”。这样可以吗？', '更正一下，假设书房改为单人办公。会怎样？',
    '更正一下，书房改为单人办公。不要记录，只是讨论。']) assert.equal(hasExplicitNeedCorrection(text), false, text);
});

test('bounded memory batches reject duplicate fields, nested authority and more than four facts', () => {
  const first = { room: '书房', field: 'desk', value: '靠窗', quote: '书房靠窗' };
  assert.deepEqual(parseNeedWrites(first), [first]);
  assert.deepEqual(parseNeedWrites({ ...first, additionalNeeds: [] }), [first]);
  assert.equal(parseNeedWrites({ ...first, additionalNeeds: [{ ...first, field: 'devices' }] }).length, 2);
  for (const additionalNeeds of [[first], [{ ...first, field: 'devices', tenantId: '2' }], Array.from({ length: 4 }, () => first)])
    assert.throws(() => parseNeedWrites({ ...first, additionalNeeds }), /invalid_message/);
});

test('an explicit correction before a separate comma-delimited question remains writable without saving that question', () => {
  const text = '更正一下，书房改为单人办公，书房书桌改为靠内墙，另外如果厨房加洗碗机，水电要怎么核对？';
  assert.equal(hasExplicitNeedCorrection(text), true);
  assert.equal(hasExplicitNeedCorrection('更正一下，书房改为单人办公，另外如果厨房加洗碗机，进排水一般要考虑什么？'), true);
  assert.equal(hasExplicitNeedCorrection('更正一下，书房改为单人办公，另外厨房加洗碗机对进排水的影响？'), true);
  let memory = readMemory({});
  for (const [field, value, quote] of [
    ['use', '单人办公', '书房改为单人办公'], ['desk', '靠内墙', '书房书桌改为靠内墙'],
  ] as const) {
    memory = applyNeedDelta(memory, { room: '书房', field, value, quote, sourceMessageId: '1', expectedVersion: memory.version },
      { id: '1', text }, `mixed:${field}`, '');
  }
  assert.deepEqual(memory.facts.map(f => f.value), ['单人办公', '靠内墙']);
  for (const quote of ['厨房加洗碗机', text]) {
    assert.throws(() => applyNeedDelta(memory, { room: '厨房', field: 'devices', value: '洗碗机', quote,
      sourceMessageId: '1', expectedVersion: memory.version }, { id: '1', text }, 'hypothesis', ''), /need_source_mismatch/);
  }
  assert.throws(() => applyNeedDelta(memory, { room: '厨房', field: 'use', value: '单人办公', quote: '书房改为单人办公',
    sourceMessageId: '1', expectedVersion: memory.version }, { id: '1', text }, 'wrong-room', ''), /need_source_mismatch/);
});

test('separate-question boundaries never strip a condition, quotation or refusal from the correction itself', () => {
  for (const text of [
    '更正一下，如果预算允许，书房改为单人办公，另外厨房水电怎么核对？',
    '更正一下，设计师说书房改为单人办公，另外厨房水电怎么核对？',
    '更正一下，书房可以改为单人办公吗，另外厨房水电怎么核对？',
    '更正一下，书房改为单人办公，另外如果预算允许才按刚才的更正，可以吗？',
    '更正一下，书房改为单人办公，另外厨房水电怎么核对？不要记录。',
  ]) {
    assert.equal(hasExplicitNeedCorrection(text), false, text);
    assert.throws(() => applyNeedDelta(readMemory({}), { room: '书房', field: 'use', value: '单人办公', quote: '书房改为单人办公',
      sourceMessageId: '1', expectedVersion: 0 }, { id: '1', text }, 'not-authorized', ''), /need_source_mismatch/, text);
  }
});

test('a later explicit use correction qualifies only occupancy in an older mixed desk statement', () => {
  const old: NeedFact = { id: 'old', room: '书房', field: 'desk', value: '书桌靠窗，偶尔双人办公', quote: '书房书桌靠窗，偶尔双人办公', sourceMessageId: '1',
    provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: '' };
  const current: NeedFact = { ...old, id: 'current', field: 'use', value: '单人办公', quote: '书房改为单人办公', sourceMessageId: '2' };
  const originals = new Map([['2','更正一下，书房改为单人办公，电脑和台灯不变。底盒怎样核对？']]);
  assert.deepEqual(needQualifications(old, [old,current], originals), [{ factId: 'current', field: 'use', value: '单人办公', sourceMessageId: '2' }]);
  for (const candidate of [{ ...current, room: '厨房' }, { ...current, status: 'superseded' as const }, { ...current, sourceMessageId: '1' }])
    assert.deepEqual(needQualifications(old, [old,candidate], originals), []);
  assert.deepEqual(needQualifications({ ...old, value: '双人长桌' }, [current], originals), [], 'occupancy does not replace furniture form');
  assert.deepEqual(needQualifications(old, [current], new Map([['2','方案建议书房单人办公，还没有决定。']])), []);
  assert.equal(old.value, '书桌靠窗，偶尔双人办公');
  assert.deepEqual(needInterpretations({ version: 2, facts: [old,current] }, [old,current]), [{ factId: 'old', field: 'use', currentFactId: 'current' }]);
  const suppressed = needInterpretations({ version: 2, facts: [old,current] }, [old]);
  assert.deepEqual(suppressed, [{ factId: 'old', field: 'use', currentFactId: null }]);
  assert.doesNotMatch(JSON.stringify(suppressed), /单人办公|sourceMessageId/);
});

test('an original value spanning clauses is validated in its complete source context, without promoting a separate proposal', () => {
  const text = '请记录：书房书桌靠窗；书房偶尔双人办公；厨房为封闭式。';
  const delta = parseNeedDelta({ room: '书房', field: 'desk', value: '书房书桌靠窗；书房偶尔双人办公', quote: text, sourceMessageId: '1', expectedVersion: 0 });
  assert.equal(applyNeedDelta(readMemory({}), delta, { id: '1', text }, 'legacy', '').facts.length, 1);
  assert.throws(() => applyNeedDelta(readMemory({}), { ...delta, quote: '如果' + text }, { id: '1', text: '如果' + text }, 'hypothesis', ''), /need_source_mismatch/);
  const mixed = '请记录书房电脑和台灯；方案写的是书房单人办公，仍待我决定。';
  const devices = parseNeedDelta({ room: '书房', field: 'devices', value: '电脑和台灯', quote: mixed, sourceMessageId: '2', expectedVersion: 0 });
  assert.equal(applyNeedDelta(readMemory({}), devices, { id: '2', text: mixed }, 'explicit', '').facts[0].value, '电脑和台灯');
});

test('even an explicit recording request cannot promote hypothetical or reported content into a customer fact', () => {
  for (const text of ['请记录：如果书房改单人办公，我会怎样布置？', '请记录：方案写的是书房单人办公，还待我决定。',
    '请记录：设计师说书房单人办公，这是建议。', '书房单人办公。不要记录。']) {
    const delta = parseNeedDelta({ room: '书房', field: 'use', value: '单人办公', quote: text, sourceMessageId: '1', expectedVersion: 0 });
    assert.throws(() => applyNeedDelta(readMemory({}), delta, { id: '1', text }, 'new', ''), /need_source_mismatch/, text);
  }
});

test('unresolved room references cannot be saved under an empty or pronoun room, even with an abbreviated quote', () => {
  const memory = readMemory({});
  const source = { id:'1',text:'那间房改成三人书桌，请记录。' };
  for (const room of ['', '那间房']) for (const quote of [source.text,'三人书桌']) {
    const delta = parseNeedDelta({ room,field:'desk',value:'三人书桌',quote,sourceMessageId:'1',expectedVersion:0 });
    assert.throws(() => applyNeedDelta(memory,delta,source,'new',''), error => {
      const feedback=needWriteFeedback(error,source.text);
      assert.equal(feedback?.error,'need_room_ambiguous');
      assert.match(feedback!.instructions,/没有保存任何需求/);
      return true;
    });
  }
  assert.deepEqual(memory,{version:0,facts:[]});
  const text='是次卧，次卧改成三人书桌，请记录。';
  const saved=applyNeedDelta(memory,parseNeedDelta({room:'次卧',field:'desk',value:'三人书桌',quote:text,sourceMessageId:'2',expectedVersion:0}),{id:'2',text},'confirmed','');
  assert.equal(saved.facts[0].room,'次卧');
  assert.equal(needWriteFeedback(Error('network'),source.text),null);
});

test('confirm-before-recording remains nonmutating while explicit whole-home budgets remain valid', () => {
  const text='放双人桌的那间，请先确认房间再记录。';
  assert.throws(()=>applyNeedDelta(readMemory({}),parseNeedDelta({room:'',field:'desk',value:'双人桌',quote:text,sourceMessageId:'1',expectedVersion:0}),{id:'1',text},'1',''),/need_room_ambiguous/);
  const budget='总预算二十万元，请记录。';
  assert.equal(applyNeedDelta(readMemory({}),parseNeedDelta({room:'',field:'budget',value:'二十万元',quote:budget,sourceMessageId:'1',expectedVersion:0}),{id:'1',text:budget},'1','').facts[0].value,'二十万元');
});

test('free-form replies cannot turn a customer budget into a guaranteed enterprise price', () => {
  assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text: '已经帮你联系设计师并且预约成功。' })), /unsupported_model_commitment/);
  assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text: '我保证最终只要一万元。' })), /unsupported_model_commitment/);
  assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text: '可以承诺包干价为一万元。' })), /unsupported_model_commitment/);
  assert.equal(parseAgentReply(JSON.stringify({ kind: 'unavailable', text: '没有正式报价依据，无法保证最终只要一万元。' })), '没有正式报价依据，无法保证最终只要一万元。');
  const clarification = '您还没确定具体预算，想好金额后告诉我。';
  assert.equal(parseAgentReply(JSON.stringify({ kind: 'general', text: clarification })), clarification);
  assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text: '我确定最终费用为10万元。' })), /unsupported_model_commitment/);
});
test('memory rejects model inventions, ambiguous rooms, stale versions and unexpected authority fields', () => {
  const d = { room: '书房', field: 'desk', value: '双人桌', quote: '书房要双人桌', sourceMessageId: '1', expectedVersion: 0 };
  assert.throws(() => parseNeedDelta({ ...d, approved: true }), /invalid_message/);
  const delta = parseNeedDelta(d), source = { id: '1', text: '书房要双人桌' };
  assert.throws(() => applyNeedDelta(readMemory({}), delta, { ...source, text: '那个房间大一点' }, '1', ''), /need_source_mismatch/);
  assert.throws(() => applyNeedDelta(readMemory({}), { ...delta, value: '三人桌' }, source, '1', ''), /need_source_mismatch/);
  const question = '书房怎么摆桌？';
  assert.throws(() => applyNeedDelta(readMemory({}), { ...delta, value: question, quote: question }, { id: '1', text: question }, '1', ''), /need_source_mismatch/);
  const saved = applyNeedDelta(readMemory({}), delta, source, '1', '');
  assert.equal(applyNeedDelta(saved, delta, source, '1', ''), saved);
  assert.throws(() => applyNeedDelta(saved, delta, source, '2', ''), /version_conflict/);
});

test('explicit absence of an approval record is allowed without exempting a later real commitment', () => {
  for (const text of ['我没有任何已批准的结果。', '不存在已预约的记录。']) {
    assert.equal(parseAgentReply(JSON.stringify({ kind: 'general', text })), text);
  }
  for (const text of ['我没有任何已批准的结果，但现在已经批准。', '不存在已预约的记录，但预约成功。', '已批准的结果没有问题。']) {
    assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text })), /unsupported_model_commitment/);
  }
});

test('negated speech permits quoted statuses but never excuses a positive or double-negated commitment', () => {
  for (const text of ['没有真实结果，所以不能对外说“已预约”或任何完成状态。', '我不会替您承诺“已预约”或“已联系”。', '我无法确认已经付款。']) {
    assert.equal(parseAgentReply(JSON.stringify({ kind: 'general', text })), text);
  }
  for (const text of ['我不能说已预约，但我已经联系设计师。', '我不是不能说已预约。', '不能声称已批准；但现在批准了，已提交。', '我已预约。请不要说没有。', '客户要求我不能说别的，我已预约。']) {
    assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text })), /unsupported_model_commitment/);
  }
});

test('a refusal sentence cannot combine with a later cost explanation to become a price promise', () => {
  const text = '这个我没法给您保证。装修费用取决于面积和现场情况。';
  assert.equal(parseAgentReply(JSON.stringify({ kind: 'general', text })), text);
  assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text: '我保证，最终报价一万元。' })), /unsupported_model_commitment/);
});
