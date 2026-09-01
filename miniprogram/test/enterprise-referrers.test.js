const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniProgramRoot = path.resolve(__dirname, '..');
const pageRoot = path.join(miniProgramRoot, 'packages', 'business', 'enterprise-referrers');
const branchRoot = path.join(miniProgramRoot, 'packages', 'business', 'enterprise-referrer-branch');

function read(name) {
  return fs.readFileSync(path.join(pageRoot, name), 'utf8');
}

test('enterprise referrer roster supports owner network and employee-owned lists', () => {
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
  assert.ok(business.pages.includes('enterprise-referrer-branch/enterprise-referrer-branch'));
  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.usingComponents, undefined);
  assert.doesNotMatch(template, /<custom-tab-bar\s*\/>/);
  assert.match(navigation, /'\/packages\/business\/enterprise-referrers\/enterprise-referrers': 'referrer\.network'/);

  assert.match(template, /padding-right: \{\{navigationRight\}\}px/);
  assert.match(template, /bindtap="onBack"/);
  assert.match(template, /推广网络/);
  // The roster copy is scope-aware and rendered through `inviteLabel`; the
  // own-scope wording is covered by the presentation-model test below.
  assert.match(template, /inviteLabel/);
  assert.match(template, /xiao-k-measurer-3d\.png/);
  assert.match(template, /viewChips/);
  assert.match(template, /networkSummary\.employeeCount/);
  assert.match(template, /networkSummary\.unassignedCount/);
  assert.match(template, /branches/);
  assert.match(template, /network-branch-summary/);
  assert.match(template, /查看该员工推广人/);
  assert.match(template, /bindtap="openBranch"/);
  assert.doesNotMatch(template, /branch-items/);
  assert.match(template, /statusChips/);
  assert.match(template, /全部|已启用|已停用|已退出/);
  assert.match(template, /搜索姓名或手机号/);
  assert.match(template, /canDisable && item\.actionLabel/);
  assert.match(template, /inviteLabel/);
  assert.match(page, /\/miniprogram\/enterprise-referrers/);
  assert.match(page, /view: requestedView === 'network' \? 'network' : ''/);
  assert.match(page, /normalizeRosterScope\(payload\.scope\)/);
  assert.match(page, /normalizeRosterView\(requestedView, scope\)/);
  assert.match(page, /decorateNetworkBranches\(payload\.branches, false\)/);
  assert.match(page, /enterprise-referrer-branch\/enterprise-referrer-branch/);
  assert.match(page, /Boolean\(isEnterpriseScope && payload\.canDisable\)/);
  assert.match(page, /viewReferrerLeads/);
  assert.match(template, /查看推广客户/);
  assert.match(page, /\/miniprogram\/enterprise-referrers\/\$\{encodeURIComponent\(item\.id\)\}\/disable/);
  assert.match(page, /query,/);
  assert.match(page, /status:/);
  assert.match(page, /wx\.showModal/);
  assert.match(page, /confirmText: '确认停用'/);
  assert.match(page, /停用后该推广人不能再出示活动推广码获客；历史线索和提成记录保持不变。/);
  assert.doesNotMatch(page, /重新启用|enableEnterpriseReferrer|reenable/);
  assert.match(page, /enterprise-join-codes\/enterprise-join-codes/);
  const workbench = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.js'), 'utf8');
  const workbenchTemplate = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.wxml'), 'utf8');
  const joinCodes = fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'enterprise-join-codes', 'enterprise-join-codes.wxml'), 'utf8');
  const mine = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'mine', 'mine.js'), 'utf8');
  assert.match(workbenchTemplate, /bindtap="openReferrerRoster"/);
  assert.match(workbenchTemplate, /\{\{referrerRoster\.label\}\}/);
  assert.match(workbenchTemplate, /\{\{referrerRoster\.detail\}\}/);
  assert.match(workbench, /enterprise-referrers\/enterprise-referrers/);
  assert.match(joinCodes, /rosterLinkLabel/);
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
  assert.match(template, /item\.phone && !\(canDisable && item\.actionLabel\)/);
  assert.match(template, /phone-row sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png/);
  assert.match(template, /wx:if="\{\{canDisable && item\.actionLabel\}\}"[\s\S]*card-footer/);
  assert.match(template, /ghost-btn sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png[\s\S]*电话联系/);
  assert.match(page, /wx\.makePhoneCall/);
  assert.match(page, /onLoadMore/);
  assert.match(page, /list-pagination/);
  assert.match(template, /bindscrolltolower="onLoadMore"/);
  assert.match(template, /sfp-list-footer/);

  const branchConfig = JSON.parse(fs.readFileSync(path.join(branchRoot, 'enterprise-referrer-branch.json'), 'utf8'));
  const branchTemplate = fs.readFileSync(path.join(branchRoot, 'enterprise-referrer-branch.wxml'), 'utf8');
  const branchPage = fs.readFileSync(path.join(branchRoot, 'enterprise-referrer-branch.js'), 'utf8');
  const branchStyles = fs.readFileSync(path.join(branchRoot, 'enterprise-referrer-branch.less'), 'utf8');
  assert.equal(branchConfig.navigationStyle, 'custom');
  assert.match(navigation, /enterprise-referrer-branch\/enterprise-referrer-branch': 'referrer\.network'/);
  assert.match(branchTemplate, /高容海的推广人|\{\{pageTitle\}\}/);
  assert.match(branchTemplate, /搜索姓名或手机号/);
  assert.match(branchTemplate, /电话联系/);
  assert.match(branchTemplate, /item\.actionLabel/);
  assert.match(branchTemplate, /bindscrolltolower="onLoadMore"/);
  assert.match(branchPage, /view:'staff'/);
  assert.match(branchPage, /停用后续扫码/);
  assert.match(branchPage, /staffId:this\.data\.staffId/);
  assert.match(branchPage, /\/miniprogram\/enterprise-referrers\/\$\{encodeURIComponent\(item\.id\)\}\/disable/);
  assert.match(branchPage, /wx\.makePhoneCall/);
  assert.match(branchStyles, /font-size:24rpx/);
});

test('referrer roster model keeps zero branches, deleted snapshots, and employee read-only actions', () => {
  const model = require('../packages/business/enterprise-referrers/enterprise-referrers-model.js');
  const source = [
    {
      staff: { id: '11', displayName: '负责人', role: 'enterprise_admin', status: 'active' },
      total: 1,
      activeCount: 1,
      items: [{ id: 'r1', displayName: '推广人甲', action: 'disable', actionLabel: '停用后续扫码' }],
    },
    {
      staff: { id: '12', displayName: '员工乙', role: 'designer', status: 'active' },
      total: 0,
      activeCount: 0,
      items: [],
    },
    {
      staff: { id: null, displayName: '离职员工丙', role: null, status: 'deleted' },
      total: 1,
      activeCount: 0,
      items: [{ id: 'r2', action: null, actionLabel: '' }],
    },
    {
      staff: null,
      total: 1,
      activeCount: 1,
      items: [{ id: 'r3', action: 'disable', actionLabel: '停用后续扫码' }],
    },
  ];

  const ownerBranches = model.decorateNetworkBranches(source, true);
  assert.equal(ownerBranches.length, 4);
  assert.equal(ownerBranches[1].total, 0);
  assert.deepEqual(ownerBranches[1].items, []);
  assert.equal(ownerBranches[2].staffName, '离职员工丙');
  assert.equal(ownerBranches[2].staffRoleLabel, '历史员工');
  assert.equal(ownerBranches[3].staff, null);
  assert.equal(ownerBranches[3].staffName, '历史未归属');
  assert.equal(ownerBranches[0].items[0].action, 'disable');
  assert.equal(ownerBranches[0].staffInitial, '负');

  const employeeItems = model.decorateReferrerItems(source[0].items, false);
  assert.equal(employeeItems[0].action, null);
  assert.equal(employeeItems[0].actionLabel, '');
  const employeeManagedItems = model.decorateReferrerItems(source[0].items, true);
  assert.equal(employeeManagedItems[0].action, 'disable');
  assert.equal(model.normalizeRosterView('network', 'own'), 'all');
  assert.equal(model.rosterPresentation('own').pageTitle, '我的推广人');
});
