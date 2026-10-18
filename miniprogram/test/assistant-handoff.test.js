const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../packages/assistant/lib/client');
const { HandoffController } = require('../packages/assistant/lib/handoff');
function fixture(staff = false) {
  let identity = 'customer'; const calls = []; let drop = false;
  const detail = { conversationId: '11', status: 'open', mode: 'ai', handoff: null, recipients: [{ id: '2', name: '设计师' }], leads: [] };
  const client = new AssistantClient(async (url, method, body, options) => {
    calls.push({ url, method, body, options });
    if (method === 'POST') {
      if (drop) { drop = false; throw { statusCode: 503 }; }
      detail.handoff = { state: body.action === 'request' ? 'waiting' : 'active', recipientName: '设计师', packet: {} };
    }
    return { success: true, data: url.endsWith('/handoffs') ? { items: [] } : detail };
  });
  const controller = new HandoffController({ client, identity: () => identity, emit() {}, schedule: () => 1, unschedule() {} });
  return { controller, calls, detail, show: () => controller.show({ conversationId: '11', staff: staff ? '1' : '' }), drop: () => { drop = true; }, identity: () => { identity = 'other'; } };
}
test('handoff consent is explicit; phone is not required; duplicate taps perform one write', async () => {
  const f = fixture(); await f.show(); await f.controller.act('request');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  f.controller.input('consent', true);
  await Promise.all([f.controller.act('request'), f.controller.act('request')]);
  const writes = f.calls.filter(c => c.method === 'POST'); assert.equal(writes.length, 1);
  assert.equal(writes[0].body.contactConsent, false); assert.equal(writes[0].body.phone, '');
  assert.equal(f.controller.state.detail.handoff.state, 'waiting');
});
test('unknown request outcome freezes edits and retains original key across refresh', async () => {
  const f = fixture(); await f.show(); f.controller.input('consent', true); f.drop();
  await f.controller.act('request'); assert.equal(f.controller.state.pending, 'request');
  f.controller.input('contactConsent', true); assert.equal(f.controller.state.contactConsent, false);
  await f.controller.act('cancel');
  await f.controller.act('request');
  const writes = f.calls.filter(c => c.method === 'POST'); assert.equal(writes.length, 2);
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.deepEqual(writes[0].body, writes[1].body); assert.equal(f.controller.state.pending, '');
});
test('revocation removes all previously visible packet data', async () => {
  const f = fixture(true); await f.show();
  f.controller.set({ packetMessages: [{ text: 'private' }], messages: [{ text: 'private' }] });
  f.controller.fail({ statusCode: 403, code: 'assistant_capability_forbidden' }, f.controller.epoch);
  assert.deepEqual(f.controller.state.packetMessages, []); assert.deepEqual(f.controller.state.messages, []);
  assert.equal(f.controller.state.detail, null); assert.equal(f.controller.state.fatal, true);
});
test('human sends accept a durable message receipt without creating an AI run', async () => {
  const client = new AssistantClient(async () => ({ success: true, data: { conversationId: '11', messageId: '12', runId: null, status: 'succeeded' } }));
  const result = await client.mutate('send:11', '/conversations/11/messages', { content: { version: 1, blocks: [{ type: 'text', text: '你好设计师' }] } });
  assert.equal(result.messageId, '12'); assert.equal(client.pending.size, 0);
});

test('recipient choices remain stable before consent; waiting starts polling', async () => {
  const f = fixture(); let polls = 0;
  f.controller.schedule = () => ++polls;
  await f.show(); assert.equal(polls, 0);
  f.controller.input('recipientIndex', 1); f.controller.input('consent', true);
  await f.controller.act('request');
  assert.equal(f.calls.find(c => c.method === 'POST').body.recipientId, '2');
  assert.equal(polls, 1);
});

test('switching identity returns staff to the queue without carrying the old conversation', async () => {
  const f = fixture(true); await f.show(); f.identity();
  await f.controller.show({ staff: '1' });
  assert.equal(f.controller.id, ''); assert.equal(f.controller.state.detail, null);
  assert.ok(f.calls.at(-1).url.endsWith('/handoffs'));
});

test('return to conversation skips the summary page and targets the same chat', () => {
  let page, navigation;
  global.Page = value => { page = value; };
  global.getCurrentPages = () => [
    { route: 'packages/assistant/chat/chat', data: { conversation: { id: '11' } } },
    { route: 'packages/assistant/requirements/requirements', data: {} },
    { route: 'packages/assistant/handoff/handoff', data: {} },
  ];
  global.wx = { navigateBack: value => { navigation = value; }, redirectTo: () => assert.fail('matching chat should be reused') };
  try {
    require('../packages/assistant/handoff/handoff');
    page.openChat.call({ controller: { id: '11' } });
    assert.equal(navigation.delta, 2);
  } finally { delete global.Page; delete global.getCurrentPages; delete global.wx; }
});

test('staff source quotes target the conversation scroll region and never pretend to jump to an unloaded message', () => {
  let page, notice = '';
  const modulePath = require.resolve('../packages/assistant/handoff/handoff');
  global.Page = value => { page = value; };
  global.wx = { showToast: value => { notice = value.title; }, pageScrollTo: () => assert.fail('staff chat owns its scroll region') };
  try {
    delete require.cache[modulePath]; require(modulePath);
    const view = { data: { tab: 'requirements', messages: [{ id: '21' }] }, setData(patch) { Object.assign(this.data, patch); } };
    page.jumpToMessage.call(view, { currentTarget: { dataset: { id: '21' } } });
    assert.equal(view.data.tab, 'chat'); assert.equal(view.data.staffScrollTarget, 'message-21');
    page.jumpToMessage.call(view, { currentTarget: { dataset: { id: 'older-unloaded' } } });
    assert.match(notice, /原话不在近期消息/); assert.equal(view.data.staffScrollTarget, 'message-21');
  } finally { delete global.Page; delete global.wx; delete require.cache[modulePath]; }
});

test('pre-consent preview reads the owned saved summary without mutating; ended packet cannot replace missing current data', async () => {
  const calls = []; let latest = { status: 'confirmed', draftFields: { budget: { text: '预算待定' } }, confirmedFields: { budget: '25万元' } };
  const client = new AssistantClient(async (url, method) => {
    calls.push({ url, method });
    return { success: true, data: url.endsWith('/requirements') ? { latest } : {
      status: 'open', handoff: { state: 'ended', packet: { summary: { draft_fields: { budget: { text: '旧资料' } } } } }, recipients: [],
    } };
  });
  const controller = new HandoffController({ client, identity: () => 'customer', emit() {}, schedule() {}, unschedule() {} });
  await controller.show({ conversationId: '11' });
  assert.equal(controller.state.fields.find(f => f.key === 'budget').text, '25万元');
  assert.ok(calls.every(c => c.method === 'GET'));
  latest = null; await controller.refresh();
  assert.deepEqual(controller.state.fields, []);
});
