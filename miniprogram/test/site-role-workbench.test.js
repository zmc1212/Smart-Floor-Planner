const assert = require('node:assert/strict');
const { test } = require('node:test');
const api = require('../utils/api');

test('worker site workbench loads own reports, opens the report page and reads a record detail', async () => {
  const previous = { wx: global.wx, Component: global.Component, getApp: global.getApp, request: api.request, download: api.downloadFile };
  let definition, denied = false;
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
    const selectedId = id || '20';
    return { data: {
      view: 'worker', choices: denied ? choices.slice(1) : choices,
      project: { id: selectedId, name: choices.find(choice => choice.id === selectedId).name, status: 'active', stageName: '水电施工' },
      canCapture: true,
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

    c.capture();
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
    storage.set('site-workbench:project:1:2:construction_staff', '10');
    denied = true;
    await c.retry();
    assert.equal(c.data.model.project.id, '20');
    assert.match(c.data.notice, /已不可访问/);
  } finally {
    api.request = previous.request; api.downloadFile = previous.download;
    global.wx = previous.wx; global.Component = previous.Component; global.getApp = previous.getApp;
    delete require.cache[componentPath];
  }
});
