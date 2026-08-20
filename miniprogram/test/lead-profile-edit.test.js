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
