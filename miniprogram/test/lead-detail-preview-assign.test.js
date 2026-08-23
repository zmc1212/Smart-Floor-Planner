const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const pageRoot = path.join(root, 'packages', 'business', 'lead-detail');
const script = fs.readFileSync(path.join(pageRoot, 'lead-detail.js'), 'utf8');
const template = fs.readFileSync(path.join(pageRoot, 'lead-detail.wxml'), 'utf8');
const styles = fs.readFileSync(path.join(pageRoot, 'lead-detail.less'), 'utf8');

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

test('staff assign reloads GET lead detail so measurer cards keep staff summaries', () => {
  assert.match(script, /async fetchLeadDetail\(options = \{\}\)/);
  assert.match(script, /const silent = Boolean\(options\.silent\)/);
  assert.match(script, /await this\.fetchLeadDetail\(\{\s*silent:\s*true\s*\}\)/);
  assert.doesNotMatch(
    script,
    /assign-staff[\s\S]{0,400}this\.applyLeadDetail\(res\.data\)/
  );
});

test('staff cards put 分配/更换 on the right and post assign-staff from lead-scoped roster', () => {
  assert.match(template, /staff-assign-sheet/);
  assert.match(template, /catchtap="onConfirmStaffAssign"/);
  assert.match(template, /catchtap="onOpenStaffAssign"/);
  assert.match(template, /catchtap="onCallStaff"/);
  assert.match(template, /\{\{designerContact\.assignLabel\}\}/);
  assert.match(template, /\{\{measurerContact\.assignLabel\}\}/);
  assert.match(template, /选择后将替换当前人员|staffAssignHint/);
  assert.doesNotMatch(template, /点击分配/);
  assert.doesNotMatch(template, /bindtap="onStaffCardTap"/);
  assert.match(script, /openStaffAssignSheet/);
  assert.match(script, /\/leads\/\$\{this\.data\.leadId\}\/assignable-staff\?role=/);
  assert.doesNotMatch(script, /\/miniprogram\/enterprise-staff\?role=/);
  assert.match(script, /\/leads\/\$\{this\.data\.leadId\}\/assign-staff/);
  assert.match(script, /designerId: staffId/);
  assert.match(script, /measurerId: staffId/);
  assert.match(script, /assignmentActions/);
  assert.match(script, /canAssignDesigner/);
  assert.match(script, /canAssignMeasurer/);
  assert.match(styles, /\.staff-assignment-action\s*\{[^}]*font-size:\s*24rpx;/s);
});
