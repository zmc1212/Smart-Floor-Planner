const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const api = require('../utils/api');

let definition;
global.Component = value => { definition = value; };
require('../packages/construction/owner-home/owner-home');
delete global.Component;
let indexPage;
global.Page = value => { indexPage = value; };
require('../pages/index/index');
delete global.Page;

test('the owner site keeps the report and confirmation actions inside its vertical scroll area', () => {
  const markup = readFileSync(require.resolve('../packages/construction/owner-home/owner-home.wxml'), 'utf8');
  const scrollView = markup.match(/<scroll-view\b[^>]*\bscroll-y\b[^>]*>([\s\S]*?)<\/scroll-view>/);
  assert.ok(scrollView);
  assert.match(scrollView[1], /is="notebook-task-v2"/);
  assert.match(scrollView[1], /bindtap="openReport"/);
  assert.ok(scrollView[1].indexOf('notebook-task-v2') < scrollView[1].indexOf('site-progress-card'));
  assert.ok(scrollView[1].indexOf('site-progress-card') < scrollView[1].indexOf('site-record-entry'));
  assert.ok(scrollView[1].indexOf('site-record-entry') < scrollView[1].indexOf('site-camera'));
  assert.match(scrollView[1], /wx:if="\{\{project.progressAccess && siteMoreOpen\}\}" class="site-paper site-utility"/);
  assert.doesNotMatch(scrollView[1], /class="site-nav"/);
  assert.match(markup, /family-sheet wx:if="\{\{familyVisible\}\}"/);
});

test('switching sites clears the earlier photo and opens only the selected camera and exact report', async t => {
  const originalRequest = api.request;
  const session = { token: 'owner' };
  const opened = [];
  const cameraCalls = [], ticket = 'n1.1.' + 'a'.repeat(43);
  global.getApp = () => ({ globalData: session });
  global.wx = { getStorageSync: () => '', navigateTo: ({ url, complete }) => { opened.push(url); complete(); } };
  t.after(() => { api.request = originalRequest; delete global.getApp; delete global.wx; });

  let finishOldCover;
  const oldCover = new Promise(resolve => { finishOldCover = resolve; });
  const report = { reportId: '301', revision: 2, bindingId: '40', periodStart: '2026-11-16T16:00:00Z',
    progress: ['客厅线管已铺设'], pending: [{ key: '62:0', recordId: '62', text: '确认插座位置' }] };
  api.request = async (endpoint, method, body) => {
    if (endpoint.includes('/native-live/')) { cameraCalls.push({ endpoint, method, body });
      return { data: { ticket, url: `https://camera.example/camera-media/native/${ticket}/1/hls.m3u8` } }; }
    if (endpoint.endsWith('/1/cover')) return oldCover;
    if (endpoint.endsWith('/2/cover')) return { data: { camera: { bindingId: '8', name: '门口机位', cover: { jpeg: 'new', capturedAt: '2026-11-17T08:30:00Z' } } } };
    const id = endpoint.split('/').at(-1);
    return { data: { project: { id, name: '测试专用工地 ' + id, leadId: id + '0', progressAccess: true }, report } };
  };
  const component = { ...definition.methods, data: { ...definition.data }, _visible: true,
    setData(patch) { Object.assign(this.data, patch); } };
  const first = component.readProject({ id: '1' });
  await Promise.resolve();
  await component.readProject({ id: '2' });
  finishOldCover({ data: { camera: { name: '旧工地', cover: { jpeg: 'old' } } } });
  await first;
  assert.equal(component.data.camera.src, 'data:image/jpeg;base64,new');
  assert.equal(component.data.camera.dateLabel, '11月17日 16:30');
  assert.equal(component.data.report.dateLabel, '11月17日');
  await component.playCamera();
  assert.deepEqual(cameraCalls.at(-1), { endpoint: '/miniprogram/construction/video/projects/2/native-live/start', method: 'POST', body: { bindingId: '8' } });
  assert.match(component.data.liveSrc, /camera-media\/native/);
  assert.deepEqual(opened, []);
  component.restoreCameraCover();
  assert.equal(component.data.livePhase, 'idle');
  assert.equal(cameraCalls.at(-1).endpoint, '/miniprogram/construction/video/projects/2/native-live/stop');
  component.openCamera();
  component.openReport({ currentTarget: { dataset: {} } });
  assert.equal(component.data.notebookTask, null);
  component.openReport({ currentTarget: { dataset: { record: component.data.nextStep.recordId } } });
  component.openReport({ currentTarget: { dataset: { record: '99' } } });
  assert.deepEqual(opened, [
    '/packages/construction/camera/camera?projectId=2',
    '/packages/assistant/chat/chat?reportBoard=1&reportProject=2&leadId=20&bindingId=40',
    '/packages/assistant/chat/chat?ownerReport=301&bindingId=40&revision=2&projectId=2&leadId=20&recordId=62',
  ]);
  session.token = 'different-owner';
  component.openCamera();
  assert.equal(opened.length, 3);
  definition.pageLifetimes.hide.call(component);
  assert.equal(component.data.camera, null);
  assert.equal(component.data.report, null);
});

test('the owner camera allows a slow first frame and recovers once from an interrupted native stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalRequest = api.request;
  global.getApp = () => ({ globalData: { token: 'owner' } });
  global.wx = { getStorageSync: () => '' };
  const starts = [], stops = [];
  const camera = { bindingId: '8', name: '门口机位', cover: { jpeg: 'frame' } };
  const ticket = attempt => 'n1.1.' + String(attempt).repeat(43);
  let coverReads = 0;
  api.request = async (url, method, body) => {
    if (url.endsWith('/2/cover')) { coverReads++; return { data: { camera } }; }
    if (url.endsWith('/2/native-live/start')) {
      starts.push(body.bindingId);
      const value = ticket(starts.length);
      return { data: { ticket: value, url: `https://camera.example/camera-media/native/${value}/1/hls.m3u8` } };
    }
    if (url.endsWith('/2/native-live/stop')) { stops.push(body.ticket); return { data: { stopped: true } }; }
    if (url.endsWith('/2/native-live/heartbeat')) return { data: { expiresIn: 60 } };
    assert.fail('unexpected request ' + url);
  };
  const component = { ...definition.methods, data: { ...definition.data, project: { id: '2' } },
    _visible: true, _generation: 1, _projectId: '2', _projectSession: 'owner',
    setData(patch) { Object.assign(this.data, patch); } };
  t.after(() => { component.clearPrivateLive(); api.request = originalRequest; delete global.getApp; delete global.wx; });

  await component.readCover('2', 1, 'owner');
  await component.playCamera();
  const first = { detail: { epoch: component.data.liveEpoch } };
  t.mock.timers.tick(23000);
  await Promise.resolve();
  assert.equal(component.data.livePhase, 'connecting');
  assert.deepEqual(starts, ['8']);

  await component.onPrivateLiveError(first);
  const second = { detail: { epoch: component.data.liveEpoch } };
  assert.deepEqual(starts, ['8', '8']);
  assert.deepEqual(stops, [ticket(1)]);
  assert.match(component.data.liveSrc, new RegExp(ticket(2)));
  component.onPrivateLiveAdvance(first);
  component.onPrivateLiveError(first);
  assert.equal(component.data.livePhase, 'connecting');
  component.onPrivateLiveAdvance(second);
  assert.equal(component.data.livePhase, 'playing');

  await component.onPrivateLiveError(second);
  assert.equal(component.data.livePhase, 'failed');
  assert.equal(component.data.liveSrc, '');
  assert.deepEqual(stops, [ticket(1), ticket(2)]);
  assert.equal(coverReads, 2);
  assert.deepEqual(starts, ['8', '8']);
  assert.equal(component.data.camera.src, 'data:image/jpeg;base64,frame');

  await component.playCamera();
  t.mock.timers.tick(50000);
  assert.equal(component.data.livePhase, 'failed');
  assert.deepEqual(starts, ['8', '8', '8']);
  assert.deepEqual(stops, [ticket(1), ticket(2), ticket(3)]);
});

test('the live task opens the current project and version, including after it becomes a progress item', async t => {
  const originalRequest = api.request, opened = [];
  const identity = { token: 'owner' };
  global.getApp = () => ({ globalData: identity });
  global.wx = { getStorageSync: () => '', navigateTo: ({ url, complete }) => { opened.push(url); complete(); } };
  t.after(() => { api.request = originalRequest; delete global.getApp; delete global.wx; });

  let finishOld;
  const old = new Promise(resolve => { finishOld = resolve; });
  const newItem = { id: '70', versionId: '81', canDecide: true, status: 'pending_owner', alias: '客厅机位' };
  api.request = async endpoint => {
    if (endpoint.endsWith('/1/public-live')) return old;
    if (endpoint.endsWith('/2/public-live')) return { data: { item: newItem } };
    if (endpoint.endsWith('/cover')) return { data: { camera: null } };
    const id = endpoint.split('/').at(-1);
    return { data: { project: { id, progressAccess: true }, report: null } };
  };
  const component = { ...definition.methods, data: { ...definition.data }, _visible: true,
    setData(patch) { Object.assign(this.data, patch); } };

  const first = component.readProject({ id: '1' });
  await Promise.resolve();
  await component.readProject({ id: '2' });
  finishOld({ data: { item: { id: '71', versionId: '82', canDecide: true } } });
  await first;
  assert.equal(component.data.liveApplication.id, '70');
  component.openLiveApplication();
  newItem.canDecide = false;
  newItem.status = 'owner_approved';
  await component.readProject({ id: '2' });
  assert.equal(component.data.liveApplication.status, 'owner_approved');
  component.openLiveApplication();
  identity.token = 'other-owner';
  component.openLiveApplication();
  const target = '/packages/construction/live-authorization/live-authorization?projectId=2&liveId=70&versionId=81';
  assert.deepEqual(opened, [target, target]);
});

test('an old family entry reads the exact authorized project and collapses its published schedule', async t => {
  const originalRequest = api.request;
  global.getApp = () => ({ globalData: { token: 'owner' } });
  global.wx = { getStorageSync: () => '' };
  t.after(() => { api.request = originalRequest; delete global.getApp; delete global.wx; });
  api.request = async endpoint => {
    if (endpoint.endsWith('/owner-sites')) return { data: { items: [{ id: '2', name: '工地2' }] } };
    if (endpoint.endsWith('/19')) return { data: { project: { id: '19', name: '工地19 · 13100000000', stageName: '水电', progressAccess: true } } };
    if (endpoint.endsWith('/19/progress')) return { data: { projectId: '19', access: 'owner', progress: {
      overall: { label: '正常', color: 'green' },
      nodes: [{ key: 'water', roomName: '2栋502 · (131****0000)', stageName: '水电', reason: '内部资料', label: '正常' }],
    } } };
    return { data: {} };
  };
  const events = [];
  const component = { ...definition.methods, data: { ...definition.data, requestedFamilyProjectId: '19' }, _visible: true,
    triggerEvent(name) { events.push(name); }, setData(patch) { Object.assign(this.data, patch); } };
  await component.load();
  assert.deepEqual(events, ['familyentryconsumed']);
  assert.deepEqual(component.data.projects, [{ id: '2', name: '工地2' }, { id: '19', name: '工地19' }]);
  assert.equal(component.data.selectedIndex, 1);
  assert.equal(component.data.familyVisible, true);
  assert.equal(component.data.scheduleOpen, false);
  assert.equal(component.data.schedule.nodes[0].roomName, '2栋502');
  assert.equal(component.data.schedule.nodes[0].reason, undefined);
  component.toggleSchedule();
  assert.equal(component.data.scheduleOpen, true);
  component.closeFamilySheet();
  assert.equal(component.data.familyVisible, false);
});

test('an invited family account reopens the shared site from the Site tab without another scan', async t => {
  const originalRequest = api.request, opened = [];
  global.getApp = () => ({ globalData: { token: 'family' } });
  global.wx = { getStorageSync: () => '', navigateTo: ({ url, complete }) => { opened.push(url); complete(); } };
  t.after(() => { api.request = originalRequest; delete global.getApp; delete global.wx; });
  api.request = async endpoint => {
    if (endpoint === '/miniprogram/construction/owner-sites') return { data: { items: [] } };
    if (endpoint === '/miniprogram/construction/customer-projects') return { data: [
      { id: '19', name: '精艺智家云工地 · 13100000000', leadId: '9', role: 'family' },
      { id: '20', name: '自己名下的工地', leadId: '10', role: 'owner' },
    ] };
    throw new Error('unexpected request ' + endpoint);
  };
  const component = { ...definition.methods, data: { ...definition.data }, _visible: true,
    setData(patch) { Object.assign(this.data, patch); } };
  await component.load();
  assert.equal(component.data.loading, false);
  assert.equal(component.data.project, null);
  assert.deepEqual(component.data.familyProjects, [{ id: '19', name: '精艺智家云工地' }]);
  component.openFamilyProject({ currentTarget: { dataset: { id: '19' } } });
  assert.deepEqual(opened, ['/packages/construction/family/family?projectId=19']);
});

test('My Renovation keeps authorized family sites when a personal renovation is loaded and reopened', async t => {
  const originalRequest = api.request;
  const opened = [];
  const ownerSite = { id: '20', name: '本人装修工地', leadId: '10', progressAccess: false };
  const familySite = { id: '19', name: '家人分享的工地', leadId: '9', role: 'family' };
  global.getApp = () => ({ globalData: { token: 'customer' } });
  global.wx = { getStorageSync: () => '', navigateTo: ({ url, complete }) => { opened.push(url); complete(); } };
  t.after(() => { api.request = originalRequest; delete global.getApp; delete global.wx; });
  api.request = async endpoint => {
    if (endpoint === '/miniprogram/construction/owner-sites') return { data: { items: [ownerSite] } };
    if (endpoint === '/miniprogram/construction/owner-sites/20') return { data: { project: ownerSite } };
    if (endpoint === '/miniprogram/construction/owner-sites/20/cover') return { data: { camera: null } };
    if (endpoint === '/miniprogram/construction/customer-projects') return { data: [familySite] };
    if (endpoint === '/miniprogram/customer-projects') return { data: [] };
    throw new Error('unexpected request ' + endpoint);
  };
  const component = { ...definition.methods, data: { ...definition.data, renovationOverview: true }, _visible: true,
    setData(patch) { Object.assign(this.data, patch); } };
  await component.load();
  assert.equal(component.data.renovation.action, 'site');
  assert.deepEqual(component.data.familyProjects, [{ id: familySite.id, name: familySite.name }]);
  await component.showSiteDetail();
  await component.closeSiteDetail();
  assert.deepEqual(component.data.familyProjects, [{ id: familySite.id, name: familySite.name }]);
  component.openFamilyProject({ currentTarget: { dataset: { id: familySite.id } } });
  assert.deepEqual(opened, ['/packages/construction/family/family?projectId=19']);
});

test('refresh distinguishes a failed shared-site read from an empty account and preserves owner access', async t => {
  const originalRequest = api.request;
  global.getApp = () => ({ globalData: { token: 'customer' } });
  global.wx = { getStorageSync: () => '' };
  t.after(() => { api.request = originalRequest; delete global.getApp; delete global.wx; });

  const ownerSite = { id: '20', name: '测试工地', progressAccess: false };
  let linked = false;
  let sharedAvailable = false;
  api.request = async endpoint => {
    if (endpoint.endsWith('/owner-sites')) return { data: { items: linked ? [ownerSite] : [] } };
    if (endpoint.endsWith('/customer-projects')) {
      if (!sharedAvailable) throw Object.assign(new Error('unavailable'), { statusCode: 503 });
      return { data: [] };
    }
    if (endpoint.endsWith('/owner-sites/20')) return { data: { project: ownerSite } };
    if (endpoint.endsWith('/owner-sites/20/cover')) return { data: { camera: null } };
    throw new Error('unexpected request ' + endpoint);
  };

  const component = { ...definition.methods, data: { ...definition.data }, _visible: true,
    setData(patch) { Object.assign(this.data, patch); } };
  await component.load();
  assert.equal(component.data.error, '工地暂时无法读取');
  assert.equal(component.data.needsLogin, false);

  sharedAvailable = true;
  await component.retryProject();
  assert.equal(component.data.loading, false);
  assert.equal(component.data.error, '');
  assert.equal(component.data.project, null);
  assert.deepEqual(component.data.familyProjects, []);

  linked = true;
  sharedAvailable = false;
  await component.retryProject();
  assert.equal(component.data.error, '');
  assert.deepEqual(component.data.project, ownerSite);
});

test('only the family button on the owner Site tab delegates the private share card', () => {
  const share = { title: '澄光里 108㎡ · 装修进度', path: '/packages/construction/family/family?projectId=19&invite=private-card',
    imageUrl: '/packages/construction/assets/notebook/family-invite-share-cover.jpg' };
  const page = { data: { roleWorkbenchRole: 'customer', customerTab: 'service' },
    selectComponent: id => id === '#owner-site-home' ? { familyInviteShare: () => share } : null };
  const action = { from: 'button', target: { dataset: { shareType: 'owner-family' } } };
  assert.equal(indexPage.onShareAppMessage.call(page, action), share);
  const menu = indexPage.onShareAppMessage.call(page, { from: 'menu' });
  assert.equal(menu.path, '/pages/index/index');
  assert.equal(menu.imageUrl, '/images/share/jiakelai-share-cover.jpg');
  page.data.customerTab = 'xiaok';
  assert.equal(indexPage.onShareAppMessage.call(page, action).path, '/pages/index/index');
});
