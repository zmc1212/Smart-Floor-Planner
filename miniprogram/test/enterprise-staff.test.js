const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniProgramRoot = path.resolve(__dirname, '..');
const pageRoot = path.join(miniProgramRoot, 'packages', 'business', 'enterprise-staff');

function read(name) {
  return fs.readFileSync(path.join(pageRoot, name), 'utf8');
}

test('enterprise staff roster is an owner-only deep page with pause and join-code empty', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'));
  const navigation = fs.readFileSync(path.join(miniProgramRoot, 'utils', 'identity-navigation.js'), 'utf8');
  const config = JSON.parse(read('enterprise-staff.json'));
  const template = read('enterprise-staff.wxml');
  const page = read('enterprise-staff.js');
  const styles = read('enterprise-staff.less');
  const business = appConfig.subPackages.find((entry) => entry.root === 'packages/business');

  assert.ok(business.pages.includes('enterprise-staff/enterprise-staff'));
  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.usingComponents, undefined);
  assert.doesNotMatch(template, /<custom-tab-bar\s*\/>/);
  assert.match(navigation, /'\/packages\/business\/enterprise-staff\/enterprise-staff': 'enterprise\.operations'/);

  assert.match(template, /padding-right: \{\{navigationRight\}\}px/);
  assert.match(template, /bindtap="onBack"/);
  assert.match(template, /人员派单/);
  assert.match(template, /xiao-k-measurer-3d\.png/);
  assert.match(template, /roleChips/);
  assert.match(template, /暂停派单|item\.actionLabel/);
  assert.match(template, /出示入驻码/);
  assert.match(page, /\/miniprogram\/enterprise-staff/);
  assert.match(page, /\/miniprogram\/enterprise-staff\/\$\{encodeURIComponent\(item\.id\)\}\/assignment/);
  assert.match(page, /assignmentPaused/);
  assert.match(page, /wx\.showModal/);
  assert.match(page, /enterprise-join-codes\/enterprise-join-codes/);
  assert.match(page, /options\.focus/);
  assert.match(styles, /font-size:\s*32rpx|font-size:\s*34rpx/);
  assert.match(styles, /font-size:\s*24rpx/);
  assert.doesNotMatch(styles, /font-size:\s*1[89]rpx/);
  assert.doesNotMatch(styles, /font-size:\s*20rpx/);
  assert.match(styles, /\.status-tag\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(styles, /\.status-tag\s*\{[\s\S]*align-items:\s*center/);
  assert.match(styles, /\.status-tag text\s*\{[\s\S]*line-height:\s*1;/);
  assert.match(styles, /\.retry\s*\{[\s\S]*align-items:\s*center/);
  assert.match(template, /ghost-btn sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png[\s\S]*电话联系/);
  assert.match(page, /wx\.makePhoneCall/);
});
