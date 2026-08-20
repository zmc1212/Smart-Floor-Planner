const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.less'),
  'utf8'
);
const template = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.wxml'),
  'utf8'
);

test('formal-surveying tab has a defined surface and does not cover the lead-detail heading', () => {
  assert.match(
    styles,
    /\.whole-home-tab\s*\{[^}]*background:\s*var\(--brand-primary\);/s
  );
  assert.match(
    styles,
    /\.whole-home-card\s*\{[^}]*padding:\s*76rpx 24rpx 24rpx;/s
  );
  assert.doesNotMatch(template, /class="whole-home-title"/);
  assert.match(template, /class="whole-home-next-copy">\{\{nextAction\}\}<\/text>/);
  assert.match(template, /从墙图开始建立客户户型/);
  assert.doesNotMatch(template, /whole-home-plan-name/);
  assert.doesNotMatch(template, /class="lead-next-action"/);
});

test('lead-detail scene is anchored to its hero instead of covering measurement history', () => {
  assert.match(
    styles,
    /\.detail-hero\s*\{[^}]*position:\s*relative;/s
  );
  assert.match(
    styles,
    /\.lead-detail-scene\s*\{[^}]*position:\s*absolute;[^}]*right:\s*-4rpx;[^}]*bottom:\s*-6rpx;/s
  );
});

test('each historical measurement record opens its own plan while delete remains isolated', () => {
  assert.match(
    template,
    /class="measurement-record[\s\S]*?data-id="\{\{item\._id\}\}"[\s\S]*?bindtap="onHistoryRecordTap"/
  );
  assert.match(template, /class="measurement-record-continue"[^>]*catchtap="onContinueMeasure"/);
  assert.match(template, /class="measurement-record-delete"[^>]*catchtap="onDeleteMeasure"/);
});

test('history records favor the shared project display name over legacy date titles', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.match(script, /projectTitle \|\| plan\.name \|\| '历史正式量房'/);
  assert.match(script, /projectSubtitle,/);
});

test('lead detail removes the legacy acquisition collaboration surface', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.doesNotMatch(template, /acquisition-info|联系设计师|查看协作记录|designer-contact-sheet|确认已获客/);
  assert.doesNotMatch(script, /onAcquireLead|canAcquireLead|onOpenAcquisition|onOpenDesignerContact/);
  assert.match(script, /const WORKFLOW_STAGES = \['新线索', '量房中', '方案设计', '已签约'\]/);
});

test('formal-survey keeps next-action right of the tab, address on its own row, and full-width appointment CTA', () => {
  assert.doesNotMatch(template, /class="appointment-entry"/);
  assert.doesNotMatch(template, /class="whole-home-main"/);
  assert.match(template, /class="whole-home-head"/);
  assert.match(template, /class="whole-home-address"/);
  assert.match(template, /class="whole-home-appointment-action"/);
  assert.match(template, /安排上门量房/);
  assert.match(template, /查看预约/);
  assert.match(styles, /\.whole-home-head\s*\{[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /\.whole-home-appointment-action\s*\{[^}]*width:\s*100%;/s);
  assert.match(styles, /\.whole-home-appointment-action\s*\{[^}]*height:\s*84rpx;/s);
  assert.match(styles, /\.conversion-primary-action\s*\{[^}]*height:\s*84rpx;/s);
  const surveyIndex = template.indexOf('class="whole-home-card"');
  const schemesIndex = template.indexOf('class="published-schemes-card"');
  const historyIndex = template.indexOf('class="measurement-history"');
  const conversionIndex = template.indexOf('class="conversion-card"');
  assert.ok(surveyIndex > -1);
  assert.ok(schemesIndex > surveyIndex);
  assert.ok(historyIndex > schemesIndex);
  assert.ok(conversionIndex > historyIndex);
});

test('formal-survey address row stays full-width below the next-action head', () => {
  assert.match(styles, /\.whole-home-address\s*\{[^}]*display:\s*block;/s);
  assert.doesNotMatch(styles, /\.appointment-entry\s*\{/);
});
