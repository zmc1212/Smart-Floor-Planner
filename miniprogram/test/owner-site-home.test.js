const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api');

let definition;
global.Component = value => { definition = value; };
require('../packages/construction/owner-home/owner-home');
delete global.Component;

test('switching sites clears the earlier photo and opens only the selected camera and exact report', async t => {
  const originalRequest = api.request;
  const session = { token: 'owner' };
  const opened = [];
  global.getApp = () => ({ globalData: session });
  global.wx = { getStorageSync: () => '', navigateTo: ({ url, complete }) => { opened.push(url); complete(); } };
  t.after(() => { api.request = originalRequest; delete global.getApp; delete global.wx; });

  let finishOldCover;
  const oldCover = new Promise(resolve => { finishOldCover = resolve; });
  const report = { reportId: '301', revision: 2, bindingId: '40', periodStart: '2026-11-16T16:00:00Z',
    progress: ['客厅线管已铺设'], pending: [{ key: '62:0', recordId: '62', text: '确认插座位置' }] };
  api.request = async endpoint => {
    if (endpoint.endsWith('/1/cover')) return oldCover;
    if (endpoint.endsWith('/2/cover')) return { data: { camera: { name: '门口机位', cover: { jpeg: 'new', capturedAt: '2026-11-17T08:30:00Z' } } } };
    const id = endpoint.split('/').at(-1);
    return { data: { project: { id, name: '测试专用工地 ' + id, leadId: id + '0' }, report } };
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
  component.openCamera();
  component.openReport({ currentTarget: { dataset: { record: '62' } } });
  component.openReport({ currentTarget: { dataset: { record: '99' } } });
  assert.deepEqual(opened, [
    '/packages/construction/camera/camera?projectId=2',
    '/packages/assistant/chat/chat?ownerReport=301&bindingId=40&revision=2&projectId=2&leadId=20&recordId=62',
  ]);
  session.token = 'different-owner';
  component.openCamera();
  assert.equal(opened.length, 2);
  definition.pageLifetimes.hide.call(component);
  assert.equal(component.data.camera, null);
  assert.equal(component.data.report, null);
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
