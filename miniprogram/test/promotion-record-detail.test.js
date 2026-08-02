const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pageRoot = path.join(root, 'pages', 'promotion-record-detail');

test('promotion detail ships the approved live-data composition', () => {
  const wxml = fs.readFileSync(path.join(pageRoot, 'promotion-record-detail.wxml'), 'utf8');
  const script = fs.readFileSync(path.join(pageRoot, 'promotion-record-detail.js'), 'utf8');

  assert.match(wxml, /images\/promotion-detail\/hero-scene\.png/);
  assert.match(wxml, /record\.enterpriseName/);
  assert.match(wxml, /maskedPhone/);
  assert.match(wxml, /wx:for="\{\{stageSteps\}\}"/);
  assert.match(wxml, /maxlength="300"/);
  assert.match(wxml, /timelineRecords/);
  assert.match(wxml, /userInfo\.staffRole === 'enterprise_admin'/);
  assert.match(script, /function maskPhone/);
  assert.match(script, /function buildStageSteps/);
  assert.doesNotMatch(script, /星河装饰|138\*\*\*\*2211/);
});

test('promotion detail reference icons are local PNGs within the micro-icon budget', () => {
  const imageRoot = path.join(root, 'images', 'promotion-detail');
  for (const file of ['calendar.png', 'clock.png', 'measurer.png', 'designer.png']) {
    const data = fs.readFileSync(path.join(imageRoot, file));
    assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(data.length <= 10 * 1024, `${file} exceeds the 10 KB micro-icon budget`);
  }
});
