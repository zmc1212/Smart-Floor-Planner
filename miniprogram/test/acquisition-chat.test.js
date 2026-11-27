const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pageRoot = path.join(root, 'packages', 'business', 'acquisition-chat');
const { promotionMethods } = require('../packages/assistant/chat/promotion-entry');
const api = require('../utils/api');
const token = 'rp_' + 'a'.repeat(32);

function chatFixture(t, current, request) {
  const original = global.getApp;
  global.getApp = () => ({ globalData: current });
  t.after(() => { global.getApp = original; });
  t.mock.method(api, 'request', request);
  const controller = {
    clears: 0,
    clear() { this.clears += 1; },
    async switchEntry(options, settings) { this.switched = { options, settings }; return true; },
  };
  return {
    ...promotionMethods, _alive: true, _shown: true, opens: 0,
    data: {}, controller,
    setData(value) { Object.assign(this.data, value); },
    showConsultation() { this.opens++; },
  };
}

test('acquisition-chat is registered as a mini program page', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const business = app.subPackages.find(pkg => pkg.root === 'packages/business');
  assert.ok(business.pages.includes('acquisition-chat/acquisition-chat'));
});

test('acquisition QR compatibility route forwards to XiaoK and authorization belongs to the chat', async (t) => {
  const js = fs.readFileSync(path.join(pageRoot, 'acquisition-chat.js'), 'utf8');
  assert.match(js, /options\.entryCode \|\| options\.token \|\| options\.scene/);
  const wxml = fs.readFileSync(path.join(root, 'packages/assistant/chat/promotion-entry.wxml'), 'utf8');
  assert.match(wxml, /open-type="getPhoneNumber"/);
  const previous = { wx: global.wx, Page: global.Page, getApp: global.getApp };
  t.after(() => Object.assign(global, previous));
  let opened, page;
  global.wx = { reLaunch: options => { opened = options.url; } };
  global.getApp = () => ({ globalData: { aiEntriesEnabled: true } });
  global.Page = definition => { page = { ...definition, setData() {} }; };
  require('../packages/business/acquisition-chat/acquisition-chat');
  await page.onLoad({ scene: token.slice(3) });
  assert.equal(opened, '/pages/index/index?promotionCode=' + token.slice(3));
});

test('the XiaoK scanner accepts both code routes and leaves invitations alone', () => {
  const { resolveServiceEntryUrl } = require('../utils/service-entry');
  const base = '/packages/business/acquisition-chat/acquisition-chat';
  assert.equal(resolveServiceEntryUrl({ path: 'packages/business/free-design-service/free-design-service?scene=' + token }, { assistant: true }),
    base + '?entryCode=' + token);
  assert.equal(resolveServiceEntryUrl({ path: base + '.html?scene=' + token.slice(3) }, { assistant: true }),
    base + '?entryCode=' + token.slice(3));
  assert.equal(resolveServiceEntryUrl({ path: 'packages/business/onboarding/onboarding?scene=' + token }, { assistant: true }), '');
});

test('an identified returning customer resumes their original conversation scope without a claim', async (t) => {
  const page = chatFixture(t, { token: 'signed' }, async url => {
    assert.equal(url, '/miniprogram/codes/resolve');
    return { data: { kind: 'referral', existingAttribution: true, lead: { id: '42' } } };
  });
  await page.beginPromotion(token);
  assert.deepEqual(page._options, {});
  assert.equal(page.data.promotionResumedLeadId, '42');
  assert.equal(page.data.promotionEntry, null);
  assert.equal(page.opens, 1);
});

test('public designer continuation keeps the public conversation and hands an editable draft to the enterprise entry', async (t) => {
  const page = chatFixture(t, { token: 'signed' }, async url => {
    assert.equal(url, '/miniprogram/codes/resolve');
    return { data: { kind: 'referral', existingAttribution: true, lead: { id: '42' } } };
  });
  page.data.serviceContinuation = { type: 'designer', questionMessageId: '21', question: '我想找设计师' };
  await page.beginPromotion(token, { preservePublicHistory: true });
  assert.equal(page.controller.clears, 0);
  assert.deepEqual(page.controller.switched, {
    options: {}, settings: { preservePublicHistory: true, draft: '我想找设计师' },
  });
  assert.equal(page.data.serviceContinuation, null);
  assert.equal(page.data.serviceLinkBusy, false);
});

test('a failed enterprise reload keeps the public designer draft for retry', async (t) => {
  const page = chatFixture(t, { token: 'signed' }, async url => {
    assert.equal(url, '/miniprogram/codes/resolve');
    return { data: { kind: 'referral', existingAttribution: true, lead: { id: '42' } } };
  });
  page.controller.switchEntry = async () => false;
  page.data.serviceContinuation = { type: 'designer', questionMessageId: '21', question: '我想找设计师' };
  await page.beginPromotion(token, { preservePublicHistory: true });
  assert.equal(page.data.serviceLinkBusy, false);
  assert.deepEqual(page.data.serviceContinuation, { type: 'designer', questionMessageId: '21', question: '我想找设计师' });
});

test('an authenticated unbound customer explicitly confirms once with the original pending source', async (t) => {
  const calls = [];
  const page = chatFixture(t, { token: 'signed', userInfo: { mode: 'customer', phone: '13000000000' } }, async (url, method, body, options) => {
    calls.push({ url, body, options });
    if (url.endsWith('/resolve')) return { data: { kind: 'referral', pendingSource: 'pending', acquisition: { brandMode: 'anonymous', brandName: 'hidden' } } };
    return { data: { lead: { id: '42' } } };
  });
  await page.beginPromotion(token);
  assert.deepEqual(page.data.promotionEntry, { phase: 'confirm', brandName: '', brandLogo: '' });
  assert.equal(calls.length, 1);
  await Promise.all([page.confirmPromotionEntry(), page.confirmPromotionEntry()]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, '/miniprogram/referrals/authorize-and-create-lead');
  assert.equal(calls[1].body.pendingSource, 'pending');
  assert.equal(calls[1].options.headers['Idempotency-Key'], calls[0].body.sessionKey);
  assert.deepEqual(page._options, { entryCode: token });
  assert.equal(page.opens, 1);
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
  assert.match(js, /const topics = publicTopics\.length \? publicTopics : acquisitionTopics\.length \? acquisitionTopics/);
  assert.match(js, /本地服务商/);
});

test('service-code image helper appends cache without breaking an existing query', () => {
  const js = fs.readFileSync(path.join(root, 'utils', 'serviceCodeImage.js'), 'utf8');
  assert.match(js, /endpoint\.includes\('\?'\) \? '&' : '\?'/);
});
