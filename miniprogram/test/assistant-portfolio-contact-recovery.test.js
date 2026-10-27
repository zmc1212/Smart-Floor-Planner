const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PortfolioController } = require('../packages/assistant/lib/portfolio');
const { AssistantClient } = require('../packages/assistant/lib/client');
const { page } = require('../packages/assistant/lib/portfolio-page');

// Offline service projections only: these checks do not establish real writes,
// tenant enforcement, native rendering or configured-model acceptance.
const detail = { id: '12', versionId: '13', authorId: '14', title: '合成测试作品',
  authorName: '测试设计师', coverAssetId: '15', images: [], preferenceVersion: 0 };
function receipt(state, extra = {}) {
  return { conversationId: '11', mode: { waiting: 'handoff_requested', active: 'human', cancelled: 'ai', ended: 'ai' }[state],
    status: 'open', version: 3, handoff: { state, requestId: 'original-request', recipientId: '14' }, ...extra };
}
function fixture(write) {
  let identity = 'customer-a';
  const calls = [], view = {};
  const client = new AssistantClient(async (path, method, body, options) => {
    if (method === 'POST' && path.endsWith('/contact')) {
      calls.push({ path, method, body: structuredClone(body), key: options.headers['Idempotency-Key'] });
      return { success: true, data: await write(calls.length) };
    }
    if (path.endsWith('/conversations/11')) return { success: true, data: { id: '11', status: 'open' } };
    if (path.endsWith('/works/12')) return { success: true, data: { ...detail } };
    if (path.endsWith('/share')) return { success: true, data: { path: '/packages/assistant/work/work?portfolioEntry=test' } };
    throw Error('Unexpected read: ' + path);
  });
  const controller = new PortfolioController({ emit: patch => Object.assign(view, patch), identity: () => identity,
    client, images: { clear() {}, load: async () => '/private/test.jpg' } });
  return { controller, client, calls, view, setIdentity: value => { identity = value; },
    show: () => controller.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work') };
}
function originalChatNavigation(run) {
  const oldWx = global.wx, oldPages = global.getCurrentPages, navigation = [];
  global.wx = { navigateBack: input => navigation.push({ action: 'back', ...input }),
    redirectTo: input => navigation.push({ action: 'redirect', ...input }) };
  global.getCurrentPages = () => [{ route: 'packages/assistant/chat/chat', data: { conversation: { id: '11' } } },
    { route: 'packages/assistant/designer/designer' }, { route: 'packages/assistant/work/work' }];
  return Promise.resolve().then(() => run(navigation)).finally(() => { global.wx = oldWx; global.getCurrentPages = oldPages; });
}
function workPage(f) {
  const methods = page('work');
  return { ...methods, data: f.view, controller: f.controller };
}

test('portfolio contact describes waiting and active receipts without claiming a new booking', async () => {
  for (const state of ['waiting', 'active']) {
    const f = fixture(async () => receipt(state)); await f.show();
    assert.equal(await f.controller.write('contact'), '11');
    assert.match(f.view.feedback, state === 'waiting' ? /等待.*尚未接通或预约/ : /已接入本次咨询/);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, { versionId: '13' });
    assert.equal(f.client.pending.size, 0);
  }
  const unavailable = fixture(async () => receipt('active', { handoff: { state: 'active', requestId: 'original-request', ownerAvailable: false } }));
  await unavailable.show(); await unavailable.controller.write('contact');
  assert.match(unavailable.view.feedback, /接待人暂不可用/);
});

test('replaying a completed contact returns the current cancelled or ended state truthfully', async () => {
  for (const state of ['cancelled', 'ended']) {
    const f = fixture(async () => receipt(state)); await f.show();
    assert.equal(await f.controller.write('contact'), '11');
    assert.match(f.view.feedback, state === 'cancelled' ? /已取消.*需求保留/ : /接待已结束/);
    assert.doesNotMatch(f.view.feedback, /已提交联系意向|等待.*接待/);
    assert.equal(f.view.pendingAction, ''); assert.equal(f.calls.length, 1);
  }
});

test('unknown contact survives reentry and same-key retry returns to the original chat after cancellation', async () => {
  await originalChatNavigation(async navigation => {
    const f = fixture(async call => { if (call === 1) throw { statusCode: 503 }; return receipt('cancelled'); });
    await f.show(); const p = workPage(f);
    await p.contact(); assert.equal(f.view.pendingAction, 'contact'); assert.deepEqual(navigation, []);
    f.controller.hide(); await f.show(); assert.equal(f.view.pendingAction, 'contact');
    await p.retryWrite();
    assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.view.pendingAction, '');
    assert.match(f.view.feedback, /已取消.*需求保留/); assert.deepEqual(navigation, [{ action: 'back', delta: 2 }]);
  });
});

test('first contact and confirmed retry use the same original consultation return', async () => {
  await originalChatNavigation(async navigation => {
    const f = fixture(async () => receipt('waiting')); await f.show(); await workPage(f).contact();
    assert.deepEqual(navigation, [{ action: 'back', delta: 2 }]);
    assert.equal(f.calls.length, 1); assert.ok(!f.calls.some(call => call.path.endsWith('/conversations')));
  });
});

test('malformed or another-conversation contact receipts retain the original key and prevent navigation', async () => {
  await originalChatNavigation(async navigation => {
    const invalid = [ {}, { conversationId: '11', handoff: {} }, receipt('waiting', { conversationId: '99' }),
      receipt('waiting', { mode: 'ai' }), receipt('waiting', { handoff: { state: 'unknown', requestId: 'original-request' } }),
      receipt('waiting', { handoff: { state: 'waiting' } }) ];
    let response;
    const f = fixture(async () => response); await f.show(); const p = workPage(f);
    for (response of invalid) {
      await p.contact();
      assert.equal(f.view.pendingAction, 'contact'); assert.equal(f.client.pending.size, 1);
      assert.equal(f.view.feedback, ''); assert.ok(f.view.error); assert.deepEqual(navigation, []);
    }
    response = receipt('waiting'); await p.retryWrite();
    assert.equal(f.client.pending.size, 0); assert.equal(new Set(f.calls.map(call => call.key)).size, 1);
    assert.ok(f.calls.every(call => call.path === f.calls[0].path && JSON.stringify(call.body) === JSON.stringify(f.calls[0].body)));
    assert.deepEqual(navigation, [{ action: 'back', delta: 2 }]);
  });
});

test('a hidden page or changed identity cannot navigate or publish late contact feedback', async () => {
  await originalChatNavigation(async navigation => {
    for (const boundary of ['hide', 'identity']) {
      let finish;
      const f = fixture(() => new Promise(resolve => { finish = resolve; })); await f.show();
      const pending = workPage(f).contact(); assert.ok(finish);
      if (boundary === 'hide') f.controller.hide(); else f.setIdentity('customer-b');
      finish(receipt('waiting')); await pending;
      assert.deepEqual(navigation, []); assert.equal(f.view.feedback, '');
    }
  });
});

test('a definite owner conflict keeps the work available and never reports or navigates success', async () => {
  await originalChatNavigation(async navigation => {
    const f = fixture(async () => { throw { statusCode: 409, code: 'portfolio_owner_conflict' }; });
    await f.show(); await workPage(f).contact();
    assert.equal(f.view.work.id, '12'); assert.equal(f.view.pendingAction, ''); assert.equal(f.view.feedback, '');
    assert.ok(f.view.error); assert.equal(f.client.pending.size, 0); assert.deepEqual(navigation, []);
  });
});
