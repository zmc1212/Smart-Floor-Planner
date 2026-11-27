const assert = require('node:assert/strict');
const { test } = require('node:test');
const api = require('../utils/api');

test('worker site workbench loads own reports, opens the report page and reads a record detail', async () => {
  const previous = { wx: global.wx, Component: global.Component, getApp: global.getApp, request: api.request, download: api.downloadFile };
  let definition, denied = false, clearedBeforeFallback = false, returned = true;
  const visited = [], removed = [], storage = new Map();
  const choices = [{ id: '10', name: '春和苑' }, { id: '20', name: '另一工地' }];
  const globalData = { token: 'token-A', bootstrap: { current: { role: 'construction_staff', capabilities: ['construction.projects', 'account'],
    context: { enterpriseId: '1', staffId: '2' } } } };
  global.Component = value => { definition = value; };
  global.getApp = () => ({ globalData });
  global.wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    getFileSystemManager: () => ({ unlink({ filePath }) { removed.push(filePath); } }),
    navigateTo(options) { visited.push(options.url); options.success?.({ eventChannel: { emit() {} } }); options.complete?.(); },
    previewImage() {},
    showToast() {},
  };
  const report = {
    recordId: '30', clientMessageId: 'k1', title: '客厅线管', at: '2026-11-18T07:10:00.000Z',
    status: 'pending', statusLabel: '待审核', stages: [{ key: 'utilities', name: '水电' }],
    photoCount: 1, photoId: '40', hasVoice: false, approvedByName: '', approvedAt: null, returnReason: '',
  };
  api.request = async url => {
    if (url.includes('/projects/') && url.includes('recordId=30')) {
      return { data: { items: [{ message: { created_at: '2026-11-18T07:10:00.000Z' },
        record: { id: '30', status: 'draft', data: { title: '客厅线管', completed: '线管已铺完' },
          stage_snapshot: [{ key: 'utilities', name: '水电' }], media: [{ id: '40' }], speech: null,
          approved_name: '', review_requirements: '' } }] } };
    }
    const id = denied && url.includes('projectId=10') ? null : (url.includes('projectId=10') || (!url.includes('projectId=') && !denied) ? '10' : '20');
    if (denied && url.includes('projectId=10')) throw { statusCode: 404 };
    if (denied && !url.includes('projectId=')) clearedBeforeFallback = c.data.model === null && c.data.loading;
    const selectedId = id || '20';
    return { data: {
      view: 'worker', choices: denied ? choices.slice(1) : choices,
      project: { id: selectedId, name: choices.find(choice => choice.id === selectedId).name, status: 'active', stageName: '水电施工' },
      canCapture: true,
      latestReturn: selectedId === '10' && returned ? { ...report, recordId: '31', status: 'returned', returnReason: '补拍厨房插座底盒' } : null,
      reports: { from: '2026-11-18', to: '2026-11-18', items: selectedId === '10' ? [report] : [] },
      todaySummary: { total: selectedId === '10' ? 1 : 0, pending: selectedId === '10' ? 1 : 0, approved: 0, returned: 0 },
    } };
  };
  api.downloadFile = async () => ({ tempFilePath: 'detail-photo' });
  const componentPath = require.resolve('../packages/construction/workbench/workbench');
  delete require.cache[componentPath];
  require(componentPath);
  const c = { data: { ...definition.data, role: 'construction_staff' }, _visible: true, sheetEvents: [],
    setData(patch, callback) { Object.assign(this.data, patch); if (typeof callback === 'function') callback(); },
    triggerEvent(name, detail) { this.sheetEvents.push({ name, detail }); }, ...definition.methods };
  const event = (dataset, detail) => ({ currentTarget: { dataset }, detail });
  const settle = async (check, attempts = 40) => {
    for (let index = 0; index < attempts && !check(); index += 1) await new Promise(resolve => setTimeout(resolve, 0));
  };
  try {
    await c.load();
    assert.equal(c.data.model.project.id, '10');
    assert.equal(c.data.reports.length, 1);
    assert.equal(c.data.reports[0].statusLabel, '待审核');
    assert.equal(c.data.todaySummary.pending, 1);

    assert.equal(c.data.model.notebookTask.title, '补拍厨房插座底盒');
    c.runNotebookTask();
    assert.match(visited.at(-1), /\/inspection-record\/inspection-record\?projectId=10&recordId=31$/);
    returned = false;
    await c.load();
    c.runNotebookTask();
    assert.match(visited.at(-1), /\/packages\/construction\/report\/report\?projectId=10$/);
    assert.equal(visited.some(url => url.includes('/construction/chat/chat')), false);

    await c.selectRange(event({ key: 'week' }));
    assert.match(c.data.reportRange.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(c.data.reportRange.key, 'week');

    c.openRecord(event({ record: '30' }));
    await settle(() => Boolean(c.data.detail));
    assert.equal(c.data.showDetail, true);
    assert.equal(c.data.detail.title, '客厅线管');
    assert.equal(c.data.detail.stageText, '水电');
    assert.deepEqual(c.data.detailPhotos, [{ id: '40', path: 'detail-photo' }]);
    assert.equal(c.sheetEvents.some(entry => entry.name === 'sheetchange' && entry.detail.open === true), true);

    c.changeProject(event({}, { value: 1 }));
    await settle(() => c.data.model?.project?.id === '20');
    assert.equal(c.data.model.project.id, '20');
    assert.equal(c.data.reports.length, 0);
    assert.equal(c.data.reportRange.key, 'today');

    c.hide();
    assert.equal(c.data.model, null);
    assert.equal(c.data.showDetail, false);
    assert.equal(c.sheetEvents.at(-1).detail.open, false);

    await c.show();
    await c.load('10');
    denied = true;
    c.selectRange(event({ key: 'week' }));
    await settle(() => c.data.model?.project?.id === '20' && !!c.data.notice);
    assert.equal(clearedBeforeFallback, true);
    assert.equal(c.data.model.project.id, '20');
    assert.match(c.data.notice, /已不可访问/);
  } finally {
    api.request = previous.request; api.downloadFile = previous.download;
    global.wx = previous.wx; global.Component = previous.Component; global.getApp = previous.getApp;
    delete require.cache[componentPath];
  }
});

test('workbench empty layouts use successful role-scoped reads and keep AI Design permission-bound', async () => {
  const previous = { wx: global.wx, Component: global.Component, getApp: global.getApp, request: api.request };
  const componentPath = require.resolve('../packages/construction/workbench/workbench');
  const storage = new Map();
  const current = { role: '', capabilities: ['construction.projects', 'account'], context: { enterpriseId: '1454', staffId: '2' } };
  const globalData = { token: 'token-empty', bootstrap: { current }, aiEntriesEnabled: true };
  let definition, response, failure;
  global.Component = value => { definition = value; };
  global.getApp = () => ({ globalData });
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
  };
  api.request = async () => {
    if (failure) throw failure;
    return { data: response };
  };
  delete require.cache[componentPath];
  require(componentPath);
  try {
    for (const [role, view, title] of [
      ['designer', 'designer', '暂未分配工地'],
      ['construction_staff', 'worker', '暂未分配工地'],
      ['enterprise_admin', 'boss', '暂无可查看的工地'],
    ]) {
      current.role = role;
      response = { view, project: null, choices: [], items: [] };
      const c = { data: { ...definition.data, role }, _visible: true, ...definition.methods,
        setData(patch) { Object.assign(this.data, patch); } };
      await c.load();
      assert.equal(c.data.model.emptyProject.title, title);
      assert.equal(c.data.canDesign, false);
      assert.equal(c.data.error, '');

      failure = { statusCode: 503 };
      await c.retry();
      assert.equal(c.data.model, null);
      assert.equal(c.data.error, '暂时无法读取工地');

      failure = { statusCode: 403, error: 'construction_forbidden' };
      await c.retry();
      assert.equal(c.data.model, null);
      assert.match(c.data.error, /工地权限/);
      assert.equal(c.data.passwordRequired, false);

      if (role === 'enterprise_admin') {
        failure = { statusCode: 403, error: 'construction_password_required' };
        await c.retry();
        assert.equal(c.data.model, null);
        assert.equal(c.data.error, '请完成密码修改，或使用微信手机号登录。');
        assert.equal(c.data.passwordRequired, true);
      }

      failure = null;
      const project = { id: '10', name: '测试专用工地', stageName: '水电', status: 'active' };
      if (view === 'boss') response = { view, items: [{ ...project, projectId: project.id }] };
      else response = { view, project, choices: [project], reply: [], changes: [] };
      if (role === 'designer') current.capabilities.push('staff.design');
      await c.retry();
      assert.equal(c.data.model.emptyProject, undefined);
      assert.equal(c.data.error, '');
      assert.equal(c.data.passwordRequired, false);
      assert.equal(c.data.canDesign, role === 'designer');
      globalData.aiEntriesEnabled = false;
      c.syncAIDesignEntry();
      assert.equal(c.data.canDesign, false);
      globalData.aiEntriesEnabled = true;
      current.capabilities = current.capabilities.filter(capability => capability !== 'staff.design');
    }
  } finally {
    api.request = previous.request;
    global.wx = previous.wx; global.Component = previous.Component; global.getApp = previous.getApp;
    delete require.cache[componentPath];
  }
});

test('manager workbench keeps construction scoped to the selected site and keeps the designer customer actions', async () => {
  const previous = { wx: global.wx, Component: global.Component, getApp: global.getApp, request: api.request };
  const componentPath = require.resolve('../packages/construction/workbench/workbench');
  const storage = new Map(), visited = [];
  const current = {
    role: 'construction_staff', context: { enterpriseId: '1454', staffId: '2' },
    capabilities: ['construction.projects', 'staff.leads', 'staff.appointments'],
  };
  const globalData = { token: 'manager-workbench-token', bootstrap: { current }, aiEntriesEnabled: false };
  const projects = [
    { id: '10', name: '施工管理样例', status: 'active', stageName: '水电' },
    { id: '20', name: '只参与设计样例', status: 'active', stageName: '泥木' },
  ];
  let definition, revoked = false;
  const now = Date.now();
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const startOfDay = Date.parse(day + 'T00:00:00+08:00');
  const visitStart = Math.max(now - 60000, startOfDay);
  const visitEnd = Math.min(now + 3600000, startOfDay + 86400000);
  const tomorrow = new Date(startOfDay + 86400000 + 16 * 3600000);
  const range = (start, end) => `[${new Date(start).toISOString()},${new Date(end).toISOString()})`;
  let timeRange = range(tomorrow, +tomorrow + 3600000);
  global.Component = value => { definition = value; };
  global.getApp = () => ({ globalData });
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    navigateTo({ url, complete }) { visited.push(url); complete?.(); },
  };
  api.request = async url => {
    if (url === '/miniprogram/workbench') {
      return { data: { role: 'designer',
        appointments: [{ leadId: '60', appointmentId: '61', status: 'confirmed', canPerformSurvey: true, timeRange }],
        pendingDeliveries: [{ leadId: '70', floorPlanId: '71', communityName: '交付样例' }],
      } };
    }
    if (revoked && url.includes('projectId=10')) throw { statusCode: 404 };
    if (url.includes('projectId=20') || revoked) {
      return { data: { view: 'designer', project: projects[1], choices: revoked ? projects.slice(1) : projects } };
    }
    return { data: { view: 'manager', project: projects[0], choices: projects, inspection: { count: 1 },
      onsiteTask: current.role === 'construction_staff' ? { recordId: '31', title: '封槽巡检', room: '厨房',
        at: new Date(now).toISOString(), inspection: { source: 'rule', reason: '核对底盒' } } : null,
      pendingReport: { projectId: '10', recordId: '32', title: '核对给水管', at: new Date(now).toISOString(), stageNames: ['水电'] },
      review: { recordId: '33', title: '核对补交照片' },
    } };
  };
  delete require.cache[componentPath];
  require(componentPath);
  const mount = role => ({ data: { ...definition.data, role }, _visible: true, ...definition.methods,
    setData(patch) { Object.assign(this.data, patch); } });
  try {
    const dedicated = mount('construction_staff');
    await dedicated.load();
    assert.equal(dedicated.data.title, '施工经理工作台');
    assert.equal(dedicated.data.model.notebookTask.label, '需到场');
    dedicated.runNotebookTask();
    assert.match(visited.at(-1), /inspection\?projectId=10&onsite=1&fromWorkbench=1$/);
    dedicated.openManagerRecheck();
    assert.match(visited.at(-1), /inspection-record\?projectId=10&recordId=33$/);

    current.role = 'designer';
    const combined = mount('designer');
    await combined.load();
    assert.equal(combined.data.title, '设计师工作台');
    assert.equal(combined.data.model.combinedManager, true);
    assert.equal(combined.data.model.appointments[0].appointmentId, '61');
    assert.equal(combined.data.model.appointments[0].serviceTime, '明日 16:00');
    assert.equal(combined.data.model.notebookTask.kind, 'approval');
    combined.runNotebookTask();
    assert.match(visited.at(-1), /inspection-record\?projectId=10&recordId=32$/);
    combined.continueDelivery({ currentTarget: { dataset: { lead: '70' } } });
    assert.match(visited.at(-1), /lead-detail\?id=70$/);

    timeRange = range(visitStart, visitEnd);
    await combined.load();
    assert.equal(combined.data.model.notebookTask.kind, 'survey');
    await combined.changeProject({ detail: { value: 1 } });
    assert.equal(combined.data.model.project.id, '20');
    assert.equal(combined.data.model.combinedManager, false);
    assert.equal(combined.data.model.notebookTask.item.appointmentId, '61');
    assert.equal(combined.data.model.pendingReport, undefined);

    revoked = true;
    await combined.load('10');
    assert.equal(combined.data.model.project.id, '20');
    assert.match(combined.data.notice, /已不可访问/);
    assert.equal(combined.data.model.review, undefined);
    assert.equal(combined.data.model.deliveries[0].leadId, '70');
  } finally {
    global.wx = previous.wx; global.Component = previous.Component; global.getApp = previous.getApp;
    api.request = previous.request;
    delete require.cache[componentPath];
  }
});

test('shared password state opens Account Security for its current session and has a route-stack fallback', () => {
  const previous = { wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  const { staffPasswordRequiredMethods } = require('../utils/session');
  const globalData = { token: 'password-staff', bootstrap: { current: { capabilities: ['account'] } } };
  const actions = [];
  global.getApp = () => ({ globalData });
  global.wx = {
    navigateTo({ url, complete }) { actions.push(url); complete(); },
    navigateBack() { actions.push('back'); },
    switchTab({ url }) { actions.push(url); },
  };
  try {
    const instance = { ...staffPasswordRequiredMethods, data: { passwordRequired: true }, _passwordRequiredToken: 'password-staff' };
    instance.openAccountSecurity();
    globalData.token = 'different-session';
    instance.openAccountSecurity();

    global.getCurrentPages = () => [{}, {}];
    instance.goBackFromPasswordRequired();
    global.getCurrentPages = () => [{}];
    instance.goBackFromPasswordRequired();

    assert.deepEqual(actions, ['/packages/business/account-security/account-security', 'back', '/pages/mine/mine']);

    global.wx.switchTab = options => options.fail();
    global.wx.reLaunch = ({ url }) => actions.push(url);
    instance.goBackFromPasswordRequired();
    assert.equal(actions.at(-1), '/pages/mine/mine');
    assert.equal(actions.length, 4);
  } finally {
    Object.assign(global, previous);
  }
});
