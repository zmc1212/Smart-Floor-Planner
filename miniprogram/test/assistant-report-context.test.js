const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../utils/assistant-client');
const { ReportQuestionController } = require('../packages/assistant/lib/report-context');
const { ChatController } = require('../packages/assistant/lib/chat');
const { FollowupChat } = require('../utils/assistant-followup-chat');

function fixture() {
  let identity = 'session', intercept;
  const calls = [], receipts = new Map(), opened = [];
  const selected = { bindingId: '81', reportId: '20', revision: 1, projectId: '2', projectName: '合成工地', kind: 'daily', periodStart: '2026-11-01T00:00:00Z' };
  const chat = { visible: true, session: identity, epoch: 1, state: { conversation: { id: '901', mode: 'ai', status: 'open', reportContext: { conversationId: '901', version: 0, selected: null, invalidated: false } }, draft: '原草稿不要丢' },
    set(p) { Object.assign(this.state, p); }, async snapshot() {}, fail() {} };
  const client = new AssistantClient(async (url, method, body, options) => {
    const call = { url, method, body, options }; calls.push(call);
    const override = intercept?.(call); if (override) return override;
    const key = options.headers['Idempotency-Key'];
    if (receipts.has(key)) return { success: true, data: receipts.get(key) };
    const data = url.endsWith('/report-topic') ? { id: '902', purpose: 'customer_consultation' }
      : { conversationId: '901', version: body.expectedVersion + 1, invalidated: false, selected: body.selection ? { ...selected, ...body.selection } : null };
    receipts.set(key, data); if (call.lose) throw { statusCode: 503 };
    return { success: true, data };
  });
  const q = new ReportQuestionController({ client, identity: () => identity, headers: async () => ({}), emit() {}, openTopic: async id => opened.push(id) });
  q.bind(chat, '/followups/81/conversation');
  return { q, chat, client, selected, calls, opened, intercept(fn) { intercept = fn; }, identity(v) { identity = v; } };
}
test('select/remove is per conversation, retains draft and has no send or delivery write', async () => {
  const f = fixture(); await f.q.select({ bindingId: '81', reportId: '20', revision: 1, projectId: '2' });
  assert.equal(f.q.state.title, '11月1日日报 · 合成工地'); assert.equal(f.chat.state.draft, '原草稿不要丢');
  await f.q.select(null); assert.equal(f.chat.state.draft, '原草稿不要丢'); assert.equal(f.q.state.selected, null);
  assert.ok(f.calls.every(c => c.url.endsWith('/report-context')));
});
test('unknown selection recovers the original key/body after reentry and blocks a different action', async () => {
  const f = fixture(); let first = true;
  f.intercept(c => { if (first) { first = false; c.lose = true; } });
  await f.q.select({ bindingId: '81', reportId: '20', revision: 1, projectId: '2' }); assert.equal(f.q.state.pending, true);
  f.q.bind(f.chat, '/followups/81/conversation'); await f.q.topic(); assert.equal(f.calls.length, 1);
  await f.q.recover(); assert.equal(f.q.state.pending, false); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].body, f.calls[1].body); assert.equal(f.calls[0].options.headers['Idempotency-Key'], f.calls[1].options.headers['Idempotency-Key']);
});
test('a receipt for another destination stays pending and cannot expose its source', async () => {
  const f = fixture(); f.intercept(() => ({ success: true, data: { conversationId: 'OTHER', version: 1, selected: f.selected, invalidated: false } }));
  await f.q.select({ bindingId: '81', reportId: '20', revision: 1, projectId: '2' });
  assert.equal(f.q.state.pending, true); assert.equal(f.q.state.selected, null); assert.ok(f.client.pending.has('report-context:901'));
});
test('identity change clears report labels before an old chat or response can hydrate them', async () => {
  const f = fixture(); await f.q.select({ bindingId: '81', reportId: '20', revision: 1, projectId: '2' });
  f.identity('other'); f.q.bind(f.chat, '/followups/81/conversation');
  assert.equal(f.q.state.selected, null); assert.equal(f.q.state.title, '');
});
test('reception and a live/unknown model run prevent report changes and new topics', async () => {
  const f = fixture();
  for (const patch of [{ conversation: { ...f.chat.state.conversation, mode: 'human' } }, { generating: true }, { uncertainRun: true }]) {
    const old = { ...f.chat.state }; Object.assign(f.chat.state, patch);
    await f.q.select(null); await f.q.topic(); assert.equal(f.calls.length, 0); Object.assign(f.chat.state, old);
  }
});
test('only explicit new-topic action creates an ordinary topic and leaves source draft intact', async () => {
  const f = fixture(); assert.equal(f.opened.length, 0); await f.q.topic();
  assert.deepEqual(f.opened, ['902']); assert.equal(f.chat.state.draft, '原草稿不要丢');
  assert.ok(f.calls[0].url.endsWith('/report-topic'));
});
test('original chat sends selected report version through its unchanged message journal', async () => {
  const calls = [], c = new ChatController({ emit() {}, identity: () => 'session', schedule: () => 0, unschedule() {},
    client: { pending: new Map(), async mutate(slot, path, body) { calls.push({ slot, path, body }); return { runId: '1', status: 'queued' }; } } });
  c.visible = true; c.session = 'session'; c.conversationId = '901'; c.snapshot = async () => {};
  c.set({ loading: false, canSend: true, draft: '厨房还要我确认什么？', conversation: { id: '901', status: 'open', mode: 'ai', reportContext: { version: 7, selected: { reportId: '20' } } } });
  await c.send(); assert.equal(calls[0].body.content.reportContextVersion, 7); assert.equal(calls[0].slot, 'send:901'); c.dispose();
});

function followupFixture() {
  const calls = [], receipts = new Map(); let intercept, identity = 'session';
  const conversation = { id: '901', mode: 'ai', status: 'open', reportContext: { version: 1, selected: { reportId: '20' } } };
  const client = new AssistantClient(async (url, method, body, options) => {
    const call = { url, method, body, options }; calls.push(call);
    const override = intercept?.(call); if (override) return override;
    if (method === 'GET') return { success: true, data: url.endsWith('/messages') ? { items: [], nextCursor: null }
      : url.includes('/citations/') ? { id: url.split('/').at(-1), available: true, title: '合成来源', quote: '获权原文' } : conversation };
    const key = options.headers['Idempotency-Key'];
    if (!receipts.has(key)) { conversation.latestRun = { id: '44', status: 'cancelled', retryable: true }; receipts.set(key, url.endsWith('/retry') ? { runId: '45', conversationId: '901', status: 'queued' } : { id: '44', conversationId: '901', status: 'cancelled' }); }
    if (call.lose) throw { statusCode: 503 };
    return { success: true, data: receipts.get(key) };
  });
  class Controller extends ChatController { constructor(args) { super({ ...args, schedule: () => 0, unschedule() {} }); } }
  class Media { dispose() {} }
  const chat = new FollowupChat({ Controller, Media, client, identity: () => identity, headers: async () => ({}), emit() {}, referenceImage: async v => ({ ...v, materialized: true }) });
  return { chat, conversation, calls, context: { bindingId: '81', conversationId: '901', audience: 'customer' }, intercept(fn) { intercept = fn; }, identity(v) { identity = v; } };
}

test('private source reads use the same destination and original materializer; unrelated routes stay denied', async () => {
  const f = followupFixture(); await f.chat.open(f.context); await f.chat.citation('55');
  assert.equal(f.calls.at(-1).url, '/miniprogram/assistant/followups/81/conversation/citations/55');
  assert.equal(f.chat.state.citation.materialized, true); assert.equal(f.chat.state.citation.quote, '获权原文');
  await f.chat.citation('w:44:0:1'); assert.ok(f.calls.at(-1).url.endsWith('/citations/w:44:0:1'));
  for (const route of ['/citations/55/extra','/citations/../messages','/conversations/902/messages','/runs/44/archive']) assert.throws(() => f.chat.path(route));
  f.chat.dispose();
});

test('closing or hiding a private source invalidates a late response without flashing cached source content', async () => {
  const f = followupFixture(); await f.chat.open(f.context); let finish;
  f.intercept(c => c.url.includes('/citations/') ? new Promise(resolve => { finish = resolve; }) : null);
  const pending = f.chat.citation('55'); await Promise.resolve(); f.chat.hide();
  finish({ success: true, data: { id: '55', available: true, quote: '旧私有原文' } }); await pending;
  assert.equal(f.chat.state.citation, null); f.intercept(null); await f.chat.open(f.context);
  assert.equal(f.chat.state.citation, null); f.chat.dispose();
});

test('source failure is retryable in its own sheet; revocation removes its private state', async () => {
  const f = followupFixture(); await f.chat.open(f.context);
  f.intercept(c => { if (c.url.includes('/citations/')) throw { statusCode: 503 }; });
  await f.chat.citation('55'); assert.ok(f.chat.state.citationError); assert.equal(f.chat.state.fatal, false);
  f.intercept(null); await f.chat.citation('55'); assert.equal(f.chat.state.citation.available, true);
  f.intercept(() => { throw { statusCode: 403, code: 'assistant_capability_forbidden' }; });
  await f.chat.citation('55'); assert.equal(f.chat.state.citation, null); assert.equal(f.chat.state.fatal, true); assert.deepEqual(f.chat.state.messages, []); f.chat.dispose();
});

test('stop recovers the original run action/key through reentry and retry stays in the private conversation', async () => {
  const f = followupFixture(); f.conversation.latestRun = { id: '44', status: 'running' }; await f.chat.open(f.context);
  assert.equal(f.chat.state.generating, true); let first = true;
  f.intercept(c => { if (c.method === 'POST' && first) { first = false; c.lose = true; } });
  await f.chat.action('cancel'); assert.equal(f.chat.state.pendingAction, 'cancel');
  f.chat.hide(); await f.chat.open(f.context); await f.chat.recover();
  const writes = f.calls.filter(c => c.method === 'POST'); assert.equal(writes.length, 2);
  assert.ok(writes.every(c => c.url.endsWith('/conversation/runs/44/cancel')));
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.equal(f.chat.state.pendingAction, ''); assert.equal(f.chat.state.runLabel, '已停止回答');
  await f.chat.action('retry'); assert.ok(f.calls.filter(c => c.method === 'POST').at(-1).url.endsWith('/conversation/runs/44/retry')); assert.equal(f.chat.state.pendingAction, ''); f.chat.dispose();
});

test('unknown outcome forbids retry while reception forbids all AI run actions', async () => {
  const f = followupFixture(); f.conversation.latestRun = { id: '44', status: 'indeterminate', usageReconciled: false, retryable: false }; await f.chat.open(f.context);
  assert.equal(f.chat.state.uncertainRun, true); assert.ok(f.chat.state.runLabel.includes('核实'));
  await f.chat.action('retry'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  f.conversation.mode = 'human'; await f.chat.refresh(); await f.chat.action('cancel'); await f.chat.action('retry');
  assert.equal(f.chat.state.runLabel, ''); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0); f.chat.dispose();
});
