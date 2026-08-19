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
  const referrerStyle = read('referrer-workbench/referrer-workbench.wxss');
  const measurerStyle = read('measurer-calendar/measurer-calendar.wxss');

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
  const styles = fs.readFileSync(path.join(miniProgramRoot, 'components', 'role-workbench', 'role-workbench.wxss'), 'utf8');
  const home = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'index', 'index.wxml'), 'utf8');
  const leads = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'leads-management', 'leads-management.wxml'), 'utf8');
  const design = fs.readFileSync(path.join(miniProgramRoot, 'pages', 'ai-design', 'ai-design.wxml'), 'utf8');

  assert.match(component, /['"]\/miniprogram\/workbench['"]/);
  assert.match(component, /openSurveyingEditor\(\{ leadId: item\.leadId, floorPlanId: item\.floorPlanId \|\| '' \}\)/);
  assert.match(componentTemplate, /\/images\/page-ip-v3\/mine\.png/);
  assert.doesNotMatch(component, /enterpriseId\s*[:=]|staffId\s*[:=]/);
  assert.match(home, /<role-workbench[^>]+focus="overview"/);
  assert.match(leads, /<role-workbench[^>]+role="measurer"[^>]+focus="tasks"/);
  assert.match(design, /role="measurer" focus="survey"/);
  assert.match(design, /role="enterprise_admin" focus="appointments"/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /font-size:24rpx/);
});
