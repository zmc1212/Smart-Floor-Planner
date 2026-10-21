import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyNeedDelta, explicitNeedRecordOnly, readMemory, parseNeedWrites, uncoveredNeedStatements } from '../agent/memory';
import { agentToolsForMessage } from '../agent/worker';

const readOnlyInputs = [
  '手测追问03：关于书桌收纳分类，请给一个一般选择建议。这是独立问题，不新增或修改我的需求。',
  '请记住书房要收纳；不要新增或修改我的需求。',
  '书房需要阅读灯，但无需更新当前需求。',
  '我想问客厅阅读灯的选择',
  '我想了解客厅阅读灯的选择',
  '请问客厅阅读灯怎么选',
];

test('ordinary inquiries and explicit no-change instructions expose reads without a memory-write tool', () => {
  for (const text of readOnlyInputs) {
    const tools = agentToolsForMessage(text, true).map(t => t.name);
    assert.ok(!tools.includes('record_need'), text);
    assert.ok(tools.includes('recall_history'), text);
    assert.ok(tools.includes('search_knowledge'), text);
    assert.equal(explicitNeedRecordOnly(text), false, text);
  }
});

test('a selected quote cannot bypass the durable no-change or inquiry boundary', () => {
  for (const text of readOnlyInputs) {
    const room = text.includes('客厅') ? '客厅' : '书房';
    const value = text.includes('阅读灯') ? '阅读灯' : '收纳';
    const memory = readMemory(null), before = JSON.stringify(memory);
    assert.throws(() => applyNeedDelta(memory, {
      room, field: 'devices', value, quote: value, sourceMessageId: '1', expectedVersion: 0,
    }, { id: '1', text }, 'operation', 'now'), /need_source_mismatch/, text);
    assert.equal(JSON.stringify(memory), before, text);
  }
});

test('direct needs and a leading explicit correction retain their original write path', () => {
  for (const text of ['客厅需要阅读灯', '请记下：客厅需要阅读灯', '更正：客厅阅读灯改为暖白，另外我想问阅读灯的选择？']) {
    assert.ok(agentToolsForMessage(text, true).some(t => t.name === 'record_need'), text);
    const value = text.includes('暖白') ? '暖白' : '阅读灯';
    const memory = applyNeedDelta(readMemory(null), {
      room: '客厅', field: 'devices', value, quote: text.includes('暖白') ? '客厅阅读灯改为暖白' : '客厅需要阅读灯',
      sourceMessageId: '1', expectedVersion: 0,
    }, { id: '1', text }, 'operation', 'now');
    assert.equal(memory.version, 1);
    assert.equal(memory.facts[0].value, value);
  }
});

test('complete verbatim compound values keep coverage while a separate room remains missing', () => {
  const text = '请记录书房靠窗，偶尔两人办公';
  const writes = parseNeedWrites({ room: '书房', field: 'desk', value: '靠窗，偶尔两人办公', quote: text });
  assert.deepEqual(uncoveredNeedStatements(text, writes), []);
  assert.deepEqual(uncoveredNeedStatements(text + '；客厅需要阅读灯', writes), ['客厅需要阅读灯']);
});
