const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pageRoot = path.join(root, 'packages', 'business', 'acquisition-chat');

test('acquisition-chat is registered as a mini program page', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const business = app.subPackages.find(pkg => pkg.root === 'packages/business');
  assert.ok(business.pages.includes('acquisition-chat/acquisition-chat'));
});

test('acquisition page resolves QR entry code and creates the lead through the existing endpoint', () => {
  const js = fs.readFileSync(path.join(pageRoot, 'acquisition-chat.js'), 'utf8');
  assert.match(js, /options\.entryCode \|\| options\.token \|\| options\.scene/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/referrals\/authorize-and-create-lead/);
  assert.match(js, /Idempotency-Key/);
  assert.match(js, /pendingSource/);
  assert.match(js, /chat\?entryCode=/);
  const wxml = fs.readFileSync(path.join(pageRoot, 'acquisition-chat.wxml'), 'utf8');
  assert.match(wxml, /open-type="getPhoneNumber"/);
});

test('the landing honors anonymous and branded acquisition settings', () => {
  const js = fs.readFileSync(path.join(pageRoot, 'acquisition-chat.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(pageRoot, 'acquisition-chat.wxml'), 'utf8');
  assert.match(js, /acquisition\.brandMode/);
  assert.match(js, /acquisition\.brandName/);
  assert.match(js, /acquisition\.opening/);
  assert.match(wxml, /brandMode === 'branded' && brandName/);
  assert.match(wxml, /本地合作装企/);
  assert.doesNotMatch(wxml, /精艺智家|某某装饰/);
});

test('promoters can switch between the legacy service code and the XiaoK acquisition code', () => {
  const js = fs.readFileSync(path.join(root, 'packages', 'business', 'promotion-service-code', 'promotion-service-code.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'packages', 'business', 'promotion-service-code', 'promotion-service-code.wxml'), 'utf8');
  assert.match(js, /codeMode/);
  assert.match(js, /target=xiaok/);
  assert.match(js, /acquisition-chat\/acquisition-chat\?entryCode=/);
  assert.match(wxml, /小K获客码/);
  assert.match(wxml, /onSwitchMode/);
});

test('configured acquisition prompts become the welcome topics in chat', () => {
  const js = fs.readFileSync(path.join(root, 'packages', 'assistant', 'lib', 'chat.js'), 'utf8');
  assert.match(js, /entry\.acquisition\.prompts/);
  assert.match(js, /acquisitionTopics/);
  assert.match(js, /topics: acquisitionTopics/);
  assert.match(js, /本地服务商/);
});

test('service-code image helper appends cache without breaking an existing query', () => {
  const js = fs.readFileSync(path.join(root, 'utils', 'serviceCodeImage.js'), 'utf8');
  assert.match(js, /endpoint\.includes\('\?'\) \? '&' : '\?'/);
});
