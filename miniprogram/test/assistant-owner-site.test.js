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
  assert.match(wxml, /wx:if="\{\{!siteContext && !reportQuestion\.selected/);
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
  assert.match(wxml, /welcome-subtitle site-subtitle/);
  assert.match(less, /\.site-subtitle \{[^}]*white-space: normal/);
  assert.match(wxml, /工地动态/);
  assert.match(wxml, /siteTopics/);
  assert.match(wxml, /bindtap="pickPrompt"/);
});
