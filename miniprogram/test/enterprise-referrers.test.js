const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniProgramRoot = path.resolve(__dirname, '..');
const pageRoot = path.join(miniProgramRoot, 'packages', 'business', 'enterprise-referrers');

function read(name) {
  return fs.readFileSync(path.join(pageRoot, name), 'utf8');
}

test('enterprise referrer roster is an owner-only deep page with search, phone, and disable', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'));
  const navigation = fs.readFileSync(path.join(miniProgramRoot, 'utils', 'identity-navigation.js'), 'utf8');
  const config = JSON.parse(read('enterprise-referrers.json'));
  const template = read('enterprise-referrers.wxml');
  const page = read('enterprise-referrers.js');
  const styles = read('enterprise-referrers.less');
  const staffStyles = fs.readFileSync(
    path.join(miniProgramRoot, 'packages', 'business', 'enterprise-staff', 'enterprise-staff.less'),
    'utf8'
  );
  const business = appConfig.subPackages.find((entry) => entry.root === 'packages/business');

  assert.ok(business.pages.includes('enterprise-referrers/enterprise-referrers'));
  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.usingComponents, undefined);
  assert.doesNotMatch(template, /<custom-tab-bar\s*\/>/);
  assert.match(navigation, /'\/packages\/business\/enterprise-referrers\/enterprise-referrers': 'enterprise\.operations'/);

  assert.match(template, /padding-right: \{\{navigationRight\}\}px/);
  assert.match(template, /bindtap="onBack"/);
  assert.match(template, /推荐人/);
  assert.match(template, /xiao-k-measurer-3d\.png/);
  assert.match(template, /statusChips/);
  assert.match(template, /全部|活动|已停用|已退出/);
  assert.match(template, /搜索姓名或手机号/);
  assert.match(template, /停用后续扫码|item\.actionLabel/);
  assert.match(template, /出示入驻码/);
  assert.match(page, /\/miniprogram\/enterprise-referrers/);
  assert.match(page, /\/miniprogram\/enterprise-referrers\/\$\{encodeURIComponent\(item\.id\)\}\/disable/);
  assert.match(page, /query,/);
  assert.match(page, /status:/);
  assert.match(page, /wx\.showModal/);
  assert.match(page, /confirmText: '确认停用'/);
  assert.match(page, /停用后该推荐人不能再出示活动推广码获客；历史线索和提成记录保持不变。/);
  assert.doesNotMatch(page, /重新启用|enableEnterpriseReferrer|reenable/);
  assert.match(page, /enterprise-join-codes\/enterprise-join-codes/);
  const workbench = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.js'), 'utf8');
  const workbenchTemplate = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.wxml'), 'utf8');
  const joinCodes = fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'enterprise-join-codes', 'enterprise-join-codes.wxml'), 'utf8');
  const mine = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'mine', 'mine.js'), 'utf8');
  assert.match(workbenchTemplate, /bindtap="openReferrerRoster"/);
  assert.match(workbenchTemplate, /查看推广人/);
  assert.match(workbench, /enterprise-referrers\/enterprise-referrers/);
  assert.match(joinCodes, /查看已入驻推荐人/);
  assert.match(mine, /referrers: \(\) => wx\.navigateTo/);
  const confirmText = page.match(/confirmText:\s*'([^']+)'/);
  assert.ok(confirmText);
  assert.ok(confirmText[1].length <= 4, `wx.showModal confirmText must be ≤4 chars: ${confirmText[1]}`);
  assert.match(styles, /@import\s+["']\.\.\/enterprise-staff\/enterprise-staff\.less["']/);
  assert.match(styles, /font-size:\s*24rpx/);
  assert.doesNotMatch(styles, /font-size:\s*1[89]rpx/);
  assert.doesNotMatch(styles, /font-size:\s*20rpx/);
  assert.match(staffStyles, /font-size:\s*32rpx|font-size:\s*34rpx/);
  assert.match(staffStyles, /\.status-tag\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(staffStyles, /\.status-tag\s*\{[\s\S]*align-items:\s*center/);
  assert.match(staffStyles, /\.status-tag text\s*\{[\s\S]*line-height:\s*1;/);
  assert.match(styles, /\.search-surface\s*\{/);
  assert.match(styles, /\.phone-row\s*\{[\s\S]*justify-content:\s*flex-start/);
  assert.match(styles, /\.card-footer\s*\{[\s\S]*justify-content:\s*space-between/);
  assert.match(template, /item\.phone && !item\.actionLabel/);
  assert.match(template, /phone-row sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png/);
  assert.match(template, /wx:if="\{\{item\.actionLabel\}\}"[\s\S]*card-footer/);
  assert.match(template, /ghost-btn sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png[\s\S]*电话联系/);
  assert.match(page, /wx\.makePhoneCall/);
  assert.match(page, /onLoadMore/);
  assert.match(page, /list-pagination/);
  assert.match(template, /bindscrolltolower="onLoadMore"/);
  assert.match(template, /sfp-list-footer/);
});
