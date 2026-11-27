const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { canAccessRoute } = require('../utils/identity-navigation');
const routeFile = path.resolve(__dirname, '../packages/construction/family/family.js');
const sheetFile = path.resolve(__dirname, '../packages/construction/family-sheet/family-sheet.js');
const playerFile = path.resolve(__dirname, '../packages/construction/components/native-live-player/native-live-player.js');
const root = '/miniprogram/construction/projects/19';
const shareProject = { id: '19', communityName: '澄光里', areaLabel: '108㎡' };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(handler, setup = {}) {
  const calls = [], messages = [], downloads = [], media = [], app = { globalData: { token: 'session-a' } };
  const wx = {
    getStorageSync: () => '',
    reLaunch: options => messages.push(options.url),
    navigateTo: options => messages.push(options.url),
    showToast: options => messages.push(options.title),
    stopPullDownRefresh: () => messages.push('refresh-stopped'),
    createVideoContext: id => ({
      requestFullScreen: options => media.push({ id, fullscreen: options }),
      stop: () => media.push({ id, stopped: true }),
      exitFullScreen: () => media.push({ id, fullscreen: false }),
    }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: setup.envVersion || 'develop' } }),
    previewImage: options => media.push({ preview: options.current }),
  };
  const api = {
    request: async (url, method, data, options) => {
      calls.push({ url, method, data, options });
      return handler(url, method, data);
    },
    downloadFile: async url => {
      downloads.push(url);
      if (setup.downloadFailure) throw { error: 'WeChat unavailable', statusCode: 502 };
      if (setup.download) return setup.download();
      return { tempFilePath: 'wxfile://invite-code.png', statusCode: 200 };
    },
  };
  function load(filename, kind) {
    let definition;
    const localRequire = createRequire(filename);
    new Function('require', kind, 'getApp', 'wx', fs.readFileSync(filename, 'utf8'))(
      name => (name.includes('utils/api') ? api : localRequire(name)),
      value => { definition = value; },
      () => app,
      wx,
    );
    return definition;
  }
  function instance(definition, fields) {
    return { ...fields, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
  }
  return {
    app, calls, messages, downloads, media,
    page() {
      const definition = load(routeFile, 'Page');
      return instance(definition, definition);
    },
    player() {
      const definition = load(playerFile, 'Component');
      return { ...instance(definition, definition.methods), triggerEvent: name => messages.push(name) };
    },
    async sheet(t) {
      const definition = load(sheetFile, 'Component');
      const sheet = instance(definition, definition.methods);
      sheet.data.projectId = '19';
      sheet.triggerEvent = name => messages.push(name);
      definition.lifetimes.attached.call(sheet);
      t.after(() => definition.lifetimes.detached.call(sheet));
      await tick();
      return sheet;
    },
  };
}

test('the family site route is available to customers and closed to unrelated staff', () => {
  const route = '/packages/construction/family/family';
  assert.equal(canAccessRoute(route, { role: 'customer', mode: 'customer' }), true);
  assert.equal(canAccessRoute(route, { mode: 'staff', staffRole: 'construction_staff' }), false);
  assert.equal(canAccessRoute('/packages/construction/camera/camera', { role: 'customer', mode: 'customer' }), true);
});

test('a legacy cloud-site owner link opens the matching project in the owner Site tab', async () => {
  const f = fixture((url, method) => {
    assert.equal(method, 'GET');
    assert.equal(url, '/miniprogram/construction/customer-projects?projectId=19');
    return { data: [{ id: '19', name: '工地 A · 13100000000', leadId: '8', role: 'owner' }] };
  });
  const page = f.page();
  page.onLoad({ projectId: '19' });
  await page.load();
  assert.deepEqual(f.messages, ['/pages/index/index?customerTab=service&familyProject=19']);
  assert.equal(f.calls.length, 1);
});

test('a family share card is accepted before reading the project, with no management calls', async () => {
  const f = fixture((url, method) => {
    if (url.startsWith('/miniprogram/construction/family-invites/')) return { data: { projectId: '19', access: 'family_view' } };
    if (url.startsWith('/miniprogram/construction/customer-projects')) {
      return { data: [{ id: '19', name: '工地 A', leadId: '8', role: 'family' }] };
    }
    if (url.endsWith('/progress')) return { data: { access: 'family_view', progress: { overall: { color: 'yellow', label: '正常' }, construction: { stageName: '水电' }, summary: '施工计划V1', nodes: [] } } };
    if (url.endsWith('/cameras')) return { data: { items: [{ id: '7', binding_id: '31', name: '客厅机位' }] } };
    throw new Error('unexpected request ' + method + ' ' + url);
  });
  const page = f.page();
  page.onLoad({ projectId: '99', invite: 'signed-card' });
  await page.load();
  assert.equal(f.calls[0].url, '/miniprogram/construction/family-invites/signed-card/accept');
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[1].url, '/miniprogram/construction/customer-projects?projectId=19');
  assert.equal(page.data.role, 'family');
  assert.deepEqual(f.calls.slice(2).map(call => call.url), [root + '/progress', '/miniprogram/construction/video/projects/19/cameras']);
  page.openCamera();
  assert.equal(f.messages.at(-1), '/packages/construction/camera/camera?projectId=19');
});

test('a scanned current-version code scene becomes the family invitation', async () => {
  const f = fixture((url, method) => {
    if (url.startsWith('/miniprogram/construction/family-invites/')) return { data: { projectId: '19', access: 'family_view' } };
    if (url.startsWith('/miniprogram/construction/customer-projects')) {
      return { data: [{ id: '19', name: '工地 A', leadId: '8', role: 'family' }] };
    }
    if (url.endsWith('/progress')) return { data: { access: 'family_view', progress: null } };
    if (url.endsWith('/cameras')) return { data: { items: [] } };
    throw new Error('unexpected request ' + method + ' ' + url);
  });
  const page = f.page();
  page.onLoad({ scene: encodeURIComponent('f1.19.abcd.abcdefghijkl') });
  await page.load();
  assert.equal(f.calls[0].url, '/miniprogram/construction/family-invites/f1.19.abcd.abcdefghijkl/accept');
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(page.data.role, 'family');
});

test('returning after family revocation clears progress and live access with one permission message', async () => {
  let allowed = true;
  const f = fixture(url => {
    if (url.startsWith('/miniprogram/construction/customer-projects')) {
      return { data: [{ id: '19', name: '工地 A', role: 'family' }] };
    }
    if (url.endsWith('/progress')) {
      if (!allowed) throw { error: 'construction_not_found', statusCode: 404 };
      return { data: { progress: { overall: { label: '未排期' } } } };
    }
    if (url.endsWith('/cameras')) {
      if (!allowed) throw { error: 'camera_project_unavailable', statusCode: 404 };
      return { data: { items: [{ id: '7', binding_id: '31', name: '客厅机位' }] } };
    }
    throw new Error('unexpected request ' + url);
  });
  const page = f.page();
  page.onLoad({ projectId: '19' });
  await page.load();
  assert.ok(page.data.progress);
  assert.equal(page.data.cameras.length, 1);

  allowed = false;
  await page.refreshProject();
  assert.equal(page.data.progress, null);
  assert.deepEqual(page.data.cameras, []);
  assert.equal(page.data.progressError, '暂时无法查看这个工地。');
  assert.equal(page.data.cameraError, page.data.progressError);
  page.openCamera();
  assert.deepEqual(f.messages, []);
});

const mediaRoot = '/miniprogram/construction/video/projects/19/native-live/';
const nativeTicket = 'n1.1454.' + 'x'.repeat(43);
const nativeAddress = 'https://camera.example.test/camera-media/native/' + nativeTicket + '/1/hls.m3u8';

test('the live component starts muted, lets a private viewer unmute, and resets on a new stream', () => {
  const f = fixture(() => assert.fail('player controls do not call an API directly'));
  const player = f.player();
  player.setData({ src: nativeAddress, phase: 'playing', audioAllowed: false });
  player.toggleAudio();
  assert.equal(player.data.muted, true);

  player.setData({ audioAllowed: true });
  player.toggleAudio();
  assert.equal(player.data.muted, false);
  player.sourceChanged('next address', nativeAddress);
  assert.equal(player.data.muted, true);

  player.fullscreen();
  player.stop();
  assert.deepEqual(f.media, [
    { id: 'site-live-video', fullscreen: { direction: 90 } },
    { id: 'site-live-video', stopped: true },
  ]);
  assert.deepEqual(f.messages, ['stop']);
});

test('the family player accepts the server-issued synthetic binding', () => {
  const { normalizeFamilyCameras } = require('../packages/construction/family/family-live');
  assert.deepEqual(normalizeFamilyCameras([
    { binding_id: 'test-pattern', name: '调试机位' },
    { binding_id: 'unrecognized-source', name: '无效机位' },
  ]), [{ bindingId: 'test-pattern', name: '调试机位' }]);
});

test('family detail starts inline with the binding, closes on hide and opens a fresh session on return', async t => {
  const f = fixture((url, method, body) => {
    if (url.startsWith('/miniprogram/construction/customer-projects')) return { data: [{ id: '19', role: 'family' }] };
    if (url.endsWith('/progress')) return { data: { progress: { construction: { stageName: '水电' } } } };
    if (url.endsWith('/cameras')) return { data: { items: [{ id: '7', binding_id: '31', name: '客厅机位' }] } };
    if (url === mediaRoot + 'start') {
      assert.deepEqual(body, { bindingId: '31' });
      return { data: { ticket: nativeTicket, url: nativeAddress, expiresIn: 60 } };
    }
    if (url === mediaRoot + 'stop') return { data: { stopped: true } };
    assert.fail('unexpected family request ' + method + ' ' + url);
  });
  const page = f.page();
  t.after(() => page.onUnload());
  page.onLoad({ projectId: '19' });
  page.onShow();
  await tick();
  assert.equal(page.data.progress.construction.stageName, '水电');
  assert.equal(page.data.liveSrc, nativeAddress);
  assert.equal(page.data.livePhase, 'connecting');
  const previousEpoch = page.data.liveEpoch;
  page.onLiveAdvance({ detail: { epoch: previousEpoch } });
  assert.equal(page.data.livePhase, 'playing');
  assert.deepEqual(f.messages, []);

  page.onHide();
  assert.equal(page.data.liveSrc, '');
  assert.ok(f.calls.some(call => call.url === mediaRoot + 'stop' && call.data.ticket === nativeTicket));
  page.onShow();
  await tick();
  assert.equal(page.data.liveSrc, nativeAddress);
  assert.equal(f.calls.filter(call => call.url === mediaRoot + 'start').length, 2);
  page.onLiveError({ detail: { epoch: previousEpoch } });
  assert.equal(page.data.liveSrc, nativeAddress);

  page.openCamera();
  assert.equal(f.messages.at(-1), '/packages/construction/camera/camera?projectId=19');
  assert.equal(page.data.liveSrc, '');
});

test('a denied heartbeat clears current media and rechecks the family grant', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let allowed = true;
  const f = fixture(url => {
    if (url.startsWith('/miniprogram/construction/customer-projects')) return { data: [{ id: '19', role: 'family' }] };
    if (url.endsWith('/progress') || url.endsWith('/cameras')) {
      if (!allowed) throw { error: url.endsWith('/progress') ? 'construction_not_found' : 'camera_project_unavailable', statusCode: 404 };
      if (url.endsWith('/progress')) return { data: { progress: { construction: { stageName: '水电' } } } };
      return { data: { items: [{ binding_id: '31', name: '客厅机位' }] } };
    }
    if (url === mediaRoot + 'start') return { data: { ticket: nativeTicket, url: nativeAddress, expiresIn: 60 } };
    if (url === mediaRoot + 'heartbeat') throw { error: 'camera_session_expired', statusCode: 401 };
    if (url === mediaRoot + 'stop') return { data: { stopped: true } };
    assert.fail('unexpected request ' + url);
  });
  const page = f.page();
  t.after(() => page.onUnload());
  page.onLoad({ projectId: '19' });
  page.onShow();
  await tick();
  page.onLiveAdvance({ detail: { epoch: page.data.liveEpoch } });
  allowed = false;
  t.mock.timers.tick(20000);
  await tick();
  assert.equal(page.data.liveSrc, '');
  assert.equal(page.data.progress, null);
  assert.deepEqual(page.data.cameras, []);
  assert.equal(page.data.cameraError, '暂时无法查看这个工地。');
  assert.equal(f.calls.filter(call => call.url === mediaRoot + 'start').length, 1);
});

function readySheet(url, method) {
  if (url === root + '/family-viewers' && method === 'GET') return { data: [] };
  if (url === root + '/family-invite' && method === 'POST') return { data: { token: 'invite-token' } };
  throw new Error('unexpected request ' + method + ' ' + url);
}

test('the family sheet uses its dedicated cover and opens the current build code in a separate view', async t => {
  for (const envVersion of ['develop', 'trial', 'release']) {
    const f = fixture(readySheet, { envVersion });
    const sheet = await f.sheet(t);
    assert.deepEqual(sheet.shareInvite(shareProject), {
      title: '澄光里 108㎡ · 装修进度',
      path: '/packages/construction/family/family?projectId=19&invite=invite-token',
      imageUrl: '/packages/construction/assets/notebook/family-invite-share-cover.jpg',
    });
    assert.deepEqual(f.downloads, []);
    await sheet.openInviteCode();
    assert.equal(sheet.data.inviteCodeOpen, true);
    assert.equal(sheet.data.inviteCodePath, 'wxfile://invite-code.png');
    assert.equal(sheet.shareInvite(shareProject), null);
    assert.deepEqual(f.downloads, [root + '/family-invite-code?env=' + envVersion]);
    sheet.closeInviteCode();
    assert.equal(sheet.data.inviteCodePath, '');
    await sheet.openInviteCode();
    assert.equal(f.downloads.length, 2);
  }
  const markup = fs.readFileSync(path.join(path.dirname(sheetFile), 'family-sheet.wxml'), 'utf8');
  assert.match(markup, /open-type="share" data-share-type="owner-family"/);
  assert.match(markup, /微信邀请家人/);
  assert.match(markup, /请家人用微信扫一扫/);
  assert.doesNotMatch(markup, /换一张邀请卡|查看邀请小程序码|保存小程序码/);
});

test('family share uses the selected project short name and keeps legacy address details off the card', async t => {
  const f = fixture(readySheet);
  const sheet = await f.sheet(t);
  assert.equal(sheet.shareInvite({ ...shareProject, id: '20' }), null);
  assert.equal(sheet.data.inviteToken, 'invite-token');

  const cases = [
    { communityName: '澄光里６栋 ２单元１５０１室', areaLabel: '108㎡', title: '澄光里 108㎡ · 装修进度' },
    { communityName: '澄光里1-2-1501', areaLabel: '89㎡', title: '澄光里 89㎡ · 装修进度' },
    { communityName: '澄光里', title: '澄光里 · 装修进度' },
    { communityName: '丰收路18号 3栋', areaLabel: '108㎡', title: '邀请你看我家的装修进度' },
    { communityName: '', name: '兴华路18号西单元401室', title: '邀请你看我家的装修进度' },
  ];
  for (const { title, ...project } of cases) {
    const share = sheet.shareInvite({ id: shareProject.id, ...project });
    assert.equal(share.title, title);
    assert.match(share.path, /projectId=19&invite=invite-token$/);
    await tick();
  }
});

test('a code download failure supports retry and preserves the prepared share card on return', async t => {
  const config = { envVersion: 'trial', downloadFailure: true };
  const f = fixture(readySheet, config);
  const sheet = await f.sheet(t);
  await sheet.openInviteCode();
  assert.equal(sheet.data.inviteCodePath, '');
  assert.equal(sheet.data.inviteCodeError, '邀请码暂时无法生成，请重试。');

  config.downloadFailure = false;
  await sheet.loadInviteCode();
  assert.equal(sheet.data.inviteCodeError, '');
  assert.equal(sheet.data.inviteCodePath, 'wxfile://invite-code.png');
  assert.equal(f.downloads.at(-1), root + '/family-invite-code?env=trial');
  sheet.previewInviteCode();
  assert.deepEqual(f.media, [{ preview: 'wxfile://invite-code.png' }]);
  sheet.closeInviteCode();
  assert.match(sheet.shareInvite(shareProject).path, /invite=invite-token/);
});

test('each handoff prepares a fresh single-use card and failed preparation retries without sharing the old card', async t => {
  let attempt = 0;
  const f = fixture((url, method) => {
    if (url.endsWith('/family-invite')) {
      attempt += 1;
      if (attempt === 1 || attempt === 3) throw Object.assign(new Error('database diagnostic'), { statusCode: 503 });
      return { data: { token: 'card-' + attempt } };
    }
    return readySheet(url, method);
  });
  const sheet = await f.sheet(t);
  assert.equal(sheet.data.inviteError, '邀请暂时无法生成，请重试。');
  assert.equal(sheet.shareInvite(shareProject), null);
  await sheet.createInvite();
  assert.match(sheet.shareInvite(shareProject).path, /invite=card-2/);
  assert.equal(sheet.shareInvite(shareProject), null);
  await tick();
  assert.equal(sheet.data.inviteError, '邀请暂时无法生成，请重试。');
  assert.equal(sheet.data.inviteToken, '');
  await sheet.createInvite();
  assert.equal(sheet.data.inviteError, '');
  assert.match(sheet.shareInvite(shareProject).path, /invite=card-4/);
  await tick();
  assert.match(sheet.shareInvite(shareProject).path, /invite=card-5/);
});

test('returning from scanning ignores late code responses and refreshes the joined family list', async t => {
  const pending = [];
  let joined = false;
  const f = fixture((url, method) => {
    if (joined && url.endsWith('/family-viewers')) return { data: [{ viewerId: '31', nickname: '妈妈', version: 1 }] };
    return readySheet(url, method);
  }, { download: () => new Promise(resolve => pending.push(resolve)) });
  const sheet = await f.sheet(t);
  const old = sheet.openInviteCode();
  sheet.closeInviteCode();
  const fresh = sheet.openInviteCode();
  pending[0]({ tempFilePath: 'wxfile://old.png' });
  await old;
  assert.equal(sheet.data.inviteCodePath, '');
  assert.equal(sheet.data.inviteCodeLoading, true);
  pending[1]({ tempFilePath: 'wxfile://fresh.png' });
  await fresh;
  assert.equal(sheet.data.inviteCodePath, 'wxfile://fresh.png');
  joined = true;
  sheet.closeInviteCode();
  await tick();
  assert.deepEqual(sheet.data.viewers, [{ viewerId: '31', nickname: '妈妈', version: 1 }]);
});

test('the owner can remove a family viewer without passing phone identifiers to the template', async t => {
  let allowed = true;
  const f = fixture((url, method, body) => {
    if (url === root + '/family-viewers') return { data: allowed ? [
      { viewerId: '31', nickname: '131****0000', phoneMasked: '131****0000', version: 2 },
    ] : [] };
    if (url === root + '/family-viewers/31' && method === 'POST') {
      assert.deepEqual(body, { expectedVersion: 2, allowed: false });
      allowed = false;
      return { data: { allowed } };
    }
    return readySheet(url, method);
  });
  const sheet = await f.sheet(t);
  assert.deepEqual(sheet.data.viewers, [{ viewerId: '31', nickname: '家人', version: 2 }]);
  await sheet.revokeViewer({ currentTarget: { dataset: { viewer: '31', version: 2 } } });
  assert.match(f.calls.find(call => call.url.endsWith('/31')).options.headers['Idempotency-Key'], /^family-/);
  assert.equal(f.messages.at(-1), '已移除');
  assert.deepEqual(sheet.data.viewers, []);
  const reopened = await f.sheet(t);
  assert.deepEqual(reopened.data.viewers, []);
});

test('a family sheet discards late owner data after a session change and cannot share it', async t => {
  let complete;
  let readCount = 0;
  const f = fixture((url, method) => {
    if (url.endsWith('/family-viewers') && ++readCount > 1) return new Promise(resolve => { complete = resolve; });
    return readySheet(url, method);
  });
  const sheet = await f.sheet(t);
  assert.ok(sheet.shareInvite(shareProject));
  const refresh = sheet.loadViewers();
  f.app.globalData.token = 'session-b';
  complete({ data: [{ viewerId: '31', nickname: '家人', version: 1 }] });
  await refresh;
  assert.deepEqual(sheet.data.viewers, []);
  assert.equal(sheet.shareInvite(shareProject), null);
  assert.equal(f.downloads.length, 0);
});
