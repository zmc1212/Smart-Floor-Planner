const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const chatRoot = path.join(__dirname, '..', 'packages', 'assistant', 'chat');
const wxml = fs.readFileSync(path.join(chatRoot, 'chat.wxml'), 'utf8');
const js = fs.readFileSync(path.join(chatRoot, 'chat-definition.js'), 'utf8');
const less = fs.readFileSync(path.join(chatRoot, 'floorplan-booking.less'), 'utf8');

test('the floorplan sheet renders the mounted plan and per-room records', () => {
  assert.match(wxml, /class="fp-mat"/);
  assert.match(wxml, /class="fp-room"/);
  assert.match(wxml, /item\.wallItems/);
  assert.match(wxml, /item\.openingItems/);
  assert.match(less, /\.fp-mat/);
  assert.match(less, /\.fp-room/);
});

test('the legacy full archive entry is gone and the protected image opens in place', () => {
  assert.doesNotMatch(wxml, /打开完整服务档案/);
  assert.doesNotMatch(js, /openFullArchive/);
  assert.match(wxml, /打开户型图/);
  assert.match(wxml, /bindtap="previewFloorplan"/);
  assert.match(js, /async previewFloorplan\(\)/);
  assert.match(js, /fetchProtectedImage\(detail\.previewEndpoint/);
});
