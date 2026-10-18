const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient, entryInput, messagesForView } = require('../packages/assistant/lib/client');
const { ChatController } = require('../packages/assistant/lib/chat');
const { canAccessRoute } = require('../utils/identity-navigation');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('unknown handoff survives page recreation with the same key and body, isolated by identity', async () => {
  const previous = global.wx, values = new Map([['token', 'session-a']]);
  global.wx = { getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, JSON.parse(JSON.stringify(value))) };
  try {
    let firstKey;
    const client = new AssistantClient(async (_url, _method, _body, options) => { firstKey = options.headers['Idempotency-Key']; throw { statusCode: 503 }; });
    await assert.rejects(client.mutate('handoff:11', '/conversations/11/handoff', { action: 'request' }));
    const reopened = new AssistantClient(async (_url, _method, body, options) => {
      assert.equal(options.headers['Idempotency-Key'], firstKey); assert.deepEqual(body, { action: 'request' });
      return { success: true, data: { conversationId: '11' } };
    });
    assert.ok(reopened.pending.has('handoff:11'));
    await reopened.mutate('handoff:11', '/conversations/11/handoff', { action: 'end' });
    assert.equal(new AssistantClient().pending.size, 0);
    await assert.rejects(client.mutate('handoff:11', '/conversations/11/handoff', { action: 'request' }));
    values.set('token', 'session-b'); assert.equal(new AssistantClient().pending.size, 0);
  } finally { global.wx = previous; }
});

function fixture() {
  let token = 'customer-A';
  const calls = [], timers = new Map(); let timerId = 0;
  const db = {
    entry: { entryToken: 'entry-A', enterprise: { id: '1', name: '测试企业' }, canSend: true, maxMessageChars: 4000, expiresIn: 900 },
    conversation: { id: '11', status: 'open', mode: 'ai', version: 1, latestRun: null },
    items: [], history: [], messageCursor: null, historyCursor: null,
    citation: { id: '31', available: true, title: '材料规范', versionNumber: 1, quote: '已发布的资料摘录' },
  };
  let intercept;
  const request = async (url, method, body, options) => {
    const call = { url: url.replace('/miniprogram/assistant', ''), method, body, options };
    calls.push(call);
    if (intercept) {
      const result = await intercept(call);
      if (result !== undefined) return result;
    }
    let data;
    if (call.url === '/entry-context') data = db.entry;
    else if (call.url === '/conversations' && method === 'GET') data = { items: db.history, nextCursor: db.historyCursor };
    else if (call.url === '/conversations') data = db.conversation;
    else if (call.url === '/conversations/11' && method === 'PATCH') { db.conversation.status = 'archived'; data = db.conversation; }
    else if (call.url === '/conversations/11') data = db.conversation;
    else if (call.url.endsWith('/messages') && method === 'GET') data = { items: db.items, nextCursor: db.messageCursor };
    else if (call.url.endsWith('/messages')) {
      db.items = [{ id: '21', seq: '1', authorKind: 'user', content: body.content, available: true }];
      db.conversation.latestRun = { id: '41', conversationId: '11', status: 'queued', nextPollMs: 1500, retryable: false };
      data = { runId: '41', conversationId: '11', messageId: '21', status: 'queued' };
    } else if (call.url.startsWith('/citations/')) data = db.citation;
    else if (call.url === '/runs/41') data = db.conversation.latestRun;
    else if (call.url.endsWith('/cancel')) {
      db.conversation.latestRun = { ...db.conversation.latestRun, status: 'cancelled', retryable: true };
      data = db.conversation.latestRun;
    } else if (call.url.endsWith('/retry')) {
      db.conversation.latestRun = { id: '42', conversationId: '11', status: 'queued', retryable: false };
      data = { runId: '42', conversationId: '11', status: 'queued' };
    } else throw new Error(`Unhandled ${method} ${call.url}`);
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  };
  const client = new AssistantClient(request);
  const controller = new ChatController({
    client, identity: () => token, emit() {},
    schedule: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    unschedule: id => timers.delete(id),
  });
  return { controller, client, db, calls, timers, intercept: next => { intercept = next; }, identity: next => { token = next; } };
}

test('direct handoff and waiting supplements stay in the same chat without an AI run', async () => {
  const f = fixture();
  f.intercept(call => {
    if (call.url.endsWith('/handoff')) {
      assert.deepEqual(call.body, { action: 'request' });
      f.db.conversation.mode = 'handoff_requested';
      return { success: true, data: { conversationId: '11', mode: 'handoff_requested' } };
    }
    if (call.url.endsWith('/messages') && call.method === 'POST') {
      f.db.items = [{ id: '21', seq: '1', authorKind: 'user', content: call.body.content }];
      return { success: true, data: { conversationId: '11', messageId: '21', status: 'succeeded', runId: null } };
    }
  });
  await f.controller.show({}); await f.controller.handoff();
  assert.equal(f.controller.state.conversation.mode, 'handoff_requested');
  assert.equal(f.controller.state.readOnly, false);
  f.controller.input('再补充一张图之前，书房需要双人书桌'); await f.controller.send();
  assert.equal(f.controller.state.messages.length, 1);
  assert.equal(f.controller.state.run, null);
  assert.equal(f.calls.filter(c => c.url.endsWith('/handoff')).length, 1);
  await f.controller.show({ conversationId: '11' });
  assert.equal(f.controller.state.conversation.mode, 'handoff_requested');
});

test('multiple choices stay local until confirmation, exclude none, and send one durable message', async () => {
  const f = fixture();
  f.db.entry.guidance = { questionKey: 'devices', answerType: 'multiple', options: ['显示器', '手机充电', '暂时没有'] };
  await f.controller.show({});
  await f.controller.chooseOption('devices', '显示器');
  await f.controller.chooseOption('devices', '手机充电');
  assert.equal(f.calls.filter(c => c.url.endsWith('/messages')).length, 0);
  assert.deepEqual(f.controller.state.selectedOptions, ['显示器', '手机充电']);
  await f.controller.chooseOption('devices', '暂时没有');
  assert.deepEqual(f.controller.state.selectedOptions, ['暂时没有']);
  await f.controller.chooseOption('devices', '显示器');
  await f.controller.chooseOption('devices', '手机充电');
  await Promise.all([f.controller.confirmOptions(), f.controller.confirmOptions()]);
  const writes = f.calls.filter(c => c.url.endsWith('/messages') && c.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.content.blocks[0].text, '显示器、手机充电');
});

test('quick choices send once, preserve typed drafts and reject stale question controls', async () => {
  const f = fixture();
  f.db.entry.guidance = { questionKey: 'housingType', options: ['新房', '旧房'], recorded: '暂无', pending: '新旧房' };
  await f.controller.show({});
  assert.equal(f.controller.state.guidance.questionKey, 'housingType');
  f.controller.input('我自己补充');
  await f.controller.chooseOption('housingType', '新房');
  assert.equal(f.controller.state.draft, '我自己补充');
  f.controller.input('');
  await f.controller.chooseOption('area', '新房');
  assert.equal(f.calls.filter(c => c.url.endsWith('/messages') && c.method === 'POST').length, 0);
  await Promise.all([f.controller.chooseOption('housingType', '新房'), f.controller.chooseOption('housingType', '新房')]);
  const sends = f.calls.filter(c => c.url.endsWith('/messages') && c.method === 'POST');
  assert.equal(sends.length, 1); assert.equal(sends[0].body.content.blocks[0].text, '新房');
  f.controller.dispose();
});

test('entry accepts one verified basis, ignores raw tenant parameters and route requires customer capability', () => {
  assert.deepEqual(entryInput({ leadId: '12', enterpriseId: '999', staffId: '6' }), { leadId: '12' });
  assert.throws(() => entryInput({ leadId: '12', conversationId: '11' }));
  assert.equal(canAccessRoute('/packages/assistant/chat/chat', { mode: 'customer', role: 'customer' }), true);
  assert.equal(canAccessRoute('/packages/assistant/chat/chat', { mode: 'staff', role: 'designer' }), false);
});

test('unknown write retains original key and content; definitive error permits a corrected request', async () => {
  const f = fixture(); let failures = 1;
  f.intercept(call => { if (call.method === 'POST' && failures--) throw { errMsg: 'timeout' }; });
  await assert.rejects(f.client.mutate('send:11', '/conversations/11/messages', { content: { version: 1, blocks: [{ type: 'text', text: '原问题' }] } }));
  await f.client.mutate('send:11', '/conversations/11/messages', { content: { version: 1, blocks: [{ type: 'text', text: '不能替换原问题' }] } });
  assert.equal(f.calls[0].options.headers['Idempotency-Key'], f.calls[1].options.headers['Idempotency-Key']);
  assert.equal(f.calls[1].body.clientMessageId, f.calls[1].options.headers['Idempotency-Key']);
  assert.equal(f.calls[1].body.content.blocks[0].text, '原问题');
  f.intercept(() => { throw { statusCode: 422, code: 'invalid_message' }; });
  await assert.rejects(f.client.mutate('send:11', '/conversations/11/messages', {}));
  assert.equal(f.client.pending.size, 0);
});

test('first message creates exactly one conversation; double taps share the request and restore server history', async () => {
  const f = fixture(); await f.controller.show({ leadId: '12' });
  assert.equal(f.calls.filter(call => call.url === '/conversations' && call.method === 'POST').length, 0);
  f.controller.input('水电开工要确认什么？');
  await Promise.all([f.controller.send(), f.controller.send()]);
  assert.equal(f.calls.filter(call => call.url.endsWith('/messages') && call.method === 'POST').length, 1);
  assert.equal(f.controller.state.messages[0].blocks[0].text, '水电开工要确认什么？');
  assert.equal(f.controller.state.generating, true);
  assert.equal(f.controller.state.draft, '');
  f.controller.dispose();
});

test('committed send followed by history outage stays sent, not an ambiguous draft', async () => {
  const f = fixture(); await f.controller.show({});
  f.intercept(call => { if (call.url.endsWith('/messages') && call.method === 'GET') throw { errMsg: 'offline' }; });
  f.controller.input('问题'); await f.controller.send();
  assert.equal(f.controller.state.pendingSend, false);
  assert.equal(f.controller.state.draft, '');
  assert.equal(f.controller.state.generating, true);
  f.controller.dispose();
});

test('ambiguous send can be confirmed with the same key after reconnect discovers a running job', async () => {
  const f = fixture(); await f.controller.show({});
  let once = true;
  f.intercept(call => {
    if (call.url.endsWith('/messages') && call.method === 'POST' && once) {
      once = false; f.db.conversation.latestRun = { id: '41', status: 'running', nextPollMs: 1500 };
      throw { errMsg: 'response lost' };
    }
  });
  f.controller.input('同一个问题'); await f.controller.send();
  assert.equal(f.controller.state.pendingSend, true);
  await f.controller.refresh(); assert.equal(f.controller.state.generating, true);
  assert.match(f.controller.state.error, /确认/);
  await f.controller.send();
  const writes = f.calls.filter(call => call.url.endsWith('/messages') && call.method === 'POST');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.clientMessageId, writes[1].body.clientMessageId);
  assert.equal(f.controller.state.pendingSend, false);
  f.controller.dispose();
});

test('backgrounding pauses polls while a pending send still settles once before foreground recovery', async () => {
  const f = fixture(); await f.controller.show({});
  const gate = deferred();
  f.intercept(call => call.url.endsWith('/messages') && call.method === 'POST' ? gate.promise : undefined);
  f.controller.input('材料问题'); const send = f.controller.send();
  await new Promise(resolve => setImmediate(resolve));
  f.controller.hide(); assert.equal(f.timers.size, 0);
  const show = f.controller.show();
  f.db.conversation.latestRun = { id: '41', status: 'running', nextPollMs: 1500 };
  gate.resolve({ success: true, data: { runId: '41', conversationId: '11', status: 'queued' } });
  await Promise.all([send, show]);
  assert.equal(f.controller.state.draft, '');
  assert.equal(f.controller.state.run.id, '41');
  assert.equal(f.timers.size, 1);
  f.controller.hide(); assert.equal(f.timers.size, 0);
});

test('unknown-cost runs never expose retry or auto-resubmit', async () => {
  const f = fixture(); f.db.conversation.latestRun = { id: '41', status: 'indeterminate', retryable: false };
  await f.controller.show({ conversationId: '11' });
  f.controller.input('不应发送'); await f.controller.send(); await f.controller.action('retry');
  assert.equal(f.controller.state.uncertainRun, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls.filter(call => call.url.includes('/retry') || (call.url.endsWith('/messages') && call.method === 'POST')).length, 0);
});

test('unknown retry result replays the old run operation even after refreshed latestRun changes', async () => {
  const f = fixture(); f.db.conversation.latestRun = { id: '41', status: 'failed', retryable: true };
  await f.controller.show({ conversationId: '11' }); let once = true;
  f.intercept(call => {
    if (call.url.endsWith('/retry') && once) {
      once = false; f.db.conversation.latestRun = { id: '42', status: 'queued', retryable: false };
      throw { errMsg: 'response lost' };
    }
  });
  await f.controller.action('retry'); await f.controller.refresh();
  assert.match(f.controller.state.error, /确认/);
  await f.controller.action('retry');
  const writes = f.calls.filter(call => call.url.endsWith('/retry'));
  assert.deepEqual(writes.map(call => call.url), ['/runs/41/retry', '/runs/41/retry']);
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.equal(f.controller.state.pendingAction, '');
  f.controller.dispose();
});

test('disabled enterprise exposes history, blocks new send, and archived conversation remains read-only', async () => {
  const f = fixture(); f.db.entry.canSend = false; f.db.conversation.status = 'archived';
  await f.controller.show({ conversationId: '11' }); f.controller.input('不可发送'); await f.controller.send();
  assert.equal(f.controller.state.conversation.status, 'archived');
  assert.equal(f.controller.state.readOnly, true);
  assert.equal(f.controller.state.fatal, false);
  assert.equal(f.calls.filter(call => call.url.endsWith('/messages') && call.method === 'POST').length, 0);
});

test('revoked citation is refetched and clears stale answer text via server message projection', async () => {
  const f = fixture(); f.db.items = [{ id: '21', seq: '1', authorKind: 'assistant', available: true, content: { blocks: [{ type: 'text', text: '旧回答' }] } }];
  await f.controller.show({ conversationId: '11' });
  f.db.citation = { id: '31', available: false };
  f.db.items[0] = { ...f.db.items[0], available: false, content: { blocks: [{ type: 'notice', fallbackText: '资料已不可用' }] } };
  await f.controller.openCitation('31');
  assert.equal(f.controller.state.citation.available, false);
  assert.equal(f.controller.state.messages[0].blocks[0].text, '资料已不可用');
});

test('identity change fences an outstanding response and clears previous conversation and draft', async () => {
  const f = fixture(); await f.controller.show({}); const gate = deferred();
  f.intercept(call => call.url === '/conversations/11' ? gate.promise : undefined);
  const pending = f.controller.selectConversation('11');
  f.identity('customer-B'); gate.resolve({ success: true, data: f.db.conversation }); await pending;
  assert.equal(f.controller.state.conversation, null);
  f.intercept(undefined); await f.controller.show({});
  assert.equal(f.controller.state.messages.length, 0);
  assert.equal(f.controller.conversationId, '');
});

test('401 removes all sensitive visible state; late citation responses cannot reopen it', async () => {
  const f = fixture(); await f.controller.show({ conversationId: '11' });
  f.intercept(() => { throw { statusCode: 401, code: 'identity_context_invalid' }; });
  await f.controller.openCitation('31');
  assert.equal(f.controller.state.needsLogin, true);
  assert.equal(f.controller.state.conversation, null);
  assert.equal(f.controller.state.history.length, 0);
  assert.equal(f.controller.state.citation, null);
});

test('known citation chips replace duplicate fallback labels without dropping unmatched sources or notices', () => {
  const [message] = messagesForView([{ id: '1', seq: '1', content: { blocks: [
    { type: 'text', text: '施工前确认点位。' },
    { type: 'citation', citationId: '31', fallbackText: '知识来源' },
    { type: 'citation', citationId: '32', fallbackText: '其他来源说明' },
    { type: 'notice', fallbackText: '资料不足' },
  ] }, citations: [{ id: '31', available: true, title: '施工参考' }] }]);
  assert.deepEqual(message.blocks.map(block => block.text), ['施工前确认点位。', '其他来源说明', '资料不足']);
  assert.deepEqual(message.citations, [{ id: '31', available: true, title: '施工参考' }]);
});

test('message projection orders bigint sequences exactly and treats unknown blocks as plain text', () => {
  const messages = messagesForView([
    { id: '2', seq: '9007199254740993', content: { blocks: [{ type: 'unknown', fallbackText: '<button>plain text</button>', action: 'execute' }] } },
    { id: '1', seq: '9007199254740992', content: { blocks: [{ type: 'notice', fallbackText: '资料不足' }] }, answerKind: 'insufficient_evidence' },
  ]);
  assert.deepEqual(messages.map(item => item.id), ['1', '2']);
  assert.deepEqual(messages[1].blocks, [{ key: 0, text: '<button>plain text</button>' }]);
});

test('new conversation remains new on foreground even when route originally targeted history', async () => {
  const f = fixture(); await f.controller.show({ conversationId: '11' });
  f.controller.newConversation(); f.controller.hide(); await f.controller.show();
  assert.equal(f.controller.state.conversation, null);
  assert.equal(f.controller.conversationId, '');
});

test('revocation fences a slower citation response from restoring previously authorized content', async () => {
  const f = fixture(); await f.controller.show({ conversationId: '11' });
  const gate = deferred();
  f.intercept(call => {
    if (call.url.startsWith('/citations')) return gate.promise;
    if (call.url === '/entry-context') throw { statusCode: 401 };
  });
  const citation = f.controller.openCitation('31');
  await f.controller.refresh();
  gate.resolve({ success: true, data: f.db.citation }); await citation;
  assert.equal(f.controller.state.citation, null);
  assert.equal(f.controller.state.messages.length, 0);
});

test('history and earlier-message cursors preserve conversation scope and chronological order', async () => {
  const f = fixture(); f.db.history = [f.db.conversation]; f.db.historyCursor = '11';
  f.db.items = [{ id: '22', seq: '2', content: { blocks: [{ type: 'text', text: '后来的消息' }] } }]; f.db.messageCursor = '2';
  await f.controller.show({ conversationId: '11' });
  f.intercept(call => {
    if (call.url === '/conversations' && call.body.cursor) return { success: true, data: { items: [{ id: '10', status: 'archived' }], nextCursor: null } };
    if (call.url.endsWith('/messages') && call.body.beforeSeq) return { success: true, data: { items: [{ id: '21', seq: '1', content: { blocks: [{ type: 'text', text: '较早的消息' }] } }], nextCursor: null } };
  });
  await f.controller.loadHistory(true); await f.controller.olderMessages();
  assert.deepEqual(f.controller.state.history.map(item => item.id), ['11', '10']);
  assert.deepEqual(f.controller.state.messages.map(item => item.id), ['21', '22']);
  assert.equal(f.calls.find(call => call.body.cursor).options.headers['X-Assistant-Entry'], 'entry-A');
});

test('stop and archive use explicit writes, keep messages and block further sends in the archived chat', async () => {
  const f = fixture(); await f.controller.show({}); f.controller.input('问题'); await f.controller.send();
  await f.controller.action('cancel'); assert.equal(f.controller.state.run.status, 'cancelled');
  await f.controller.action('archive'); assert.equal(f.controller.state.conversation.status, 'archived');
  f.controller.input('结束后不能发送'); await f.controller.send();
  assert.equal(f.calls.filter(call => call.url.endsWith('/messages') && call.method === 'POST').length, 1);
  assert.equal(f.controller.state.messages.length, 1);
  assert.equal(f.calls.find(call => call.method === 'PATCH').body.expectedVersion, 1);
});

test('an earlier polling response cannot restore generating state after cancellation', async () => {
  const f = fixture(); f.db.conversation.latestRun = { id: '41', status: 'running', retryable: false };
  await f.controller.show({ conversationId: '11' }); const gate = deferred();
  f.intercept(call => call.url === '/runs/41' && call.method === 'GET' ? gate.promise : undefined);
  const polling = f.controller.poll();
  await f.controller.action('cancel');
  gate.resolve({ success: true, data: { id: '41', status: 'running' } }); await polling;
  assert.equal(f.controller.state.run.status, 'cancelled');
  assert.equal(f.controller.state.generating, false);
  assert.equal(f.timers.size, 0);
});

test('configured opening drives new chat while history uses its original script snapshot', async () => {
  const f = fixture();
  f.db.entry.guidanceEnabled = true; f.db.entry.guidanceOpening = '新版开场：先问预算';
  f.db.conversation.guidanceEnabled = true; f.db.conversation.guidanceOpening = '旧版开场：先问房屋';
  await f.controller.show({}); assert.equal(f.controller.state.welcomeText, '新版开场：先问预算');
  assert.equal(f.controller.state.guidanceEnabled, true);
  await f.controller.selectConversation('11'); assert.equal(f.controller.state.welcomeText, '旧版开场：先问房屋');
  f.controller.newConversation(); assert.equal(f.controller.state.welcomeText, '新版开场：先问预算');
  f.identity('different'); f.intercept(() => { throw { statusCode: 401 }; }); await f.controller.show({});
  assert.equal(f.controller.state.guidanceEnabled, false); assert.doesNotMatch(f.controller.state.welcomeText, /新版|旧版/);
});

test('construction contact revalidates the message and current stage through a read, without creating a booking', async () => {
  const f = fixture();
  f.db.items = [{ id: '21', seq: '1', authorKind: 'system', available: true, constructionReminder: true,
    content: { version: 1, blocks: [{ type: 'text', text: '当前进入水电阶段，先核对插座位置。' }] },
    constructionContacts: [{ projectId: '9', stageKey: 'utilities', projectName: '我的新家' }] }];
  f.intercept(call => call.url.endsWith('/construction-contact') ? { success: true, data: { projectId: '9', stageKey: 'utilities', phone: '13800000001' } } : undefined);
  await f.controller.show({ conversationId: '11' });
  assert.equal(await f.controller.constructionContact('9', '21'), '13800000001');
  assert.equal(await f.controller.constructionContact('99', '21'), null);
  const calls = f.calls.filter(c => c.url.endsWith('/construction-contact'));
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET'); assert.deepEqual(calls[0].body, { projectId: '9', messageId: '21' });
  assert.ok(!f.calls.some(c => c.method === 'POST' && !c.url.endsWith('/entry-context')));
  f.intercept(call => call.url.endsWith('/construction-contact') ? { success: true, data: { projectId: '9', stageKey: 'painting', phone: '13800000002' } } : undefined);
  assert.equal(await f.controller.constructionContact('9', '21'), null); assert.match(f.controller.state.error, /已变更/);
  assert.equal(messagesForView([{ ...f.db.items[0], available: false }])[0].constructionContacts.length, 0);
  assert.equal(messagesForView([{ id: '22', seq: '2', content: { blocks: [{ type: 'text', text: '联系管家 tel:13800000000' }] } }])[0].constructionContacts.length, 0);
});

test('a pending phone lookup never returns a number after hiding or changing the identity', async () => {
  const f = fixture(), gate = deferred();
  f.db.items = [{ id: '21', seq: '1', authorKind: 'system', available: true, content: { blocks: [] }, constructionContacts: [{ projectId: '9', stageKey: 'utilities' }] }];
  await f.controller.show({ conversationId: '11' });
  f.intercept(call => call.url.endsWith('/construction-contact') ? gate.promise : undefined);
  const lookup = f.controller.constructionContact('9', '21');
  f.controller.hide(); f.identity('different');
  gate.resolve({ success: true, data: { projectId: '9', stageKey: 'utilities', phone: '13800000001' } });
  assert.equal(await lookup, null); assert.equal(f.timers.size, 0);
});

test('idle reminder polling preserves in-progress multiple choices and skips pending writes', async () => {
  const f = fixture();
  f.db.conversation.guidanceEnabled = true;
  f.db.conversation.guidance = { questionKey: 'household', answerType: 'multiple', options: ['有宠物', '有老人'] };
  await f.controller.show({ conversationId: '11' });
  f.controller.chooseOption('household', '有宠物');
  const poll = [...f.timers.values()][0]; assert.equal(typeof poll, 'function'); await poll();
  assert.deepEqual(f.controller.state.selectedOptions, ['有宠物']);
  const before = f.calls.length; f.controller.set({ busy: true });
  await [...f.timers.values()][0](); assert.equal(f.calls.length, before);
  f.controller.set({ busy: false });
  const gate = deferred();
  f.intercept(call => call.url.endsWith('/messages') && call.method === 'GET' ? gate.promise : undefined);
  const pending = f.controller.snapshot('11', f.controller.epoch, true);
  f.controller.hide(); gate.resolve({ success: true, data: { items: [{ id: '99', seq: '99', authorKind: 'system', content: { blocks: [] } }] } });
  await pending; assert.equal(f.controller.state.messages.length, 0); assert.equal(f.timers.size, 0);
});
