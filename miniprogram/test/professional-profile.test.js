const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('员工个人资料页支持职业背书维护、企业控制提示和客户效果预览', () => {
  const pageRoot = path.join(root, 'packages', 'business', 'profile-edit');
  const js = fs.readFileSync(path.join(pageRoot, 'profile-edit.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(pageRoot, 'profile-edit.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(pageRoot, 'profile-edit.less'), 'utf8');

  assert.match(js, /\/miniprogram\/staff\/professional-profile/);
  assert.match(js, /professionalProfileLocked/);
  assert.match(js, /professionalVisibilityControlled/);
  assert.match(js, /canShowActualServiceCount/);
  assert.match(wxml, /当前由企业统一控制显示或隐藏/);
  assert.match(wxml, /从业起始年份/);
  assert.match(
    wxml,
    /professional-year-group[\s\S]*professional-field-main[\s\S]*从业起始年份[\s\S]*field-input[\s\S]*field-helper/
  );
  assert.match(wxml, /显示专业头衔/);
  assert.match(wxml, /展示真实服务人数/);
  assert.match(wxml, /客户侧预览/);
  assert.match(wxml, /仅你和企业管理员可见/);
  assert.match(less, /\.professional-profile-surface\s+\.field-group\s*\{[^}]*padding:\s*0;/s);
  assert.match(less, /\.professional-year-group\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(less, /\.professional-profile-surface\s+\.field-label\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(less, /\.field-helper\s*\{[^}]*width:\s*100%;/s);
  assert.match(less, /\.field-helper\s*\{[^}]*text-align:\s*left;/s);
});

test('客户服务档案同时展示设计师和测量员最终背书', () => {
  const pageRoot = path.join(root, 'packages', 'business', 'customer-project');
  const js = fs.readFileSync(path.join(pageRoot, 'customer-project.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(pageRoot, 'customer-project.wxml'), 'utf8');

  assert.doesNotMatch(js, /designerProfessionalProfile|measurerProfessionalProfile/);
  assert.match(wxml, /金牌设计师/);
  assert.match(wxml, /7年设计经验/);
  assert.match(wxml, /资深测量师/);
  assert.match(wxml, /7年量房经验/);
  assert.equal((wxml.match(/已免费服务客户100\+/g) || []).length, 2);
  assert.doesNotMatch(wxml, /measurer[\s\S]{0,80}二维码/);
});
