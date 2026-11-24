const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { generateUUID } = require('../utils/util');
const coordinates = require('../packages/construction/lib/inspection-coordinates');

const pageDir = path.join(__dirname, '../packages/construction/inspection-map');
const pageSource = readFileSync(path.join(pageDir, 'inspection-map.js'), 'utf8');
const journeySource = readFileSync(path.join(pageDir, '../lib/inspection-journey.js'), 'utf8');
const { shanghaiDay } = require('../packages/construction/lib/inspection-journey');
const original = { latitude: 39.915, longitude: 116.404 };
const pin = { ...original, coordinateSystem: 'wgs84', revision: 1, name: '工地入口' };
const stop = { projectId: '41', name: '巡检测试工地', pin, recordIds: ['23'], requiredCount: 1 };
const destination = { latitude: 39.938, longitude: 116.409 };
const route = { seconds: 120, stops: [{ ...stop, seconds: 120, points: [original, destination] }] };
const fixture = {
  '../../../utils/util': { generateUUID },
  '../chat/site-client': { errorText: error => error.message },
  '../lib/site-font': { loadSiteFont() {} },
  '../lib/inspection-location': { readInspectionFix: async () => ({ point: pin }) },
  '../lib/inspection-coordinates': coordinates,
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const stations = (items = [stop]) => ({ data: { today: shanghaiDay(), stops: items } });
const choose = id => ({ currentTarget: { dataset: { id } } });

function loadPage(handler, storage = new Map()) {
  let definition;
  const calls = [];
  const wx = {
    navigateTo: options => calls.push(options.url),
    openLocation: options => { calls.push(options); options.success(); },
    pageScrollTo() {},
    getStorageSync: key => storage.has(key) ? JSON.parse(storage.get(key)) : null,
    setStorageSync: (key, value) => storage.set(key, JSON.stringify(value)),
    removeStorageSync: key => storage.delete(key),
  };
  const module = { exports: {} };
  vm.runInNewContext(journeySource, { module, wx });
  vm.runInNewContext(pageSource, {
    Page: input => { definition = input; },
    getApp: () => ({ globalData: { token: 'staff-token', userInfo: { enterpriseId: '1454', staffId: '6' } } }),
    wx,
    require: key => key === '../../../utils/api' ? { request: handler }
      : key === '../lib/inspection-journey' ? module.exports : fixture[key],
    setInterval() {},
    clearInterval() {},
    setTimeout: callback => setImmediate(callback),
  });
  const page = {
    ...definition, data: { ...definition.data },
    setData(input) { Object.assign(this.data, input); },
  };
  return { page, calls };
}

test('default native map independently projects Tianditu points and converts map-selected origins back', () => {
  const markup = readFileSync(path.join(pageDir, 'inspection-map.wxml'), 'utf8');
  assert.match(markup, /<map\b[^>]*markers="{{markers}}"[^>]*polyline="{{polyline}}"/);
  assert.doesNotMatch(markup, /<web-view\b|subkey|layer-style/);

  const display = coordinates.toNativeMapPoint(original);
  assert.ok(Math.abs(display.longitude - 116.410244499) < 1e-7);
  assert.ok(Math.abs(display.latitude - 39.916404282) < 1e-7);
  const input = coordinates.fromNativeMapPoint(display);
  assert.ok(Math.abs(input.longitude - original.longitude) < 1e-7);
  assert.ok(Math.abs(input.latitude - original.latitude) < 1e-7);
});

test('plan follows native display and retries the same durable request after HTTP 202 and a gateway break', async () => {
  const requests = [];
  const { page, calls } = loadPage(async (url, method, data, options) => {
    if (url.includes('/route-stops')) return stations();
    if (url.endsWith('/map-entry')) return { data: { ticket: 'verified.ticket' } };
    requests.push({ url, method, data, options });
    if (requests.length === 1) return { data: null };
    if (requests.length === 2) throw { statusCode: 504 };
    return { data: route };
  });
  page.onShow();
  await tick();
  assert.equal(page.data.ready, true);
  assert.equal(page.data.markers[0].callout.content, stop.name);
  page.toggleStop(choose(stop.projectId));
  page.pickOrigin();
  page.mapTap({ detail: coordinates.toNativeMapPoint(destination) });
  await page.plan();
  assert.equal(requests.length, 3);
  assert.match(requests[0].options.headers['X-Inspection-Request-Id'], /^[a-f0-9]{32}$/);
  for (const request of requests) {
    assert.equal(request.url, '/miniprogram/construction/inspection/map');
    assert.equal(request.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer verified.ticket');
    assert.equal(request.options.headers['X-Inspection-Request-Id'], requests[0].options.headers['X-Inspection-Request-Id']);
    assert.equal(request.data.origin.coordinateSystem, 'wgs84');
    assert.ok(Math.abs(request.data.origin.longitude - destination.longitude) < 1e-7);
  }
  assert.equal(page.data.estimate, 2);
  assert.equal(page.data.polyline[0].points.length, 2);
  assert.equal(page.data.polyline[0].points[0].longitude, coordinates.toNativeMapPoint(original).longitude);
  assert.ok(page.data.includePoints[0].latitude < Math.min(...page.data.polyline[0].points.map(point => point.latitude)));
  assert.ok(page.data.includePoints[1].latitude > Math.max(...page.data.polyline[0].points.map(point => point.latitude)));
  assert.ok(page.data.center.latitude > page.data.polyline[0].points[0].latitude);
  page.openTasks({ currentTarget: { dataset: { id: stop.projectId } } });
  assert.deepEqual(calls, ['/packages/construction/inspection/inspection?projectId=41&onsite=1']);
  page.onUnload();
});

test('foreground reentry hides the cached route immediately and removes geometry after access denial', async () => {
  let revoked = false;
  const { page } = loadPage(async url => {
    if (url.includes('/route-stops')) {
      if (revoked) throw { statusCode: 403, error: 'construction_forbidden' };
      return stations();
    }
    if (url.endsWith('/map-entry')) return { data: { ticket: 'verified.ticket' } };
    return { data: route };
  });
  page.onShow();
  await tick();
  page.toggleStop(choose(stop.projectId));
  await page.plan();
  assert.equal(page.data.polyline.length, 1);
  page.onHide();
  revoked = true;
  page.onShow();
  assert.equal(page.data.ready, false);
  await tick();
  assert.match(page.data.error, /工地权限已变化/);
  assert.equal(page.data.markers.length, 0);
  assert.equal(page.data.polyline.length, 0);
  assert.equal(page.data.stations.length, 0);
  page.onUnload();
});

test('navigation opens the original check-in path and live records drive the next stop across page instances', async () => {
  const storage = new Map();
  const second = { ...stop, projectId: '42', name: '第二个巡检工地', recordIds: ['24'] };
  let projected = [stop, second];
  let plans = 0;
  const handler = async url => {
    if (url.includes('/route-stops')) return stations(projected);
    if (url.endsWith('/map-entry')) return { data: { ticket: 'verified.ticket' } };
    plans++;
    return { data: { seconds: 151, stops: [...route.stops, { ...second, seconds: 31, points: [destination, original] }] } };
  };
  const first = loadPage(handler, storage);
  first.page.onShow();
  await tick();
  first.page.toggleStop(choose('41'));
  first.page.toggleStop(choose('42'));
  await first.page.plan();
  assert.equal(first.page.data.estimate, 3);
  await first.page.navigateNext();
  assert.equal(first.page.data.navigated, true);
  assert.equal(first.page.data.next.projectId, '41');
  assert.equal(first.calls[0].longitude, coordinates.toNativeMapPoint(stop.pin).longitude);
  first.page.verifyNext();
  assert.match(first.calls[1], /inspection-record\?projectId=41&recordId=23$/);
  first.page.onUnload();

  projected = [{ ...stop, recordIds: [] }, second];
  const resumed = loadPage(handler, storage).page;
  resumed.onShow();
  await tick();
  assert.equal(resumed.data.ordered[0].done, true);
  assert.equal(resumed.data.next.projectId, '42');
  assert.equal(resumed.data.navigated, false);
  assert.equal(plans, 1);

  projected = [second];
  await resumed.open();
  assert.equal(resumed.data.ordered.length, 1);
  assert.equal(resumed.data.next.projectId, '42');
  assert.equal(resumed.data.polyline.length, 0);
  assert.equal(resumed.data.stale, true);

  projected = [{ ...second, recordIds: [] }];
  await resumed.open();
  assert.equal(resumed.data.routeActive, false);
  resumed.onUnload();

  projected = [...projected, stop];
  const newPlanning = loadPage(handler, storage).page;
  newPlanning.onShow();
  await tick();
  assert.equal(newPlanning.data.editing, true);
  assert.equal(newPlanning.data.stations[0].projectId, '41');
  newPlanning.onUnload();
});
