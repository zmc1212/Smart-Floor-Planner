const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('员工个人资料页支持职业背书维护、企业控制提示和客户效果预览', () => {
  const pageRoot = path.join(root, 'packages', 'business', 'profile-edit');
  const js = fs.readFileSync(path.join(pageRoot, 'profile-edit.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(pageRoot, 'profile-edit.wxml'), 'utf8');

  assert.match(js, /\/miniprogram\/staff\/professional-profile/);
  assert.match(js, /professionalProfileLocked/);
  assert.match(js, /professionalVisibilityControlled/);
  assert.match(js, /canShowActualServiceCount/);
  assert.match(wxml, /当前由企业统一控制显示或隐藏/);
  assert.match(wxml, /从业起始年份/);
  assert.match(wxml, /显示专业头衔/);
  assert.match(wxml, /展示真实服务人数/);
  assert.match(wxml, /客户侧预览/);
  assert.match(wxml, /仅你和企业管理员可见/);
});

test('客户服务档案同时展示设计师和测量员最终背书', () => {
  const pageRoot = path.join(root, 'packages', 'business', 'customer-project');
  const js = fs.readFileSync(path.join(pageRoot, 'customer-project.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(pageRoot, 'customer-project.wxml'), 'utf8');

  assert.match(js, /designerProfessionalProfile/);
  assert.match(js, /measurerProfessionalProfile/);
  assert.match(wxml, /designerProfessionalProfile\.experienceLabel/);
  assert.match(wxml, /designerProfessionalProfile\.serviceLabel/);
  assert.match(wxml, /measurerProfessionalProfile\.experienceLabel/);
  assert.match(wxml, /measurerProfessionalProfile\.serviceLabel/);
  assert.doesNotMatch(wxml, /measurer[\s\S]{0,80}二维码/);
});
