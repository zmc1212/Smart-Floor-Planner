const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('appointment detail is registered and exposes only server-backed lifecycle actions', () => {
  const config = JSON.parse(read('app.json'));
  const business = config.subPackages.find((item) => item.root === 'packages/business');
  const script = read('packages/business/appointment-detail/appointment-detail.js');
  const wxml = read('packages/business/appointment-detail/appointment-detail.wxml');

  assert.ok(business.pages.includes('appointment-detail/appointment-detail'));
  assert.match(script, /\['designer', 'enterprise_admin'\]\.includes\(role\)/);
  assert.match(script, /\['measurer', 'enterprise_admin'\]\.includes\(role\)/);
  assert.match(script, /appointment-reschedule\/appointment-reschedule\?mode=internal/);
  assert.match(script, /updateStatus\('cancel'/);
  assert.match(script, /updateStatus\('complete'/);
  assert.match(script, /请填写取消原因/);
  assert.match(wxml, /schedule-guide\.png/);
  assert.match(wxml, /wx:if="\{\{canComplete\}\}"/);
  assert.match(wxml, /wx:if="\{\{canReschedule\}\}"/);
  assert.match(wxml, /wx:if="\{\{canCancel\}\}"/);
});

test('internal reschedule reuses real availability and requires an audit reason', () => {
  const script = read('packages/business/appointment-reschedule/appointment-reschedule.js');
  const wxml = read('packages/business/appointment-reschedule/appointment-reschedule.wxml');
  assert.match(script, /query\.mode === 'internal'/);
  assert.match(script, /internal-reschedule/);
  assert.match(script, /请填写调整原因/);
  assert.match(wxml, /wx:if="\{\{internalMode\}\}"/);
  assert.match(wxml, /bindinput="onReasonInput"/);
});
