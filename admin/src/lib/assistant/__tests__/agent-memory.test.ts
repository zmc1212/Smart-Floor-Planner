import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyNeedDelta, parseNeedDelta, parseNeedWrites, readMemory, needWriteFeedback, hasExplicitNeedCorrection, needQualifications, needInterpretations, assertRecordedReply, type NeedFact } from '../agent/memory';
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
