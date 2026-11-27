const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const chatRoot = path.join(root, 'packages', 'assistant', 'chat');

test('the site state reads the real owner-site list and detail, and only binds one readable project', () => {
  const js = fs.readFileSync(path.join(chatRoot, 'chat-definition.js'), 'utf8');
  const helper = fs.readFileSync(path.join(root, 'packages', 'assistant', 'lib', 'owner-site-context.js'), 'utf8');
  assert.match(js, /\/miniprogram\/construction\/owner-sites/);
  assert.match(js, /owner-sites\/\$\{encodeURIComponent\(items\[0\]\.id\)\}/);
  assert.match(js, /items\.length !== 1/);
  assert.match(js, /ownerSiteContext\(home\?\.data\?\.project/);
  assert.match(helper, /project\.progressAccess !== true/);
  assert.match(helper, /siteContext: \{ projectId/);
  assert.match(helper, /siteTopics/);
  assert.match(helper, /siteGreeting/);
});

test('the default 小K welcome page remains unchanged when there is no site context', () => {
  const js = fs.readFileSync(path.join(chatRoot, 'chat-definition.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(chatRoot, 'chat.wxml'), 'utf8');
  assert.match(js, /旧房改造/);
  assert.match(js, /装修风格/);
  assert.match(js, /预算安排/);
  assert.match(wxml, /wx:if="\{\{!resumedQuestion && !siteContext && !reportQuestion\.selected/);
  assert.match(wxml, /小K会客室/);
  assert.match(wxml, /class="notebook-welcome"/);
});

test('the site strip opens the existing 工地 tab without a second navigation model', () => {
  const js = fs.readFileSync(path.join(chatRoot, 'chat-definition.js'), 'utf8');
  assert.match(js, /globalData\.customerTab = 'service'/);
  assert.match(js, /page\.setData\(\{ customerTab: 'service' \}\)/);
  assert.match(js, /tabBar\.syncSelected/);
});

test('the site welcome keeps the notebook language and the three-step topics', () => {
  const helper = fs.readFileSync(path.join(root, 'packages', 'assistant', 'lib', 'owner-site-context.js'), 'utf8');
  const less = fs.readFileSync(path.join(chatRoot, 'notebook.less'), 'utf8');
  const wxml = fs.readFileSync(path.join(chatRoot, 'chat.wxml'), 'utf8');
  assert.match(helper, /今天做了什么/);
  assert.match(helper, /阶段注意什么/);
  assert.match(helper, /下一步安排/);
  assert.match(wxml, /class="notebook-welcome"/);
  assert.match(wxml, /welcome-title/);
  assert.match(wxml, /welcome-subtitle site-project-line/);
  assert.match(wxml, /welcome-subtitle site-subtitle/);
  assert.match(less, /\.site-project-text \{[^}]*white-space: nowrap[^}]*text-overflow: ellipsis/);
  assert.match(less, /\.site-subtitle \{[^}]*white-space: normal/);
  assert.match(wxml, /工地动态/);
  assert.match(wxml, /siteTopics/);
  assert.match(wxml, /bindtap="pickPrompt"/);
});

test('the site report offers 问小K and the shared utility card opens reminders', () => {
  const wxml = fs.readFileSync(path.join(root, 'packages', 'construction', 'owner-home', 'owner-home.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'packages', 'construction', 'owner-home', 'owner-home.js'), 'utf8');
  assert.match(wxml, /bindtap="toggleSiteMore"/);
  assert.match(wxml, /bindtap="askXiaok"/);
  assert.match(wxml, /bindtap="openReport"/);
  assert.match(wxml, /class="site-paper site-utility"/);
  assert.match(wxml, /bindtap="toggleSiteReminders"/);
  assert.match(wxml, /bindtap="openSiteReminder"/);
  assert.match(js, /ask: '1', prompt: '今天工地做了什么？'/);
  assert.match(js, /ownerReminders\.list\(projectId\)/);
  assert.match(js, /ownerReminders\.read\(item\)/);
});

test('the 问小K entry reuses the owner report context and asks once', () => {
  const chat = fs.readFileSync(path.join(chatRoot, 'chat-definition.js'), 'utf8');
  assert.match(chat, /this\._options\.ask === '1' && this\._options\.prompt/);
  assert.match(chat, /this\._ownerReportAsked = true/);
  assert.match(chat, /async askOwnerReport\(prompt\)/);
  assert.match(chat, /let text = prompt;/);
  assert.match(chat, /text = decodeURIComponent\(prompt\)/);
  assert.match(chat, /entry\.input\(text\);/);
  assert.match(chat, /const selected = await this\.askFollowupReport\(\{ currentTarget: \{ dataset: \{\} \} \}\)/);
  assert.match(chat, /if \(selected\) await this\.sendFollowup\(\)/);
});
