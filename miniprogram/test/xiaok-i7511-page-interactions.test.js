/* I7.5.11 page-level interaction acceptance. These tests execute the real page
   definitions and handlers on a Node host (mocked wx/API), not a DevTools or
   real-device run. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const api = require('../utils/api');

function pageFrom(file) {
  let definition = null;
  const local = createRequire(file);
  const handlers = {};
  const wx = new Proxy(handlers, {
    get: (target, key) => key in target ? target[key] : (() => ({})),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const app = { globalData: { token: 'token-a', bootstrap: null, userInfo: null, sessionHydrationPromise: Promise.resolve() }, hydrateStoredSession: async () => {} };
  const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  new Function('require', 'Page', 'Component', 'getApp', 'wx', 'getCurrentPages', source)(
    id => { try { return local(id); } catch { return {}; } }, p => { definition = p; }, p => { definition = p; },
    () => app, wx, () => []);
  return { definition, app, wx };
}

function instance(definition) {
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

test('a new owner reminder prompts once, dismiss keeps the count, and viewing retries the read receipt', async t => {
  const previousRequest = api.request;
  global.getApp = () => ({ globalData: { token: 'owner-reminder-chat' } });
  global.wx = { getStorageSync: () => '' };
  const inbox = require('../utils/owner-reminders');
  const page = instance(require('../packages/assistant/chat/chat-definition')());
  page._alive = page._shown = true;
  page.openSheet = sheet => page.setData({ sheet });
  t.after(() => { page.stopOwnerReminderRefresh(); api.request = previousRequest; delete global.getApp; delete global.wx; });

  const items = [{ reminderId: 'rem_a', projectId: '9', title: '水电阶段已开始' }];
  let failed = false;
  const writes = [];
  api.request = async (url, method, data) => {
    assert.equal(url, '/miniprogram/xiaok/reminders/owner');
    const unread = items.filter(item => !item.readAt);
    if (method === 'GET') return { data: { unreadCount: unread.length, next: unread.find(item => !item.prompted) } };
    const item = items.find(item => item.reminderId === data.reminderId && item.projectId === data.projectId);
    writes.push(data.action);
    if (data.action === 'prompt') { item.prompted = true; return { data: { prompt: item } }; }
    if (!failed) { failed = true; throw { statusCode: 503 }; }
    item.readAt = '2026-11-17T00:00:00Z';
    return { data: { item: { ...item, body: '核对水电阶段的施工安排。' } } };
  };
  const refresh = async () => {
    clearTimeout(page._ownerReminderTimer);
    page._ownerReminderVisit = (page._ownerReminderVisit || 0) + 1;
    await page.refreshOwnerReminder(page._ownerReminderVisit, 'owner-reminder-chat');
  };

  await refresh();
  assert.equal(page.data.ownerReminderPrompt.reminderId, 'rem_a');
  page.dismissOwnerReminder();
  page.stopOwnerReminderRefresh();
  await refresh();
  assert.equal(page.data.ownerReminderPrompt, null);
  assert.equal(inbox.summary().unreadCount, 1);
  assert.deepEqual(writes, ['prompt']);

  items.unshift({ reminderId: 'rem_b', projectId: '9', title: '请核对插座位置' });
  page.focusInput();
  await refresh();
  assert.equal(page.data.ownerReminderPrompt, null);
  assert.equal(inbox.summary().unreadCount, 2);
  page.blurInput();
  await refresh();
  assert.equal(page.data.ownerReminderPrompt.reminderId, 'rem_b');
  await page.openOwnerReminder();
  assert.equal(page.data.ownerReminderPrompt, null);
  assert.equal(page.data.sheet, 'ownerReminder');
  assert.match(page.data.ownerReminderError, /重试/u);
  assert.equal(inbox.summary().unreadCount, 2);
  await page.readOwnerReminder();
  assert.equal(page.data.ownerReminderDetail.body, '核对水电阶段的施工安排。');
  assert.equal(inbox.summary().unreadCount, 1);
  assert.deepEqual(writes, ['prompt', 'prompt', 'read', 'read']);
});

test('the owner site lists reminders for the selected project and clears the badge after a confirmed read', async t => {
  const { definition, app } = pageFrom(path.join(root, 'packages/construction/owner-home/owner-home.js'));
  const originalRequest = api.request;
  global.getApp = () => app;
  global.wx = { getStorageSync: () => '' };
  t.after(() => { api.request = originalRequest; delete global.getApp; delete global.wx; delete global.getCurrentPages; });

  app.globalData.token = 'owner-reminder-site';
  const page = instance({ ...definition.methods, data: definition.data });
  page._visible = true;
  page._generation = 1;
  page._projectSession = 'owner-reminder-site';
  page.data.project = { id: '9', progressAccess: true };
  const inbox = require('../utils/owner-reminders');
  const badges = [];
  global.getCurrentPages = () => [{ selectComponent: () => ({ syncReminderBadge: () => badges.push(inbox.summary().unreadCount) }) }];
  const item = { reminderId: 'rem_a', projectId: '9', title: '水电阶段已开始', deliveredAt: '2026-11-17T00:00:00Z', readAt: null };
  api.request = async (url, method, data) => {
    if (url.endsWith('?projectId=9')) return { data: { items: [item] } };
    if (method === 'GET') return { data: { unreadCount: item.readAt ? 0 : 1 } };
    assert.deepEqual(data, { action: 'read', projectId: '9', reminderId: 'rem_a' });
    item.readAt = '2026-11-17T00:05:00Z';
    return { data: { item: { ...item, body: '请查看阶段注意事项。' } } };
  };

  await inbox.refreshSummary();
  await page.toggleSiteReminders();
  assert.equal(page.data.siteReminders[0].readAt, null);
  await page.openSiteReminder({ currentTarget: { dataset: { id: 'rem_a' } } });
  assert.equal(page.data.reminderDetail.body, '请查看阶段注意事项。');
  assert.equal(page.data.siteReminders[0].readAt, item.readAt);
  assert.deepEqual(badges, [1, 0]);
  await page.toggleSiteReminders();
  await page.toggleSiteReminders();
  assert.equal(page.data.siteReminders[0].readAt, item.readAt);
});

function chatPage(brief = {}) {
  const file = path.join(root, 'packages/construction/chat/chat.js');
  const { definition, app, wx } = pageFrom(file);
  const page = instance(definition);
  page._visible = true; page.projectId = '9'; page.poll = () => {};
  page._briefIssueId = brief.issueId || ''; page._briefMode = brief.mode || ''; page._briefRoomId = brief.roomId || ''; page._briefRoom = brief.room || '';
  const inputs = [];
  page.client = {
    epoch: 0, current: () => true,
    state: { pending: null, collaboration: false, write: true, draft: '', rooms: brief.rooms || [] },
    show: async () => {}, hide() {}, load: async () => {},
    input: text => inputs.push(text),
  };
  page.capture = { show() {}, hide() {}, flush: async () => {}, submit: () => 'submitted', addFile: async (...args) => { page._captureAdd = args; }, removeFile: id => { page._removedCapture = id; } };
  page.speechController = { show: async () => {}, hide() {}, microphone: () => { page._microphone = true; }, playLocal: file => { page._played = file; } };
  app.globalData.bootstrap = { current: { role: 'construction_staff', capabilities: ['construction.projects', 'account'],
    context: { enterpriseId: '1', staffId: '2', staffRole: 'construction_staff' } } };
  return { page, inputs, app, wx };
}

test('revolving chat reopens the original issue or room and queries the same project facts', async () => {
  for (const [brief, expected] of [
    [{ issueId: '31', mode: 'review' }, '查看事项31的需求、图纸和现场记录'],
    [{ issueId: '31' }, '事项31现在在等谁？为什么？'],
    [{ mode: 'plan', rooms: [] }, '查看本项目的图纸、需求和方案'],
    [{ mode: 'plan', roomId: '5', rooms: [{ id: '5', name: '书房' }] }, '查看书房的图纸、需求和方案'],
  ]) {
    const { page, inputs } = chatPage(brief);
    await page.onShow();
    assert.deepEqual(inputs, [expected]);
  }
});

test('worker capture page wires camera, album, voice, submit and retry to the durable capture state machine', async () => {
  const { page, wx } = chatPage({});
  page.data.write = true; page.data.busy = false; page.data.pending = false; page.data.fatal = false;
  let choose = null;
  wx.chooseMedia = options => { choose = options; options.success({ tempFiles: [{ size: 1024, tempFilePath: '/tmp/camera.jpg' }] }); };
  wx.showToast = () => {};
  page.photo();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(choose.mediaType, ['image']);
  assert.deepEqual(choose.sourceType, ['camera', 'album']);
  assert.deepEqual(page._captureAdd, ['/tmp/camera.jpg', 'photo']);

  page.data.capturePhotos = [{}, {}, {}, {}];
  choose = null; page.photo();
  assert.equal(choose, null, 'more than four photos must not open the chooser');

  page.data.captureVoice = { path: '/tmp/voice.wav' };
  page.voice();
  assert.equal(page._played, '/tmp/voice.wav');
  page.data.captureVoice = null;
  page.voice();
  assert.equal(page._microphone, true);

  page.data.draft = ''; page.data.attachments = []; page._conversationInput = false;
  assert.equal(await page.send(), 'submitted');
  page.retryCapture();
  page.typeReport();
  assert.equal(page.data.textMode, true);
  page.removeCapture({ currentTarget: { dataset: { id: 'photo-1' } } });
  assert.equal(page._removedCapture, 'photo-1');
});

test('reminder deep links resolve to the issue review or room plan, and closed targets stay explicit', async () => {
  const file = path.join(root, 'packages/construction/projects/projects.js');
  const { definition, wx } = pageFrom(file);
  const page = instance(definition);
  page._visible = true; page._identityKey = '1:2'; page._token = 'token-a';
  page.data.projectId = '9'; page.data.detail = { project: { id: '9', status: 'active' } };
  page.data.busy = false; page.data.pending = null; page.data.remindersLoading = false;
  page.data.reminders = [];
  page._generation = 1;
  global.getApp = () => ({ globalData: { token: 'token-a', userInfo: null,
    bootstrap: { current: { role: 'construction_staff', capabilities: ['construction.projects', 'account'], context: { enterpriseId: '1', staffId: '2', staffRole: 'construction_staff' } } } } });
  wx.getStorageSync = () => 'token-a';
  wx.getWindowInfo = () => ({ windowWidth: 390, statusBarHeight: 44 });
  wx.getMenuButtonBoundingClientRect = () => ({ left: 296, top: 48, height: 32 });
  wx.navigateTo = options => { page._navigated = options.url; };
  wx.showToast = options => { page._toast = options.title; };
  page.current = () => true;
  page._deepLink = { projectId: '9', issueId: '31' };
  page.applyDeepLink(1);
  assert.equal(page._navigated, '/packages/construction/chat/chat?projectId=9&issueId=31&mode=review');
  page._opening = false; page._deepLinkApplied = false; page._deepLink = { projectId: '9', roomId: '5' };
  page.applyDeepLink(1);
  assert.equal(page._navigated, '/packages/construction/chat/chat?projectId=9&mode=plan&roomId=5');
  page._opening = false; page._deepLinkApplied = false; page._deepLink = { projectId: '9', item: 'rem_closed' };
  page.applyDeepLink(1);
  assert.equal(page._toast, '提醒对应事项已完成或已关闭');
});
