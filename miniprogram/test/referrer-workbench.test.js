const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadPage() {
  const pagePath = require.resolve('../packages/business/referrer-workbench/referrer-workbench.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('referrer workbench lists active memberships and opens the selected service-code screen', async () => {
  const definition = loadPage();
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const requests = [];
  api.request = async (...args) => {
    requests.push(args);
    return { data: [
      { id: 'active-1', status: 'active', enterpriseName: '宜家装饰工程有限公司' },
      { id: 'left-1', status: 'exited', enterpriseName: '历史企业' },
    ] };
  };
  global.wx = { navigateTo(options) { this.lastNavigation = options; } };
  const context = { data: { ...definition.data }, setData(next) { Object.assign(this.data, next); } };

  try {
    await definition.load.call(context);
    assert.deepEqual(requests, [['/miniprogram/referrer-memberships', 'GET']]);
    assert.deepEqual(context.data.memberships.map((item) => item.id), ['active-1']);
    assert.equal(context.data.selectedMembershipId, 'active-1');
    definition.showServiceCode.call(context);
    assert.equal(global.wx.lastNavigation.url, '/packages/business/promotion-service-code/promotion-service-code?membershipId=active-1');
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('referrer workbench ships the Antigravity standalone asset and preserves the selected design contract', () => {
  const wxml = source('packages/business/referrer-workbench/referrer-workbench.wxml');
  const wxss = source('packages/business/referrer-workbench/referrer-workbench.wxss');
  const asset = fs.readFileSync(path.join(miniRoot, 'packages/business/assets/referrer-workbench-v1/service-code-guide.png'));

  assert.match(wxml, /推广服务/);
  assert.match(wxml, /展示服务码/);
  assert.match(wxml, /退出该企业/);
  assert.match(wxml, /referrer-workbench-v1\/service-code-guide\.png/);
  assert.match(wxml, /navigationRight/);
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(asset.length <= 300 * 1024);
  assert.ok(asset.includes(Buffer.from('tRNS')) || [4, 6].includes(asset[25]));
});
