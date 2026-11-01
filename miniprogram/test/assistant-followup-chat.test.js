const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../utils/assistant-client');
const { ChatController } = require('../packages/assistant/lib/chat');
const { FollowupChat } = require('../utils/assistant-followup-chat');

function fixture(audience = 'customer') {
  let identity = 'test-session', intercept;
  const calls = [], messages = [], receipts = new Map();
  const context = { bindingId: '81', conversationId: '901', audience };
  const conversation = { id: '901', mode: 'human', status: 'open', version: 1, humanName: '合成接待', ownerAvailable: true };
  const client = new AssistantClient(async (url, method, body, options) => {
    const call = { url, method, body, options }; calls.push(call);
    const override = intercept?.(call); if (override) return override;
    assert.ok(url.startsWith('/miniprogram/assistant/followups/81/conversation'));
    if (method === 'GET') return { success: true, data: url.endsWith('/messages') ? { items: messages.slice().reverse(), nextCursor: null } : { ...conversation } };
    const key = options.headers['Idempotency-Key'];
    if (receipts.has(key)) return { success: true, data: receipts.get(key) };
    let data;
    if (url.endsWith('/messages')) {
      messages.push({ id: String(messages.length + 1), seq: String(messages.length + 1), authorKind: audience === 'customer' ? 'user' : 'admin', content: body.content, available: true });
      data = { conversationId: '901', messageId: String(messages.length), runId: null, status: 'succeeded' };
    } else {
      conversation.mode = body.action === 'request' ? 'handoff_requested' : 'ai'; conversation.version++;
      data = { conversationId: '901', mode: conversation.mode, version: conversation.version };
    }
    receipts.set(key, data);
    if (call.lose) throw { statusCode: 503 };
    return { success: true, data };
  });
  class Controller extends ChatController { constructor(args) { super({ ...args, schedule: () => 0, unschedule() {} }); } }
  class Media { dispose() {} }
  const emitted = [];
  const chat = new FollowupChat({ Controller, Media, client, identity: () => identity, headers: async () => ({ 'X-Assistant-Entry': 'signed' }), emit: p => emitted.push(p) });
  return { chat, client, context, conversation, messages, calls, emitted, intercept(fn) { intercept = fn; }, identity(value) { identity = value; } };
}
test('human sends use the original C01 message journal and the fixed private binding', async () => {
  const f = fixture(); await f.chat.open(f.context); f.chat.input('厨房插座的位置我想再确认一下。'); await f.chat.send();
  const post = f.calls.find(c => c.method === 'POST');
  assert.equal(post.url, '/miniprogram/assistant/followups/81/conversation/messages');
  assert.equal(post.body.clientMessageId, post.options.headers['Idempotency-Key']);
  assert.equal(post.options.headers['X-Assistant-Entry'], 'signed');
  assert.equal(f.messages.length, 1); assert.equal(f.chat.state.draft, ''); assert.equal(f.chat.state.generating, false);
  assert.ok(f.emitted.every(p => !('draft' in p) && !('conversation' in p))); f.chat.dispose();
});
test('lost send receipt recovers the same committed message after hide and reentry', async () => {
  const f = fixture(); let first = true;
  f.intercept(c => { if (c.method === 'POST' && first) { first = false; c.lose = true; } });
  await f.chat.open(f.context); f.chat.input('我补充一下，阳台不需要插座。'); await f.chat.send();
  assert.equal(f.chat.state.pendingSend, true); f.chat.hide(); await f.chat.open(f.context); await f.chat.recover();
  const writes = f.calls.filter(c => c.method === 'POST');
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.equal(f.messages.length, 1); assert.equal(f.chat.state.pendingSend, false); f.chat.dispose();
});
test('explicit reception end keeps its original action and key through unknown reentry', async () => {
  const f = fixture(); let first = true;
  f.intercept(c => { if (c.method === 'POST' && first) { first = false; c.lose = true; } });
  await f.chat.open(f.context); await f.chat.handoff('end'); assert.equal(f.chat.state.pendingAction, 'handoff:end');
  f.chat.hide(); await f.chat.open(f.context); await f.chat.recover();
  const writes = f.calls.filter(c => c.method === 'POST');
  assert.deepEqual(writes.map(c => c.body), [{ action: 'end' }, { action: 'end' }]);
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.equal(f.chat.state.conversation.mode, 'ai'); assert.equal(f.chat.state.canCompose, false); f.chat.dispose();
});
test('a response for another private destination cannot clear the pending journal', async () => {
  const f = fixture(); f.intercept(c => c.method === 'POST' ? { success: true, data: { conversationId: 'OTHER', messageId: '1', status: 'succeeded' } } : null);
  await f.chat.open(f.context); f.chat.input('请帮我看看这个位置。'); await f.chat.send();
  assert.equal(f.chat.state.pendingSend, true); assert.ok(f.client.pending.has('send:901')); f.chat.dispose();
});
test('current revocation removes private content; reentry never flashes old messages', async () => {
  const f = fixture(); await f.chat.open(f.context); f.chat.input('合成私有内容'); await f.chat.send();
  f.chat.hide(); f.intercept(() => { throw { statusCode: 403, code: 'assistant_capability_forbidden' }; });
  const start = f.emitted.length; await f.chat.open(f.context);
  assert.ok(f.emitted.slice(start).every(p => !JSON.stringify(p.followupChat.messages).includes('合成私有内容')));
  assert.equal(f.chat.state.fatal, true); assert.deepEqual(f.chat.state.messages, []); assert.equal(f.chat.state.canCompose, false); f.chat.dispose();
});
test('waiting allows supplements; unavailable reception and AI mode cannot start sends', async () => {
  const f = fixture(); f.conversation.mode = 'handoff_requested'; await f.chat.open(f.context);
  f.chat.input('柜子的宽度明天再量。'); await f.chat.send(); assert.equal(f.messages.length, 1);
  f.conversation.mode = 'human'; f.conversation.ownerAvailable = false; await f.chat.refresh(); f.chat.input('先等等'); await f.chat.send();
  assert.equal(f.messages.length, 1); f.conversation.mode = 'ai'; await f.chat.refresh(); await f.chat.send(); assert.equal(f.messages.length, 1); f.chat.dispose();
});
test('project denial clears this destination journal and preserves an unrelated unknown send', async () => {
  const f = fixture(); await f.chat.open(f.context);
  f.client.pending.set('send:123', { key: 'ordinary-key', path: '/conversations/123/messages', body: { content: { blocks: [{ text: 'ordinary draft' }] } } });
  f.client.pending.set('send:901', { key: 'private-key', path: '/followups/81/conversation/messages', body: { content: { blocks: [{ text: 'private draft' }] } } });
  f.intercept(() => { throw { statusCode: 403, code: 'assistant_capability_forbidden' }; }); await f.chat.refresh();
  assert.equal(f.client.pending.has('send:901'), false); assert.equal(f.client.pending.has('send:123'), true); f.chat.dispose();
});

for (const audience of ['worker','designer','boss']) test(audience + ' private question keeps its exact report, own bubble and original-key reentry', async () => {
  const f = fixture(audience); f.conversation.mode = 'ai';
  f.conversation.reportContext = { version: 3, selected: { reportId: '20', projectId: '2' }, invalidated: false };
  let first = true; f.intercept(c => { if (c.method === 'POST' && first) { first = false; c.lose = true; } });
  await f.chat.open(f.context); assert.equal(f.chat.state.canCompose, true);
  f.chat.input('厨房这个点位还需要核对什么？'); await f.chat.send();
  assert.equal(f.chat.state.pendingSend, true); f.chat.hide(); await f.chat.open(f.context); await f.chat.recover();
  const writes = f.calls.filter(c => c.method === 'POST');
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(writes[0].body.content.reportContextVersion, 3);
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.equal(f.messages.length, 1); assert.equal(f.chat.state.messages[0].isUser, true);
  f.conversation.reportContext = { version: 3, selected: null, invalidated: true }; await f.chat.refresh();
  f.chat.input('我再补充一下。'); await f.chat.send(); assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
  assert.equal(f.chat.state.draft, '我再补充一下。'); f.chat.dispose();
});
