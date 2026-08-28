const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.join(__dirname, '..');
const pageRoot = path.join(miniRoot, 'packages', 'platform', 'devices');

function read(name) {
  return fs.readFileSync(path.join(pageRoot, name), 'utf8');
}

test('platform device workbench lives in the platform subpackage and enrolls optional SN codes', () => {
  const js = read('devices.js');
  const wxml = read('devices.wxml');
  const less = read('devices.less');
  const json = JSON.parse(read('devices.json'));
  const indexJson = JSON.parse(
    fs.readFileSync(path.join(miniRoot, 'pages', 'index', 'index.json'), 'utf8')
  );
  const indexWxml = fs.readFileSync(path.join(miniRoot, 'pages', 'index', 'index.wxml'), 'utf8');
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
  const platform = appConfig.subPackages.find((item) => item.root === 'packages/platform');

  assert.ok(platform);
  assert.ok(platform.pages.includes('devices/devices'));
  assert.equal(json.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  assert.match(wxml, /<custom-tab-bar\s*\/>/);
  assert.equal(indexJson.usingComponents['platform-device-workbench'], undefined);
  assert.doesNotMatch(indexWxml, /platform-device-workbench/);
  assert.equal(
    fs.existsSync(path.join(miniRoot, 'components', 'platform-device-workbench')),
    false
  );

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
  assert.match(js, /require\('\.\.\/\.\.\/\.\.\/utils\/bluetooth\.js'\)/);
  assert.match(less, /\.device-sn/);
  assert.match(less, /\.scan-sn/);
  assert.doesNotMatch(less, /font-size:\s*1[89]rpx/);
  assert.doesNotMatch(less, /font-size:\s*[0-9]rpx/);
});
