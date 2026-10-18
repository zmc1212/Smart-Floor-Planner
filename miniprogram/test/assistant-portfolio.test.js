const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PortfolioController, PortfolioImages, RecommendationController, workForView } = require('../packages/assistant/lib/portfolio');
const { AssistantClient, entryInput } = require('../packages/assistant/lib/client');
const { page } = require('../packages/assistant/lib/portfolio-page');
const work = () => ({ id: '12', versionId: '13', authorId: '14', authorName: '真实设计师', title: '公开原木作品', description: '作品说明', primaryStyle: '原木风', area: 90, rooms: '两室', coverAssetId: '15', images: [{ assetId: '15', kind: 'render', aiGenerated: true }, { assetId: '16', kind: 'photo', showroom: true }], preference: null, preferenceVersion: 0 });
function fixture() {
  let token = 'session-a', current = work(); const calls = [];
  const client = { pending: new Map(), async read(path, input, headers, method) {
    calls.push({ path, input, method });
    if (path === '/conversations/11') return { id: '11', status: 'open' };
    if (path.endsWith('/designers/14')) return { id: '14', name: '真实设计师', bio: '本人资料', cities: [{ name: '杭州市' }], works: [current] };
    if (path.endsWith('/share')) return { path: '/packages/assistant/designer/designer?portfolioEntry=signed' };
    if (path.endsWith('/works/12')) return { ...current };
    throw Error(path);
  }, async mutate(slot, path, body) { calls.push({ slot, path, body }); current = { ...current, preference: body.sentiment, preferenceVersion: current.preferenceVersion + 1 }; return { sentiment: current.preference, preferenceVersion: current.preferenceVersion }; } };
  const images = { clear() {}, async load(cid, w, assetId) { return '/private/' + assetId + '.jpg'; } };
  const controller = new PortfolioController({ emit() {}, client, identity: () => token, images });
  return { controller, client, calls, setIdentity: value => { token = value; } };
}
test('portfolio detail loads current exact version, real grouped images and explicit preferences survive reentry/correction', async () => {
  const { controller: c, calls } = fixture(), options = { conversationId: '11', workId: '12', versionId: '13' };
  await c.show(options, 'work'); assert.equal(c.state.work.renders[0].label, 'AI生成效果图'); assert.equal(c.state.work.photos[0].label, '样板间实拍');
  assert.equal(c.state.work.preference, null); assert.ok(c.state.images.i15); assert.ok(!calls.some(x => x.slot));
  await c.write('like'); assert.equal(c.state.work.preference, 'like');
  c.hide(); assert.deepEqual(c.state.images, {}); await c.show(options, 'work'); assert.equal(c.state.work.preference, 'like');
  await c.write('dislike'); assert.equal(c.state.work.preference, 'dislike');
  assert.deepEqual(calls.filter(x => x.slot).map(x => x.body), [{ versionId: '13', sentiment: 'like', expectedVersion: 0 }, { versionId: '13', sentiment: 'dislike', expectedVersion: 1 }]);
});
test('studio uses real identity and only its published works; forwarding never exports conversation or local images', async () => {
  const { controller: c } = fixture(); await c.show({ conversationId: '11', authorId: '14' });
  assert.equal(c.state.designer.name, '真实设计师'); assert.equal(c.state.works.length, 1);
  const shared = page('designer').onShareAppMessage.call({ data: c.state });
  assert.equal(shared.path, '/packages/assistant/designer/designer?portfolioEntry=signed'); assert.ok(!JSON.stringify(shared).includes('11')); assert.equal(shared.imageUrl, '/packages/assistant/assets/designer-studio-book.png');
  assert.deepEqual(entryInput({ portfolioEntry: 'signed' }), { portfolioEntry: 'signed' });
  assert.throws(() => entryInput({ portfolioEntry: 'signed', conversationId: '11' }));
});
test('revocation and identity change prevent late source/image results from resurfacing', async () => {
  const { controller: c, client, setIdentity } = fixture(); let resolve;
  const original = client.read; client.read = path => path.endsWith('/works/12') ? new Promise(r => { resolve = r; }) : original(path);
  const pending = c.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work');
  for (let i = 0; i < 10 && !resolve; i++) await new Promise(r => setImmediate(r));
  assert.ok(resolve, 'work request should start'); setIdentity('session-b'); resolve(work()); await pending; assert.equal(c.state.work, null);
  const second = fixture(); await second.controller.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work');
  second.controller.fail({ statusCode: 404, code: 'portfolio_not_found' }, second.controller.epoch);
  assert.equal(second.controller.state.work, null); assert.deepEqual(second.controller.state.images, {}); assert.equal(second.controller.state.sharePath, '');
});
test('unknown mutation outcome retains key and body, reentry recovers the same explicit preference', async () => {
  const f = fixture(); let fail = true, sent = []; const client = new AssistantClient(async (path, method, body, options) => {
    if (method === 'POST' && path.endsWith('/preference')) { sent.push({ body: JSON.parse(JSON.stringify(body)), key: options.headers['Idempotency-Key'] }); if (fail) throw { statusCode: 503 }; return { success: true, data: { sentiment: 'like', preferenceVersion: 1 } }; }
    return { success: true, data: await f.client.read(path.replace('/miniprogram/assistant', ''), body) };
  });
  const c = new PortfolioController({ emit() {}, identity: () => 'session', client, images: { clear() {}, load: async () => '/private/test.jpg' } });
  const options = { conversationId: '11', workId: '12', versionId: '13' };
  await c.show(options, 'work'); await c.write('like'); assert.equal(c.state.pendingAction, 'like'); c.hide(); await c.show(options, 'work'); assert.equal(c.state.pendingAction, 'like');
  fail = false; await c.write(c.state.pendingAction); assert.deepEqual(sent[0], sent[1]); assert.equal(c.state.pendingAction, '');
});
test('authorized JPEG files bind exact work/version and are deleted when the page hides, even during a late write', async () => {
  const previous = global.wx, removed = []; let finish;
  global.wx = { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({ writeFile(args) { finish = args.success; }, unlink: args => removed.push(args.filePath) }) };
  try {
    const calls = [], images = new PortfolioImages({ read: async (path, data) => { calls.push({ path, data }); return { mimeType: 'image/jpeg', imageBase64: '/9j/AA==' }; } });
    const loading = images.load('11', work(), '15');
    for (let i = 0; i < 10 && !finish; i++) await new Promise(r => setImmediate(r));
    assert.ok(finish, 'authorized JPEG should reach file writing'); images.clear(); finish(); await assert.rejects(loading, e => e.code === 'context_changed');
    assert.equal(removed.length, 1); assert.deepEqual(calls[0].data, { versionId: '13', format: 'base64' });
    assert.equal(workForView(work()).metadata, '原木风 · 90㎡ · 两室');
  } finally { global.wx = previous; }
});
test('C01 reads recommendations without preference/contact writes and clears revoked cards', async () => {
  const state = {}, calls = []; let revoked = false;
  const c = new RecommendationController({ emit: p => Object.assign(state, p), identity: () => 'session', images: { clear() {}, load: async () => '/private/cover.jpg' }, client: { read: async path => { calls.push(path); if (revoked) throw { statusCode: 404, code: 'portfolio_not_found' }; return { items: [{ authorId: '14', work: work(), reason: '同城风格作品' }] }; } } });
  await c.load('11'); assert.equal(state.portfolioItems.length, 1); assert.equal(calls.length, 1);
  revoked = true; await c.load('11', true); assert.deepEqual(state.portfolioItems, []); assert.deepEqual(state.portfolioImages, {}); assert.ok(state.portfolioError);
});
test('return to consultation uses the matching original chat stack and does not start another conversation', () => {
  const oldWx = global.wx, oldPages = global.getCurrentPages; let back;
  global.wx = { navigateBack: x => { back = x; } }; global.getCurrentPages = () => [{ route: 'packages/assistant/chat/chat', data: { conversation: { id: '11' } } }, { route: 'packages/assistant/designer/designer' }, { route: 'packages/assistant/work/work' }];
  try { page('work').continueChat.call({ data: { conversationId: '11' } }); assert.deepEqual(back, { delta: 2 }); }
  finally { global.wx = oldWx; global.getCurrentPages = oldPages; }
});
test('shared-studio reentry restores only this account own consultation and a different identity creates its own', async () => {
  const oldWx = global.wx, storage = new Map(); let session = 'account-a', creates = 0;
  global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) };
  const f = fixture();
  const client = { pending: new Map(), read: async (path, input, headers, method) => {
    if (path === '/entry-context') return { entryToken: 'entry', portfolio: { authorId: '14', workId: '12' } };
    if (/^\/conversations\/2\d$/.test(path)) return { status: 'open' };
    return f.client.read(path, input, headers, method);
  }, mutate: async () => { creates += 1; return { id: String(20 + creates) }; } };
  const make = () => new PortfolioController({ emit() {}, identity: () => session, client, images: { clear() {}, load: async () => '/private/x.jpg' } });
  try {
    const c = make(); await c.show({ portfolioEntry: 'signed' }); assert.equal(c.state.conversationId, '21'); c.hide();
    const reopened = make(); await reopened.show({ portfolioEntry: 'signed' }); assert.equal(reopened.state.conversationId, '21'); assert.equal(creates, 1);
    session = 'account-b'; await reopened.show({ portfolioEntry: 'signed' }); assert.equal(reopened.state.conversationId, '22'); assert.equal(creates, 2);
  } finally { global.wx = oldWx; }
});
test('hiding during recovery of an uncertain write cannot restart a background page or publish late data', async () => {
  const f = fixture(); let finish;
  await f.controller.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work');
  f.client.mutate = () => new Promise(resolve => { finish = resolve; });
  const write = f.controller.write('like'); f.controller.hide();
  const show = f.controller.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work'); f.controller.hide();
  finish({ sentiment: 'like', preferenceVersion: 1 }); await write; await show;
  assert.equal(f.controller.visible, false); assert.deepEqual(f.controller.state.images, {});
});
test('malformed preference/create receipts retain their original operation instead of falsely reporting success', async () => {
  let complete = false; const receipts = [];
  const client = new AssistantClient(async (path, method, body, options) => {
    receipts.push(options.headers['Idempotency-Key']);
    return { success: true, data: complete ? { sentiment: 'like', preferenceVersion: 1 } : {} };
  });
  const slot = 'portfolio-write:11:12', body = { versionId: '13', sentiment: 'like', expectedVersion: 0 };
  await assert.rejects(client.mutate(slot, '/conversations/11/portfolio/works/12/preference', body), e => e.code === 'invalid_response');
  assert.ok(client.pending.has(slot)); complete = true; await client.mutate(slot, '/ignored', {}); assert.equal(receipts[0], receipts[1]);
  complete = false; await assert.rejects(client.mutate('portfolio-create:signed', '/conversations', { entryToken: 'entry' }), e => e.code === 'invalid_response');
  assert.ok(client.pending.has('portfolio-create:signed'));
});
