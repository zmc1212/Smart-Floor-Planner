const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('lead detail exposes profile edit entry for authorized staff', () => {
  const template = fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-detail', 'lead-detail.wxml'),
    'utf8'
  );
  const script = fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.match(template, /canEditProfile.*补充资料/s);
  assert.match(script, /canEditLeadProfile/);
  assert.match(script, /lead-form\/lead-form\?mode=edit&leadId=/);
});

test('lead form uses default WeChat navigation and map-plus-input community', () => {
  const template = fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-form', 'lead-form.wxml'),
    'utf8'
  );
  const script = fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-form', 'lead-form.js'),
    'utf8'
  );
  const config = JSON.parse(fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-form', 'lead-form.json'),
    'utf8'
  ));
  const styles = fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-form', 'lead-form.less'),
    'utf8'
  );

  assert.equal(config.navigationStyle, undefined);
  assert.equal(config.navigationBarTitleText, '客户资料');
  assert.doesNotMatch(template, /custom-header|back-btn|‹/);
  assert.match(template, /bindinput="onInput"/);
  assert.match(template, /catchtap="chooseCommunityLocation"/);
  assert.match(template, /选择地点/);
  assert.match(script, /wx\.setNavigationBarTitle/);
  assert.match(script, /wx\.chooseLocation/);
  assert.match(script, /formData\.communityName.*slice\(0, 160\)/);
  assert.match(styles, /\.location-action/);
  assert.match(styles, /font-size: 24rpx/);
});

test('lead form map pick writes the POI name into the editable community field', () => {
  const pagePath = require.resolve('../packages/business/lead-form/lead-form.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;

  const originalWx = global.wx;
  global.wx = {
    chooseLocation({ success }) {
      success({ name: '阳光花园', address: '广东省广州市天河区阳光路 1 号', latitude: 23.1291, longitude: 113.2644 });
    },
    showToast() {},
  };
  const context = {
    data: { formData: { communityName: '' } },
    setData(next) {
      const key = Object.keys(next)[0];
      const parts = key.split('.');
      let cursor = this.data;
      for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]];
      cursor[parts[parts.length - 1]] = next[key];
    },
  };
  try {
    definition.chooseCommunityLocation.call(context);
    assert.equal(context.data.formData.communityName, '阳光花园');
  } finally {
    global.wx = originalWx;
  }
});

test('lead form supports edit mode and saves through PUT', () => {
  const template = fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-form', 'lead-form.wxml'),
    'utf8'
  );
  const script = fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-form', 'lead-form.js'),
    'utf8'
  );
  assert.match(template, /isEditMode/);
  assert.match(template, /\{\{submitLabel\}\}/);
  assert.match(script, /loadLeadForEdit/);
  assert.match(script, /api\.request\(`\/leads\/\$\{encodeURIComponent\(leadId\)\}`, 'PUT', payload\)/);
});

test('lead form edit route is available to designers, measurers, and enterprise admins', () => {
  const navigation = require('../utils/identity-navigation.js');
  assert.equal(
    navigation.canAccessRoute('/packages/business/lead-form/lead-form', { mode: 'staff', staffRole: 'designer' }),
    true
  );
  assert.equal(
    navigation.canAccessRoute('/packages/business/lead-form/lead-form', { mode: 'staff', staffRole: 'measurer' }),
    true
  );
  assert.equal(
    navigation.canAccessRoute('/packages/business/lead-form/lead-form', { mode: 'staff', staffRole: 'enterprise_admin' }),
    true
  );
});

test('lead detail profile edit allows assigned measurer', () => {
  const script = fs.readFileSync(
    path.join(root, 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.match(script, /staffRole === 'measurer'/);
  assert.match(script, /lead\.measurerId/);
});
