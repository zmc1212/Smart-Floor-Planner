const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { canAccessRoute } = require('../utils/identity-navigation');
const routeFile = path.resolve(__dirname, '../packages/construction/family/family.js');
const sheetFile = path.resolve(__dirname, '../packages/construction/family-sheet/family-sheet.js');
const root = '/miniprogram/construction/projects/19';
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(handler, setup = {}) {
  const calls = [], messages = [], downloads = [], media = [], app = { globalData: { token: 'session-a' } };
  const wx = {
    getStorageSync: () => '',
    reLaunch: options => messages.push(options.url),
    navigateTo: options => messages.push(options.url),
    showToast: options => messages.push(options.title),
    stopPullDownRefresh: () => messages.push('refresh-stopped'),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: setup.envVersion || 'develop' } }),
    previewImage: options => media.push({ preview: options.current }),
    saveImageToPhotosAlbum: options => {
      media.push({ saved: options.filePath });
      options.success?.();
    },
  };
  const api = {
    request: async (url, method, data, options) => {
      calls.push({ url, method, data, options });
      return handler(url, method, data);
    },
    downloadFile: async url => {
      downloads.push(url);
      if (setup.downloadFailure) throw { error: 'WeChat unavailable', statusCode: 502 };
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
    if (url.endsWith('/cameras')) return { data: { items: [{ id: '7', name: '客厅机位' }] } };
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
      return { data: { items: [{ id: '7', name: '客厅机位' }] } };
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

function readySheet(url, method) {
  if (url === root + '/family-viewers' && method === 'GET') return { data: [] };
  if (url === root + '/family-invite' && method === 'POST') return { data: { token: 'invite-token' } };
  throw new Error('unexpected request ' + method + ' ' + url);
}

test('the family sheet signs a share card and downloads the current build code on demand', async t => {
  for (const envVersion of ['develop', 'trial', 'release']) {
    const f = fixture(readySheet, { envVersion });
    const sheet = await f.sheet(t);
    assert.equal(sheet.shareInvite().path, '/packages/construction/family/family?projectId=19&invite=invite-token');
    assert.deepEqual(f.downloads, []);
    await sheet.toggleInviteCode();
    assert.equal(sheet.data.inviteCodePath, 'wxfile://invite-code.png');
    assert.deepEqual(f.downloads, [root + '/family-invite-code?env=' + envVersion]);
    await sheet.toggleInviteCode();
    await sheet.toggleInviteCode();
    assert.equal(f.downloads.length, 1);
  }
  const markup = fs.readFileSync(path.join(path.dirname(sheetFile), 'family-sheet.wxml'), 'utf8');
  assert.match(markup, /open-type="share" data-share-type="owner-family"/);
  assert.match(markup, /换一张邀请卡/);
});

test('a code download failure keeps the share card available and supports retry, preview and save', async t => {
  const config = { envVersion: 'trial', downloadFailure: true };
  const f = fixture(readySheet, config);
  const sheet = await f.sheet(t);
  await sheet.toggleInviteCode();
  assert.equal(sheet.data.inviteCodePath, '');
  assert.equal(sheet.data.inviteCodeError, '邀请码暂时无法生成，请重试。');
  assert.match(sheet.shareInvite().path, /invite=invite-token/);

  config.downloadFailure = false;
  await sheet.loadInviteCode();
  assert.equal(sheet.data.inviteCodeError, '');
  assert.equal(sheet.data.inviteCodePath, 'wxfile://invite-code.png');
  assert.equal(f.downloads.at(-1), root + '/family-invite-code?env=trial');
  sheet.previewInviteCode();
  sheet.saveInviteCode();
  assert.deepEqual(f.media, [{ preview: 'wxfile://invite-code.png' }, { saved: 'wxfile://invite-code.png' }]);
  assert.equal(f.messages.at(-1), '已保存到相册');
});

test('invite generation reports failure and a failed replacement leaves the previous share card valid', async t => {
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
  assert.equal(sheet.shareInvite(), null);
  await sheet.createInvite();
  assert.match(sheet.shareInvite().path, /invite=card-2/);
  await sheet.createInvite();
  assert.equal(sheet.data.inviteError, '邀请暂时无法生成，请重试。');
  assert.equal(sheet.data.inviteToken, 'card-2');
  await sheet.createInvite();
  assert.equal(sheet.data.inviteError, '');
  assert.match(sheet.shareInvite().path, /invite=card-4/);
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
  assert.ok(sheet.shareInvite());
  const refresh = sheet.loadViewers();
  f.app.globalData.token = 'session-b';
  complete({ data: [{ viewerId: '31', nickname: '家人', version: 1 }] });
  await refresh;
  assert.deepEqual(sheet.data.viewers, []);
  assert.equal(sheet.shareInvite(), null);
  assert.equal(f.downloads.length, 0);
});
