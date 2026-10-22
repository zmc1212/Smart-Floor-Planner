const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../packages/construction/brief/brief.js');
function fixture() {
  let def, handler = async () => ({ data: { items: [{ projectId: '1', issues: [{ issueId: '2' }] }], asOf: '2026-10-22T12:00:00.000Z', version: 'v1' } });
  const app = { globalData: { token: 'a', bootstrap: { current: { role: 'construction_staff', capabilities: ['construction.projects'], context: { enterpriseId: '1', staffId: '2' } } } } };
  const calls = [], wx = { getStorageSync: () => '', navigateTo: o => calls.push(o.url), getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }), getMenuButtonBoundingClientRect: () => ({ top: 48, left: 296, height: 32 }) };
  const local = createRequire(file);
  new Function('require','Page','getApp','wx',fs.readFileSync(file,'utf8'))(n => n.includes('utils/api') ? { request: (...a) => handler(...a) } : local(n), p => { def = p; }, () => app, wx);
  const p = { ...def, data: structuredClone(def.data), setData(v) { Object.assign(this.data, v); }, poll() {} };
  return { p, app, calls, intercept(fn) { handler = fn; } };
}
test('brief reentry reloads facts; error clears stale facts and retry restores them', async () => {
  const f = fixture(); f.p.onLoad(); await f.p.onShow(); assert.equal(f.p.data.items.length,1);
  f.intercept(async () => { throw { error: 'construction_unavailable' }; }); await f.p.load(true); assert.equal(f.p.data.items.length,0); assert.ok(f.p.data.error);
  f.intercept(async () => ({ data: { items: [], asOf: '2026-10-22T12:01:00.000Z', version: 'v2' } })); await f.p.load(); assert.equal(f.p.data.error,''); assert.equal(f.p.data.version,'v2');
  f.p.onHide(); assert.equal(f.p.data.items.length,0); await f.p.onShow(); assert.equal(f.p.data.version,'v2');
});
test('identity changes and hidden pages reject late responses; only listed issues can be opened', async () => {
  const f = fixture(); await f.p.onShow();
  f.p.openProject({ currentTarget: { dataset: { project: '1', issue: '2' } } }); assert.match(f.calls[0], /projectId=1&issueId=2/);
  f.p.openProject({ currentTarget: { dataset: { project: '9', issue: '2' } } }); assert.equal(f.calls.length,1);
  let resolve; f.intercept(() => new Promise(r => { resolve = r; })); const pending = f.p.load(); f.p.onHide();
  resolve({ data: { items: [{ projectId: 'secret' }], asOf: '2026-10-22T00:00:00Z' } }); await pending; assert.equal(f.p.data.items.length,0);
  f.app.globalData.token = 'other'; assert.equal(f.p.current(),false);
});
