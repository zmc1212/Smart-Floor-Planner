const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NearbyLocationController } = require('../packages/assistant/lib/location');
const region = () => ({ cityCode: '330100', cityName: '杭州市', district: '西湖区', source: 'wechat_location', resolvedAt: new Date().toISOString() });
test('the composer send reaches the controller directly and location stays off the send path', async () => {
  const previous = global.Page; let page;
  global.Page = value => { page = value; };
  try { require('../packages/assistant/chat/chat'); } finally { global.Page = previous; }
  const events = [], context = { _alive: true, _shown: true, data: { draft: '我想看看附近的工地', canSend: true },
    controller: { send: async () => events.push('send') },
    syncLocation: async () => { events.push('location'); return {}; } };
  await page.send.call(context); assert.deepEqual(events, ['send']);
  context._alive = false; events.length = 0;
  await page.send.call(context); assert.deepEqual(events, []);
  context._alive = true; context.data.conversation = null; events.length = 0;
  await page.send.call(context); assert.deepEqual(events, ['send']);
  const previousApp = global.getApp; global.getApp = () => ({ globalData: { token: 'synthetic' } });
  try {
    for (const state of ['pendingSend', 'pendingAction', 'uncertainRun']) {
      const pending = { data: { conversation: { id: '11' }, [state]: true }, location: { ensure: () => { throw Error('Must recover the original operation before updating location'); } } };
      assert.deepEqual(await page.syncLocation.call(pending), {});
    }
  } finally { global.getApp = previousApp; }
});
function fixture(setting, fix = { latitude: 30.25, longitude: 120.13 }) {
  const calls = [], saved = new Map(); let session = 'synthetic-a', fixes = 0;
  global.wx = { getSetting: ({ success }) => success({ authSetting: setting }), getLocation: ({ type, success, fail }) => {
    fixes++; assert.equal(type, 'gcj02');
    if (fix.errMsg) return fail(fix);
    setting['scope.userLocation'] = true;
    success(fix);
  } };
  const controller = new NearbyLocationController({ identity: () => session, client: { read: async (path, body, headers, method = 'GET') => {
    calls.push({ path, body, headers, method });
    if (method === 'DELETE') saved.delete(path);
    if (method === 'POST') saved.set(path, region());
    return { region: saved.get(path) || null };
  } } });
  return { controller, calls, fixes: () => fixes, session: value => { session = value; } };
}
test('only an explicit action requests ungranted location; payload is sent in POST body with no journal', async () => {
  const old = global.wx;
  try {
    const f = fixture({}); await f.controller.ensure('11'); assert.equal(f.fixes(), 0);
    const result = await f.controller.ensure('11', true); assert.equal(result.region.cityCode, '330100'); assert.equal(f.fixes(), 1);
    const post = f.calls.find(c => c.method === 'POST'); assert.deepEqual(post.body, { latitude: 30.25, longitude: 120.13, coordinateSystem: 'gcj02' }); assert.deepEqual(post.headers, {});
    await f.controller.ensure('11', true); assert.equal(f.fixes(), 1);
  } finally { global.wx = old; }
});
test('denial clears server region without repeated permission prompts; failure recovers on retry', async () => {
  const old = global.wx;
  try {
    const f = fixture({ 'scope.userLocation': false }); const denied = await f.controller.ensure('11', true);
    assert.equal(f.fixes(), 0); assert.match(denied.notice, /定位未授权/); assert.equal(f.calls.at(-1).method, 'DELETE');
    const broken = fixture({ 'scope.userLocation': true }, { errMsg: 'getLocation:fail' });
    assert.ok((await broken.controller.ensure('11', true)).notice); assert.equal(broken.calls.at(-1).method, 'DELETE');
    global.wx.getLocation = ({ success }) => success({ latitude: 30.25, longitude: 120.13 });
    assert.ok((await broken.controller.ensure('11', true)).region);
  } finally { global.wx = old; }
});
test('an ungranted or failing location latches its cleanup; explicit permission requests still retry', async () => {
  const old = global.wx;
  try {
    const f = fixture({});
    const first = await f.controller.ensure('11');
    assert.equal(first.changed, true);
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
    const latch = await f.controller.ensure('11');
    assert.deepEqual(latch, {});
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1, 'latched calls must not repeat the DELETE');
    // An explicit request is never latched: with the scope undecided it goes
    // through the wx permission flow, and a successful fix clears the latch.
    const asked = await f.controller.ensure('11', true);
    assert.ok(asked.region);
    assert.equal(f.controller.denied, null);
    // A hard denial with an explicit request still reports the notice.
    const refused = fixture({ 'scope.userLocation': false });
    assert.match((await refused.controller.ensure('11', true)).notice, /定位未授权/);
    assert.equal(refused.calls.at(-1).method, 'DELETE');
    // Identity change never reuses the previous latch.
    f.session('synthetic-b');
    const other = await f.controller.ensure('11');
    assert.equal(other.changed, true);
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 2, 'a new identity never reuses the latch');
    const broken = fixture({ 'scope.userLocation': true }, { errMsg: 'getLocation:fail' });
    assert.ok((await broken.controller.ensure('11')).notice);
    assert.deepEqual(await broken.controller.ensure('11'), {});
    assert.equal(broken.calls.filter(call => call.method === 'DELETE').length, 1, 'a failed fix latches the cleanup too');
    global.wx.getLocation = ({ success }) => success({ latitude: 30.25, longitude: 120.13 });
    const recovered = await broken.controller.ensure('11', true);
    assert.ok(recovered.region);
    assert.equal(broken.controller.denied, null, 'a successful fix clears the latch');
  } finally { global.wx = old; }
});

test('the denial cache is scoped to the conversation and a changed permission bypasses it', async () => {
  const old = global.wx;
  try {
    const setting = {}, f = fixture(setting);
    await f.controller.ensure('11');
    f.controller.clear();
    await f.controller.ensure('11');
    await f.controller.ensure('12');
    assert.deepEqual(f.calls.filter(c => c.method === 'DELETE').map(c => c.path), [
      '/conversations/11/location', '/conversations/12/location',
    ]);
    setting['scope.userLocation'] = true;
    assert.ok((await f.controller.ensure('12')).region);
    assert.equal(f.fixes(), 1);
  } finally { global.wx = old; }
});

test('an explicit permission tap during a passive setting check gets the permission flow', async () => {
  const old = global.wx;
  try {
    const setting = {}, f = fixture(setting);
    let resolve;
    global.wx.getSetting = ({ success }) => { resolve = success; };
    const passive = f.controller.ensure('11');
    const explicit = f.controller.ensure('11', true);
    resolve({ authSetting: setting });
    const results = await Promise.all([passive, explicit]);
    assert.ok(results[0].region && results[1].region);
    assert.equal(f.fixes(), 1);
    assert.deepEqual(f.calls.map(call => call.method), ['POST']);
  } finally { global.wx = old; }
});

test('a known empty conversation reuses granted location without requesting permission on entry', async () => {
  const old = global.wx;
  try {
    const setting = {}, f = fixture(setting);
    await f.controller.ensure('11', false, true);
    assert.equal(f.fixes(), 0);
    assert.deepEqual(f.calls, []);
    setting['scope.userLocation'] = true;
    assert.ok((await f.controller.ensure('11', false, true)).region);
    assert.deepEqual(f.calls.map(call => call.method), ['POST']);
  } finally { global.wx = old; }
});

test('a deferred or superseded lookup does not clear an existing location', async () => {
  const old = global.wx;
  try {
    const f = fixture({ 'scope.userLocation': true });
    let superseded = false, deletes = 0, posts = 0;
    f.controller.client.read = async (_path, _body, _headers, method) => {
      if (method === 'DELETE') deletes++;
      if (method !== 'POST') return { region: null };
      posts++;
      if (superseded) throw { statusCode: 409, code: 'context_changed' };
      return { region: null, deferred: true };
    };
    assert.deepEqual(await f.controller.ensure('11'), { region: null, deferred: true });
    superseded = true;
    assert.equal((await f.controller.ensure('11', true)).blocked, true);
    assert.equal(posts, 2);
    assert.equal(deletes, 0);
  } finally { global.wx = old; }
});
test('reentry reuses a recent server region; switching identity while acquiring discards late location', async () => {
  const old = global.wx;
  try {
    const f = fixture({ 'scope.userLocation': true }); await f.controller.ensure('11'); f.controller.clear(); await f.controller.ensure('11'); assert.equal(f.fixes(), 1);
    const late = fixture({ 'scope.userLocation': true }); let finish;
    global.wx.getLocation = ({ success }) => { finish = success; };
    const pending = late.controller.ensure('11'); while (!finish) await new Promise(r => setImmediate(r));
    late.session('synthetic-b'); finish({ latitude: 30.25, longitude: 120.13 }); assert.deepEqual(await pending, {}); assert.equal(late.calls.filter(c => c.method === 'POST').length, 0);
  } finally { global.wx = old; }
});
