import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentToolsForMessage } from '@/lib/assistant/agent/worker';
import { contactInput, defaultConstructionStages, stagesInput } from '../stages';
import { followUpKnown } from '../follow-ups';

test('visit messages can query the real stage but cannot register, reschedule or cancel a construction booking', () => {
  for (const message of ['周六想去看看', '我想去工地看看', '取消到场安排', '联系管家', '现在到哪个施工节点了']) {
    const tools = agentToolsForMessage(message, true);
    assert.ok(tools.some(t => t.name === 'query_business'), message);
    assert.ok(!tools.some(t => t.name === 'request_visit'), message);
  }
});
test('stage questions are optional, bounded and room-specific without creating an approval flow', () => {
  const stage = defaultConstructionStages[3];
  const prompt = { field: 'devices' as const, room: '书房', question: '书房需要预留哪些设备的插座？' };
  assert.deepEqual(stagesInput([{ ...stage, followUps: [prompt] }])[0].followUps, [prompt]);
  assert.deepEqual(stagesInput([stage])[0], stage);
  for (const followUps of [[prompt, prompt], Array(4).fill(prompt), [{ ...prompt, room: '' }], [{ ...prompt, question: '需要什么？' }],
    [{ ...prompt, field: 'approval' }], [{ ...prompt, field: 'budget' }], [{ ...prompt, tenantId: '2' }]]) {
    assert.throws(() => stagesInput([{ ...stage, followUps }]));
  }
});
test('known needs skip questions while room and field boundaries remain independent', () => {
  const prompt = { field: 'devices' as const, room: '书房', question: '书房有哪些设备？' };
  const fact = { id: '1', room: '书房', field: 'devices' as const, value: '电脑', quote: '书房有电脑', sourceMessageId: '1',
    provenance: 'customer_statement' as const, status: 'current' as const, supersedes: null, createdAt: new Date().toISOString() };
  assert.equal(followUpKnown(prompt, { version: 1, facts: [fact] }), true);
  assert.equal(followUpKnown(prompt, { version: 1, facts: [{ ...fact, room: '卧室' }] }), false);
  assert.equal(followUpKnown(prompt, { version: 1, facts: [{ ...fact, field: 'storage' }] }), false);
  assert.equal(followUpKnown(prompt, { version: 1, facts: [{ ...fact, status: 'superseded' }] }), false);
  const budget = { field: 'budget' as const, room: '', question: '预算怎么考虑？' };
  assert.equal(followUpKnown(budget, { version: 0, facts: [] }, { budget: { text: '预算暂时没定' } }), true);
  assert.equal(followUpKnown(budget, { version: 0, facts: [] }, {}, { budget: '20万元' }), true);
  assert.equal(followUpKnown(budget, { version: 0, facts: [] }), false);
});
test('configurable stages require unique stable identities and meaningful enabled reminder content', () => {
  assert.equal(stagesInput(defaultConstructionStages).length, 10);
  const s = defaultConstructionStages[0];
  assert.throws(() => stagesInput([{ ...s, visitReminder: true }]));
  assert.throws(() => stagesInput([s, s]));
  assert.throws(() => stagesInput([{ ...s, tenantId: '2' }]));
  assert.throws(() => stagesInput([{ ...s, key: 'http://example.com' }]));
  assert.throws(() => stagesInput([]));
  assert.deepEqual(contactInput('王师傅', '138 0000 0000'), { name: '王师傅', phone: '13800000000' });
  assert.deepEqual(contactInput('', ''), { name: '', phone: '' });
  for (const phone of ['tel:13800000000', 'https://example.com', '13800000000;123', '1']) assert.throws(() => contactInput('王师傅', phone));
  assert.throws(() => contactInput('', '13800000000'));
});
