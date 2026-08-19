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
  assert.match(component, /openSurveyingEditor\(\{ leadId: item\.leadId, floorPlanId: item\.floorPlanId \|\| '' \}\)/);
  assert.match(component, /staff-activity-code\/staff-activity-code/);
  assert.match(componentTemplate, /立即量房/);
  assert.match(componentTemplate, /预约上门/);
  assert.match(componentTemplate, /\/images\/page-ip-v3\/mine\.png/);
  assert.doesNotMatch(component, /enterpriseId\s*[:=]|staffId\s*[:=]/);
  assert.match(home, /<role-workbench[^>]+focus="overview"/);
  assert.equal(homeConfig.usingComponents['role-workbench'], '/components/role-workbench/role-workbench');
  assert.equal(appConfig.usingComponents['role-workbench'], '/components/role-workbench/role-workbench');
  assert.match(leads, /<role-workbench[^>]+role="measurer"[^>]+focus="tasks"/);
  assert.match(design, /role="measurer" focus="survey"/);
  assert.doesNotMatch(design, /enterprise_admin/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /font-size:24rpx/);
});

test('customer projects tab route mounts the shared TabBar and reserves its safe area', () => {
  const projectsRoot = path.join(miniProgramRoot, 'packages', 'business', 'customer-projects');
  const config = JSON.parse(fs.readFileSync(path.join(projectsRoot, 'customer-projects.json'), 'utf8'));
  const template = fs.readFileSync(path.join(projectsRoot, 'customer-projects.wxml'), 'utf8');
  const stylePath = fs.existsSync(path.join(projectsRoot, 'customer-projects.less'))
    ? path.join(projectsRoot, 'customer-projects.less')
    : path.join(projectsRoot, 'customer-projects.less');
  const styles = fs.readFileSync(stylePath, 'utf8');

  assert.equal(config.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  assert.match(template, /<custom-tab-bar\s*\/>/);
  assert.match(styles, /padding-bottom:\s*calc\(156rpx \+ env\(safe-area-inset-bottom\)\)/);
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
