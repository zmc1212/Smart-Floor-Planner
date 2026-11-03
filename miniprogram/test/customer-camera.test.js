const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../utils/customerCamera.js'), source = fs.readFileSync(file, 'utf8');
function fixture() {
  const app = { globalData: { token: 'customer-a' } }, calls = [], navigation = [];
  let response = async () => ({ data: { items: [{ id: '21', name: '本人装修工地' }] } });
  const module = { exports: {} };
  new Function('module', 'require', 'getApp', 'wx', source)(module, () => ({ request: async (...args) => { calls.push(args); return response(); } }), () => app, { getStorageSync: () => '', navigateTo: item => navigation.push(item.url) });
  const page = { data: { leadId: '12', cameraProjects: [] }, setData(data) { Object.assign(this.data, data); } };
  return { module: module.exports, app, calls, navigation, page, setResponse: fn => { response = fn; } };
}
test('service archive fetches granted projects and opens only a current server-projected project', async () => {
  const f = fixture(); await f.module.load(f.page);
  assert.equal(f.calls[0][0], '/miniprogram/construction/video/customer-projects/12');
  f.module.open(f.page, { currentTarget: { dataset: { project: '999' } } }); assert.equal(f.navigation.length, 0);
  f.module.open(f.page, { currentTarget: { dataset: { project: '21' } } }); assert.equal(f.navigation[0], '/packages/construction/camera/camera?projectId=21');
  f.setResponse(async () => ({ data: { items: [] } })); await f.module.load(f.page); assert.deepEqual(f.page.data.cameraProjects, []);
});
test('failed video reads leave recovery feedback and never preserve a revoked button', async () => {
  const f = fixture(); await f.module.load(f.page); f.setResponse(async () => { throw Error('service unavailable'); });
  await f.module.load(f.page); assert.deepEqual(f.page.data.cameraProjects, []); assert.ok(f.page.data.cameraError); assert.equal(f.page.data.cameraLoading, false);
  f.setResponse(async () => ({ data: { items: [{ id: '22', name: '当前工地' }] } })); await f.module.load(f.page); assert.equal(f.page.data.cameraError, '');
});
test('late reads cannot populate a different identity, project or unloaded page', async () => {
  for (const kind of ['identity', 'lead', 'unload', 'newer']) {
    const f = fixture(); let resolve;
    f.setResponse(() => new Promise(r => { resolve = r; })); const pending = f.module.load(f.page); await new Promise(setImmediate);
    if (kind === 'identity') f.app.globalData.token = 'customer-b';
    if (kind === 'lead') f.page.data.leadId = '13';
    if (kind === 'unload') f.module.invalidate(f.page);
    if (kind === 'newer') { f.setResponse(async () => ({ data: { items: [] } })); await f.module.load(f.page); }
    resolve({ data: { items: [{ id: '21', name: '旧工地' }] } }); await pending; assert.deepEqual(f.page.data.cameraProjects, []);
  }
});
test('a customer may mount the existing WebView only after a real entry response', async () => {
  const p = path.resolve(__dirname, '../packages/construction/camera/camera.js'), local = createRequire(p);
  let definition, granted = false, requests = 0;
  const app = { globalData: { token: 'customer', bootstrap: { current: { mode: 'customer', role: 'user', capabilities: ['customer.projects'] } } } };
  new Function('Page', 'getApp', 'wx', 'require', fs.readFileSync(p, 'utf8'))(d => { definition = d; }, () => app, { getStorageSync: () => '' }, n => n.includes('utils/api') ? { request: async () => {
    requests++; if (!granted) throw Error('404'); return { data: { url: 'https://camera.example/construction-camera#entry=1.' + 'a'.repeat(43) } };
  } } : local(n));
  const page = { ...definition, data: { ...definition.data }, setData(data) { Object.assign(this.data, data); } };
  page.onLoad({ projectId: '21' }); page._visible = true; await page.open(); assert.equal(page.data.src, ''); assert.ok(page.data.error);
  granted = true; await page.open(); assert.match(page.data.src, /#entry=/); assert.equal(requests, 2);
  page.onHide(); assert.equal(page.data.src, '');
});
