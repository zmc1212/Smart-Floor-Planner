const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const pageRoot = path.join(root, 'packages', 'business', 'lead-detail');
const script = fs.readFileSync(path.join(pageRoot, 'lead-detail.js'), 'utf8');
const template = fs.readFileSync(path.join(pageRoot, 'lead-detail.wxml'), 'utf8');

test('lead detail shows protected floor-plan preview and house facts after survey completion', () => {
  assert.match(template, /class="whole-home-house-facts"/);
  assert.match(template, /class="floor-preview-container"/);
  assert.match(template, /class="floor-preview-image"/);
  assert.match(template, /查看大图/);
  assert.match(template, /bindtap="onPreviewFloorPlan"/);
  assert.match(script, /function buildHouseFacts\(/);
  assert.match(script, /POST_SURVEY_SERVICE_STAGES/);
  assert.match(script, /function canViewFloorPlanPreview\(/);
  assert.match(script, /staffRole === 'enterprise_admin'/);
  assert.match(script, /fetchProtectedImage/);
  assert.match(script, /resolveProtectedPreviewEndpoint/);
  assert.match(script, /wx\.previewImage/);
  assert.doesNotMatch(script, /onPreviewFloorPlan[\s\S]*surveying-editor/);
});

test('enterprise admin manual assign opens roster sheet and posts assign-staff', () => {
  assert.match(template, /staff-assign-sheet/);
  assert.match(template, /catchtap="onConfirmStaffAssign"/);
  assert.match(template, /点击分配/);
  assert.match(script, /openStaffAssignSheet/);
  assert.match(script, /\/miniprogram\/enterprise-staff\?role=/);
  assert.match(script, /assignmentEligible/);
  assert.match(script, /\/leads\/\$\{this\.data\.leadId\}\/assign-staff/);
  assert.match(script, /designerId: staffId/);
  assert.match(script, /measurerId: staffId/);
  assert.match(script, /canAssignStaff && !lead\.assignedTo/);
  assert.match(script, /canAssignStaff && !lead\.measurerId/);
});
