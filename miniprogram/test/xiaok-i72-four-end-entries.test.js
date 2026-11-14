const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('owner C01 shows stage reminders and opens the saved weekly report', () => {
  const chat = read('packages/assistant/chat/chat.wxml');
  const definition = read('packages/assistant/chat/chat-definition.js');
  assert.match(chat, /owner-stage-brief/u);
  assert.match(chat, /bindtap="refreshOwnerReminders"/u);
  assert.match(chat, /data-id="\{\{ownerWeeklyBindingId\}\}" bindtap="selectFollowup"/u);
  assert.match(definition, /loadOwnerStageReminders/u);
  assert.match(definition, /'\/miniprogram\/xiaok\/reminders'/u);
  assert.match(definition, /syncOwnerWeeklyEntry/u);
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

test('construction staff keeps photo, voice and current tasks plus a weekly report entry', () => {
  const projects = read('packages/construction/projects/projects.wxml');
  const script = read('packages/construction/projects/projects.js');
  assert.match(projects, /bindtap="openWeeklyReport"/u);
  assert.match(projects, /bindtap="openSiteCamera"/u);
  assert.match(projects, /bindtap="openSiteChat"/u);
  assert.match(script, /'\/packages\/assistant\/chat\/chat\?followup=1'/u);
});
