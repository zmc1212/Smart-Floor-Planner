const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', 'packages', 'business');
const miniProgramRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('referrer and measurer landings keep the role navigation visible above the bottom safe area', () => {
  const referrerConfig = JSON.parse(read('referrer-workbench/referrer-workbench.json'));
  const measurerConfig = JSON.parse(read('measurer-calendar/measurer-calendar.json'));
  const referrerWxml = read('referrer-workbench/referrer-workbench.wxml');
  const measurerWxml = read('measurer-calendar/measurer-calendar.wxml');
  const referrerStyle = read('referrer-workbench/referrer-workbench.less');
  const measurerStyle = read('measurer-calendar/measurer-calendar.less');

  assert.equal(referrerConfig.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  assert.equal(measurerConfig.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  assert.match(referrerWxml, /<custom-tab-bar\s*\/>/);
  assert.match(measurerWxml, /<custom-tab-bar\s*\/>/);
  assert.match(referrerStyle, /padding:[^;]*156rpx \+ env\(safe-area-inset-bottom\)/);
  assert.match(measurerStyle, /padding:[^;]*156rpx \+ env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(referrerStyle, /--sfp-custom-tabbar-height/);
  assert.doesNotMatch(referrerStyle, /--sfp-tab-icon-size/);
  assert.doesNotMatch(referrerStyle, /--sfp-tab-label-size/);
  assert.doesNotMatch(referrerStyle, /--sfp-tabbar-shadow/);
});

test('phase 14 workbench uses only server-derived role data and the sole formal-survey entry', () => {
  const component = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.js'), 'utf8');
  const componentTemplate = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.wxml'), 'utf8');
  const styles = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.less'), 'utf8');
  const home = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'index', 'index.wxml'), 'utf8');
  const leads = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'leads-management', 'leads-management.wxml'), 'utf8');
  const design = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'ai-design', 'ai-design.wxml'), 'utf8');
  const homeConfig = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'pages', 'index', 'index.json'), 'utf8'));
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'));

  assert.match(component, /['"]\/miniprogram\/workbench['"]/);
  assert.match(component, /openSurveyingEditor\(\{\s*leadId: item\.leadId,\s*floorPlanId: item\.floorPlanId \|\| '',\s*communityName: item\.communityName \|\| '',\s*\}\)/);
  assert.match(component, /startNewSurvey: true/);
  assert.match(component, /openSurvey\(/);
  assert.match(componentTemplate, /catchtap="openSurvey"/);
  assert.match(component, /staff-activity-code\/staff-activity-code/);
  assert.match(component, /enterprise-join-codes\/enterprise-join-codes/);
  assert.match(component, /target === 'join-codes'/);
  assert.match(componentTemplate, /继续量房/);
  assert.match(componentTemplate, /新增量房/);
  assert.doesNotMatch(componentTemplate, /xiao-k-mascot-3d\.png/);
  assert.match(componentTemplate, /\/images\/airy-v1\/thumbs-up-xiao-k\.png/);
  assert.match(componentTemplate, /xiao-k-designer-3d\.png/);
  assert.match(componentTemplate, /xiao-k-measurer-3d\.png/);
  assert.doesNotMatch(home, /xiao-k-mascot-3d\.png/);
  assert.match(home, /\/images\/airy-v1\/thumbs-up-xiao-k\.png/);
  assert.doesNotMatch(componentTemplate, /packages\/business\/assets\/referral-service-v1\/thumbs-up-xiao-k\.png/);
  assert.doesNotMatch(home, /packages\/business\/assets\/referral-service-v1\/thumbs-up-xiao-k\.png/);
  assert.match(componentTemplate, /立即量房/);
  assert.match(componentTemplate, /预约上门/);
  assert.match(componentTemplate, /item\.statusBadge/);
  assert.match(componentTemplate, /item\.canStartNewSurvey/);
  assert.match(componentTemplate, /\/images\/page-ip-v3\/mine\.png/);
  assert.doesNotMatch(component, /enterpriseId\s*[:=]|staffId\s*[:=]/);
  assert.match(home, /<role-workbench[^>]+focus="overview"/);
  assert.equal(homeConfig.usingComponents['role-workbench'], '/components/role-workbench/role-workbench');
  assert.equal(appConfig.usingComponents['role-workbench'], '/components/role-workbench/role-workbench');
  assert.doesNotMatch(leads, /role-workbench/);
  assert.match(leads, /<lead-list/);
  assert.match(design, /role="measurer" focus="survey"/);
  assert.doesNotMatch(design, /enterprise_admin/);
  assert.match(component, /getMenuButtonBoundingClientRect/);
  assert.match(component, /navigationRight/);
  assert.match(componentTemplate, /padding-right: \{\{navigationRight\}\}px/);
  assert.match(styles, /margin:\s*0 -28rpx 20rpx/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /font-size:24rpx/);
  assert.match(componentTemplate, /role === 'enterprise_admin' && focus === 'overview'/);
  assert.match(componentTemplate, /经营大盘/);
  assert.match(componentTemplate, /dashboardPeriod\.subtitle/);
  assert.match(componentTemplate, /需优先处理事项（异常监控）/);
  assert.match(componentTemplate, /出示入驻码|activityCode\.label/);
  assert.match(component, /openQuickNav/);
  assert.match(component, /openEnterpriseException/);
  assert.match(component, /payload\.dashboard/);
  assert.match(component, /openBleConnector/);
  assert.match(component, /showBLEConnector/);
  assert.match(componentTemplate, /链接测距仪/);
  assert.match(componentTemplate, /bleConnected \? '已连接' : '未连接'/);
  assert.match(componentTemplate, /<ble-connector/);
  assert.doesNotMatch(componentTemplate, /进入量房编辑器/);
  assert.doesNotMatch(component, /openSurveyDirect/);
});

test('measurer overview hero links the rangefinder instead of opening the editor', () => {
  const component = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.js'), 'utf8');
  const componentTemplate = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.wxml'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.json'), 'utf8'));

  assert.equal(config.usingComponents['ble-connector'], '/components/ble-connector/ble-connector');
  assert.match(componentTemplate, /bindtap="openBleConnector"/);
  assert.match(component, /onBleSuccess/);
  assert.match(component, /onBleDisconnect/);
  assert.match(component, /syncBleConnectionState/);
  assert.doesNotMatch(componentTemplate, /openSurveyDirect/);
  assert.doesNotMatch(component, /openSurveyingEditor\(\{\s*\}\)/);
});

test('enterprise staffing exceptions open the staff roster instead of a silent no-op', () => {
  const component = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.js'), 'utf8');
  const componentTemplate = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.wxml'), 'utf8');
  const exceptionHandler = component.match(/openEnterpriseException\(event\) \{[\s\S]*?\n    \},/);
  const rosterHandler = component.match(/openStaffRoster\(item\) \{[\s\S]*?\n    \},/);

  assert.match(componentTemplate, /bindtap="openEnterpriseException"/);
  assert.match(componentTemplate, /catchtap="openEnterpriseException"/);
  assert.ok(exceptionHandler, 'openEnterpriseException handler should exist');
  assert.ok(rosterHandler, 'openStaffRoster handler should exist');
  assert.match(exceptionHandler[0], /item\.action === 'staffing'/);
  assert.match(exceptionHandler[0], /this\.openStaffRoster\(item\)/);
  assert.match(exceptionHandler[0], /wx\.showToast/);
  assert.match(rosterHandler[0], /enterprise-staff\/enterprise-staff/);
  assert.match(rosterHandler[0], /focus=designer|staffing-designer/);
  assert.match(component, /target === 'staffing'/);
  assert.match(component, /this\.openStaffRoster\(\)/);
});

test('customer projects route is a deep-link redirect shell, not a TabBar list', () => {
  const projectsRoot = path.join(miniProgramRoot, 'packages', 'business', 'customer-projects');
  const config = JSON.parse(fs.readFileSync(path.join(projectsRoot, 'customer-projects.json'), 'utf8'));
  const template = fs.readFileSync(path.join(projectsRoot, 'customer-projects.wxml'), 'utf8');
  const page = fs.readFileSync(path.join(projectsRoot, 'customer-projects.js'), 'utf8');
  const tabBar = fs.readFileSync(path.join(miniProgramRoot, 'custom-tab-bar', 'index.js'), 'utf8');
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'));
  const business = appConfig.subPackages.find((entry) => entry.root === 'packages/business');

  assert.ok(business.pages.includes('customer-projects/customer-projects'));
  assert.equal(config.navigationStyle, 'custom');
  assert.equal(config.usingComponents, undefined);
  assert.doesNotMatch(template, /<custom-tab-bar\s*\/>/);
  assert.doesNotMatch(template, /project-list|project-card|我的项目/);
  assert.match(page, /rankCustomerProjects/);
  assert.match(page, /['"`]\/miniprogram\/customer-projects['"`]/);
  assert.match(page, /wx\.redirectTo/);
  assert.match(page, /customer-project\/customer-project\?leadId=/);
  assert.match(page, /wx\.switchTab\(\{\s*url:\s*['"]\/pages\/index\/index['"]/);
  assert.match(page, /onLoad\(\)/);
  assert.match(page, /onShow\(\)/);
  assert.doesNotMatch(tabBar, /key: 'projects', capability: 'customer\.projects'/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.js'), 'utf8'),
    /customer-projects\/customer-projects/
  );
});

test('referrer progress and earnings are direct role-tab destinations', () => {
  const tabBar = fs.readFileSync(path.join(miniProgramRoot, 'custom-tab-bar', 'index.js'), 'utf8');
  for (const route of ['referrer-progress/referrer-progress', 'referrer-earnings/referrer-earnings']) {
    const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', route + '.json'), 'utf8'));
    assert.equal(config.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  }
  assert.match(tabBar, /key: 'progress', capability: 'referrer\.progress'/);
  assert.match(tabBar, /key: 'earnings', capability: 'referrer\.earnings'/);
});

test('designer and measurer earnings are direct role-tab destinations', () => {
  const tabBar = fs.readFileSync(path.join(miniProgramRoot, 'custom-tab-bar', 'index.js'), 'utf8');
  const navigation = fs.readFileSync(path.join(miniProgramRoot, 'utils', 'identity-navigation.js'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'staff-earnings', 'staff-earnings.json'), 'utf8'));
  const template = fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'staff-earnings', 'staff-earnings.wxml'), 'utf8');
  const page = fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'staff-earnings', 'staff-earnings.js'), 'utf8');
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'));
  const business = appConfig.subPackages.find((entry) => entry.root === 'packages/business');

  assert.ok(business.pages.includes('staff-earnings/staff-earnings'));
  assert.equal(config.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  assert.match(template, /<custom-tab-bar\s*\/>/);
  assert.match(template, /我的收益/);
  assert.match(page, /['"`]\/miniprogram\/staff-earnings['"`]/);
  assert.match(navigation, /staff-earnings\/staff-earnings': 'staff\.earnings'/);
  assert.match(tabBar, /capability: 'staff\.earnings'[\s\S]*pagePath: '\/packages\/business\/staff-earnings\/staff-earnings'/);
  assert.match(tabBar, /designer: \[[\s\S]*key: 'earnings', capability: 'staff\.earnings'/);
  assert.match(tabBar, /measurer: \[[\s\S]*key: 'earnings', capability: 'staff\.earnings'/);
});

test('enterprise owner commissions are a payout ledger tab with mark-paid', () => {
  const tabBar = fs.readFileSync(path.join(miniProgramRoot, 'custom-tab-bar', 'index.js'), 'utf8');
  const navigation = fs.readFileSync(path.join(miniProgramRoot, 'utils', 'identity-navigation.js'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'enterprise-commissions', 'enterprise-commissions.json'), 'utf8'));
  const template = fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'enterprise-commissions', 'enterprise-commissions.wxml'), 'utf8');
  const page = fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'enterprise-commissions', 'enterprise-commissions.js'), 'utf8');
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'));
  const business = appConfig.subPackages.find((entry) => entry.root === 'packages/business');

  assert.ok(business.pages.includes('enterprise-commissions/enterprise-commissions'));
  assert.equal(config.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  assert.match(template, /<custom-tab-bar\s*\/>/);
  assert.match(template, /提成发放/);
  assert.match(template, /已线下打款/);
  assert.match(template, /待支付/);
  assert.match(template, /已作废/);
  assert.match(page, /['"`]\/miniprogram\/enterprise-commissions['"`]/);
  assert.match(page, /['"`]\/miniprogram\/enterprise-commissions\/mark-paid['"`]/);
  assert.match(page, /确认标记已支付/);
  assert.match(navigation, /enterprise-commissions\/enterprise-commissions': 'enterprise\.commissions'/);
  assert.match(tabBar, /key: 'commissions', capability: 'enterprise\.commissions'/);
  assert.match(tabBar, /text: '提成'/);
  assert.doesNotMatch(page, /commission-records/);
});

test('role shell staff Mine hides legacy workbench sections', () => {
  const mine = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'mine', 'mine.wxml'), 'utf8');
  const mineJs = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'mine', 'mine.js'), 'utf8');

  assert.match(mine, /wx:if="\{\{!isRoleShellMine\}\}" class="stats-scroll"/);
  assert.match(mine, /wx:if="\{\{!isRoleShellMine\}\}" class="surface-section workbench-section"/);
  assert.match(mine, /wx:if="\{\{!isRoleShellMine\}\}" class="surface-section todo-section"/);
  assert.match(mine, /wx:if="\{\{canUseAIDesign && !isRoleShellMine\}\}" class="ai-banner"/);
  assert.match(mineJs, /ROLE_SHELL_MINE_ROLES = \['designer', 'measurer', 'enterprise_admin', 'platform_admin'\]/);
});

test('role-specific workbenches hide customer and non-measurer survey creation controls', () => {
  const mine = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'mine', 'mine.wxml'), 'utf8');
  const leadDetail = fs.readFileSync(path.join(miniProgramRoot, 'packages', 'business', 'lead-detail', 'lead-detail.wxml'), 'utf8');
  const leadList = fs.readFileSync(path.join(miniProgramRoot, 'components', 'lead-list', 'lead-list.wxml'), 'utf8');
  const navigation = fs.readFileSync(path.join(miniProgramRoot, 'utils', 'surveyNavigation.js'), 'utf8');

  assert.match(mine, /wx:if="\{\{!isRoleRestrictedUser\}\}" class="user-summary"/);
  assert.match(mine, /wx:if="\{\{!isRoleRestrictedUser\}\}" class="surface-section floorplan-section"/);
  assert.match(mine, /wx:if="\{\{!isRoleRestrictedUser\}\}" class="user-actions"/);
  assert.match(leadDetail, /wx:if="\{\{canEditMeasurements\}\}" class="whole-home-actions"/);
  assert.match(leadDetail, /wx:if="\{\{canEditMeasurements\}\}" class="measurement-record-actions"/);
  assert.match(leadList, /wx:if="\{\{canAdd\}\}" class="add-lead-button"/);
  assert.match(navigation, /canAccessRoute\('\/packages\/surveying\/editor\/surveying-editor', signedContext\)/);
});
