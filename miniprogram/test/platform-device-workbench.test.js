const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workbenchRoot = path.join(
  __dirname,
  '..',
  'components',
  'platform-device-workbench'
);

function read(name) {
  return fs.readFileSync(path.join(workbenchRoot, name), 'utf8');
}

test('platform device workbench enrolls and lists optional SN codes', () => {
  const js = read('platform-device-workbench.js');
  const wxml = read('platform-device-workbench.wxml');
  const less = read('platform-device-workbench.less');

  assert.match(wxml, /SN 码（可选，单台共用）/);
  assert.match(wxml, /本台 SN 码（可选）/);
  assert.match(wxml, /item\.serialNumber/);
  assert.match(wxml, /取消搜索/);
  assert.match(js, /onSerialNumberInput/);
  assert.match(js, /onDeviceSerialInput/);
  assert.match(js, /onCancelScan/);
  assert.match(js, /cancelBLEEnrollmentScan/);
  assert.match(js, /silent:\s*true/);
  assert.match(js, /enterpriseId=\$\{encodeURIComponent\(listEnterpriseId\)\}/);
  assert.match(js, /typeof requestedListEnterpriseId === 'string'/);
  assert.match(js, /ALL_ENTERPRISES_LABEL/);
  assert.match(js, /onListEnterpriseChange/);
  assert.match(js, /onEnterpriseChange/);
  assert.match(wxml, /查看范围/);
  assert.match(wxml, /全部企业/);
  assert.match(js, /serialNumber:/);
  assert.match(js, /'\/miniprogram\/devices'/);
  assert.match(less, /\.device-sn/);
  assert.match(less, /\.scan-sn/);
  assert.doesNotMatch(less, /font-size:\s*1[89]rpx/);
  assert.doesNotMatch(less, /font-size:\s*[0-9]rpx/);
});
