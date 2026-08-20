const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('customer service home shows one featured stage and a single next action', () => {
  const workbench = source('components/role-workbench/role-workbench.js');
  const template = source('components/role-workbench/role-workbench.wxml');
  assert.match(workbench, /featured\.nextActionKind/);
  assert.match(workbench, /nextActionKind === 'book'/);
  assert.match(workbench, /nextActionKind === 'reschedule'/);
  assert.match(workbench, /nextActionKind === 'rebook'/);
  assert.match(workbench, /appointment-reschedule\/appointment-reschedule/);
  assert.match(workbench, /还没有进行中的服务/);
  assert.match(template, /item\.canReschedule/);
  assert.match(template, /item\.actionLabel/);
  assert.doesNotMatch(workbench, /title: '免费设计与量房'/);
});

test('enterprise appointments tab leaves the AI design shell', () => {
  const tabBar = source('custom-tab-bar/index.js');
  const design = source('pages/ai-design/ai-design.js');
  assert.doesNotMatch(source('pages/ai-design/ai-design.wxml'), /enterprise_admin/);
  const appConfig = JSON.parse(source('app.json'));
  const business = appConfig.subPackages.find((item) => item.root === 'packages/business');
  const pageConfig = JSON.parse(source('packages/business/enterprise-appointments/enterprise-appointments.json'));
  const pageTemplate = source('packages/business/enterprise-appointments/enterprise-appointments.wxml');
  const navigation = source('utils/identity-navigation.js');

  assert.match(tabBar, /key: 'appointments'[\s\S]*pagePath: '\/packages\/business\/enterprise-appointments\/enterprise-appointments'/);
  assert.match(design, /role === 'measurer'/);
  assert.doesNotMatch(design, /enterprise_admin/);
  assert.ok(business.pages.includes('enterprise-appointments/enterprise-appointments'));
  assert.equal(pageConfig.usingComponents['role-workbench'], '/components/role-workbench/role-workbench');
  assert.equal(pageConfig.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  assert.match(pageTemplate, /role="enterprise_admin" focus="appointments"/);
  assert.match(pageTemplate, /<custom-tab-bar\s*\/>/);
  assert.match(navigation, /enterprise-appointments\/enterprise-appointments': 'enterprise\.appointments'/);
  assert.match(navigation, /'\/pages\/ai-design\/ai-design': \['staff\.design', 'staff\.surveying'\]/);
});

test('measurer workbench keeps the calendar itinerary separate from confirmed appointments', () => {
  const tabBar = source('custom-tab-bar/index.js');
  const calendar = source('packages/business/measurer-calendar/measurer-calendar.js');
  const calendarTemplate = source('packages/business/measurer-calendar/measurer-calendar.wxml');
  assert.match(tabBar, /key: 'workbench'[\s\S]*pagePath: '\/pages\/index\/index'/);
  assert.match(calendar, /confirmed: items\.filter\(\(item\) => item\.status === 'confirmed'\)/);
  assert.match(calendar, /history: items\.filter\(\(item\) => item\.status !== 'confirmed'\)/);
  assert.match(calendarTemplate, /待处理 \/ 历史/);
  assert.match(calendar, /measurer-unavailability\/measurer-unavailability/);
  assert.match(calendarTemplate, /bindtap="manageUnavailability"/);
});

test('designer profile edit loads and saves wechat id plus qr without requiring measurer qr', () => {
  const page = source('packages/business/profile-edit/profile-edit.js');
  const template = source('packages/business/profile-edit/profile-edit.wxml');
  const api = source('utils/api.js');
  assert.match(page, /\/miniprogram\/staff\/wechat-profile/);
  assert.match(page, /uploadStaffWechatQr/);
  assert.match(template, /wx:if="\{\{isDesigner\}\}"/);
  assert.match(template, /wechatId/);
  assert.match(template, /wechatQrUrl/);
  assert.doesNotMatch(template, /测量员.*二维码/);
  assert.match(api, /function uploadStaffWechatQr/);
  assert.match(api, /\/miniprogram\/staff\/wechat-qr/);
});
