const assert = require('node:assert/strict');
const { test } = require('node:test');
const api = require('../utils/api');

test('site workbench clears the previous project and scopes receipt, capture and report entry on reentry', async () => {
  const previous = { wx: global.wx, Component: global.Component, getApp: global.getApp, request: api.request, download: api.downloadFile };
  let definition, denied = false, finishEarlierPhoto;
  const visited = [], removed = [], storage = new Map();
  const choices = [{ id:'10', name:'春和苑' }, { id:'20', name:'另一工地' }];
  const globalData = { token:'token-A', bootstrap: { current: { role:'construction_staff', capabilities:['construction.projects','account'],
    context:{ enterpriseId:'1', staffId:'2' } } } };
  global.Component = value => { definition = value; };
  global.getApp = () => ({ globalData });
  global.wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key,value) => storage.set(key,value), removeStorageSync: key => storage.delete(key),
    getFileSystemManager: () => ({ unlink({filePath}) { removed.push(filePath); } }),
    navigateTo(options) { visited.push(options.url); options.success({ eventChannel: { emit: (...args) => visited.push(args) } }); options.complete(); },
  };
  api.request = async url => {
    const id = url.includes('projectId=10') || !url.includes('?') && !denied ? '10' : '20';
    if (denied && url.includes('projectId=10')) throw { statusCode:404 };
    return { data: { view:'worker', choices: denied ? choices.slice(1) : choices,
      project: { id, name:choices.find(choice=>choice.id===id).name, status:'active', stageName:'水电施工' },
      canCapture:true, receipt:id==='10' ? { recordId:'30', title:'客厅线管', status:'draft', photoId:'40' } : null } };
  };
  api.downloadFile = async () => new Promise(resolve => { finishEarlierPhoto = resolve; });
  const componentPath = require.resolve('../packages/construction/workbench/workbench');
  delete require.cache[componentPath];
  require(componentPath);
  const c = { data:{ ...definition.data, role:'construction_staff' }, _visible:true,
    setData(patch) { Object.assign(this.data,patch); }, ...definition.methods };
  const event = (dataset, detail) => ({ currentTarget:{ dataset }, detail });
  try {
    const first = c.load();
    for (let attempt = 0; attempt < 10 && !finishEarlierPhoto; attempt++) await Promise.resolve();
    assert.ok(finishEarlierPhoto);
    c.openRecord(event({ record:'30' }));
    assert.match(visited.at(-1), /projectId=10&recordId=30$/);
    await c.changeProject(event({}, { value:1 }));
    finishEarlierPhoto({ tempFilePath:'old-private-photo' });
    await first;
    assert.equal(c.data.model.project.id,'20');
    assert.equal(c.data.model.receipt,null);
    assert.equal(c.data.photo,'');
    assert.deepEqual(removed,['old-private-photo']);
    c.capture(event({ action:'photo' }));
    assert.match(visited.at(-2), /projectId=20$/);
    assert.deepEqual(visited.at(-1), ['workbenchCapture','photo']);
    c.openReports();
    assert.match(visited.at(-1), /followup=1&staffProjectId=20$/);
    c.hide();
    assert.equal(c.data.model,null);
    await c.show();
    assert.equal(c.data.model.project.id,'20');

    storage.set('site-workbench:project:1:2:construction_staff','10');
    denied=true;
    await c.retry();
    assert.equal(c.data.model.project.id,'20');
    assert.match(c.data.notice,/已不可访问/);
    assert.equal(c.data.photo,'');
  } finally {
    api.request = previous.request; api.downloadFile = previous.download;
    global.wx = previous.wx; global.Component = previous.Component; global.getApp = previous.getApp;
    delete require.cache[componentPath];
  }
});
