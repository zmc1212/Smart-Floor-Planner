const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('owner C01 mounts one dismissible prompt and opens reports from the existing followup entry', () => {
  const chat = read('packages/assistant/chat/chat.wxml');
  const definition = read('packages/assistant/chat/chat-definition.js');
  assert.match(chat, /class="owner-reminder-prompt"/u);
  assert.match(chat, /bindtap="dismissOwnerReminder"/u);
  assert.match(chat, /bindtap="openOwnerReminder"/u);
  assert.match(chat, /data-id="\{\{item.bindingId\}\}" bindtap="selectFollowup"/u);
  assert.doesNotMatch(chat, /owner-stage-brief|ownerWeeklyBindingId/u);
  assert.match(definition, /startOwnerReminderRefresh/u);
  assert.match(read('packages/construction/owner-home/owner-home.wxml'), /当前提醒/u);
});

test('designer and boss workbench shows role reminders and a report entry', () => {
  const workbench = read('components/role-workbench/role-workbench.wxml');
  const script = read('components/role-workbench/role-workbench.js');
  const home = read('pages/index/index.wxml');
  assert.match(workbench, /xiaok-reminder-card/u);
  assert.match(workbench, /bindtap="openXiaokFollowup"/u);
  assert.match(script, /loadXiaokReminders/u);
  assert.match(script, /'\/packages\/assistant\/chat\/chat\?followup=1'/u);
  assert.match(home, /<role-workbench id="role-workbench"[^>]*focus="overview"/u);
});

test('boss and designer reach the shared project facts without going through Mine', () => {
  const workbench = read('components/role-workbench/role-workbench.wxml');
  const script = read('components/role-workbench/role-workbench.js');
  const brief = read('packages/construction/brief/brief.wxml');
  assert.match(workbench, /bindtap="openConstruction"/u);
  assert.match(workbench, /项目简报与问题清单/u);
  assert.match(workbench, /工地协作与需求核对/u);
  assert.match(script, /'\/packages\/construction\/brief\/brief'/u);
  assert.match(script, /'\/packages\/construction\/projects\/projects'/u);
  assert.match(brief, /需介入 · \{\{project\.pendingCount\}\} 项/u);
  assert.match(brief, /已修正 · \{\{project\.fixedCount\}\} 项/u);
  assert.match(brief, /catchtap="openProjectIssues"/u);
  assert.match(brief, /bindtap="openProjects"/u);
});

test('construction staff keeps photo, voice and current tasks plus a weekly report entry', () => {
  const projects = read('packages/construction/projects/projects.wxml');
  const script = read('packages/construction/projects/projects.js');
  assert.match(projects, /bindtap="openWeeklyReport"/u);
  assert.match(projects, /bindtap="openSiteCamera"/u);
  assert.match(projects, /bindtap="openSiteChat"/u);
  assert.match(script, /'\/packages\/assistant\/chat\/chat\?followup=1'/u);
});

test('designer has a room point entry and a design difference focus on the shared project facts', () => {
  const projects = read('packages/construction/projects/projects.wxml');
  const script = read('packages/construction/projects/projects.js');
  const model = read('packages/construction/projects/projects-model.js');
  assert.match(projects, /detail\.myRole === 'designer'/u);
  assert.match(projects, /点位图与差异/u);
  assert.match(projects, /bindtap="openRoomPlan"/u);
  assert.match(projects, /detail\.designerFocusIssue/u);
  assert.match(script, /openRoomPlan\(e\)/u);
  assert.match(script, /mode=plan&roomId=/u);
  assert.match(model, /designerFocusIssue/u);
});
