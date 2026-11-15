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

test('owner reminder cards load from the signed conversation, refresh on reentry and open the saved project report', async () => {
  const previousRequest = api.request;
  const calls = [], toasts = [];
  global.wx = { getStorageSync: () => '', showToast: options => toasts.push(options.title) };
  api.request = async (...args) => {
    calls.push(args);
    return { data: { items: [
      { reminderId: 'rem_a', projectId: '9', status: 'delivered', title: '水电阶段已开始', triggerLabel: '阶段已更新' },
      { reminderId: 'rem_b', projectId: '9', status: 'paused', title: '待确认', triggerLabel: '业主待确认' },
      { reminderId: 'rem_c', projectId: '9', status: 'cancelled', title: '旧提醒', triggerLabel: '节点到期' },
      { reminderId: 'rem_d', projectId: '9', status: 'pending', title: '待发送', triggerLabel: '待办' },
    ] } };
  };
  try {
    const page = instance(require('../packages/assistant/chat/chat-definition')());
    page._options = {}; page._alive = true; page._shown = true;
    page.controller = { ensureEntry: async () => ({ entryToken: 'entry-1' }) };
    await page.loadOwnerStageReminders();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/miniprogram/xiaok/reminders');
    assert.deepEqual(calls[0][3].headers, { 'X-Assistant-Entry': 'entry-1' });
    assert.deepEqual(page.data.ownerStageReminders.map(item => item.reminderId), ['rem_a', 'rem_b', 'rem_d']);
    assert.equal(page.data.ownerStageReminders[0].statusLabel, '已送达 · 未读');
    assert.equal(page.data.ownerStageReminders[1].statusLabel, '已暂停');

    page.data.followupBindings = [{ bindingId: 'b1', hidden: false, latestReport: { reportId: 'r1' }, projects: [{ id: '9' }] }];
    page.syncOwnerWeeklyEntry();
    assert.equal(page.data.ownerWeeklyBindingId, 'b1');
    let selected = '';
    page.selectFollowup = event => { selected = event.currentTarget.dataset.id; };
    await page.openOwnerReminder({ currentTarget: { dataset: { id: 'rem_a' } } });
    assert.equal(selected, 'b1');

    await page.loadOwnerStageReminders();
    assert.equal(calls.length, 2, 'reentry refreshes the reminder list');

    page.data.followupBindings = [];
    await page.openOwnerReminder({ currentTarget: { dataset: { id: 'rem_a' } } });
    assert.equal(toasts.at(-1), '该工地的周报尚未生成');
  } finally { api.request = previousRequest; }
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
