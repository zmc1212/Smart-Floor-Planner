const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { measureIntent, measureInvite } = require('../packages/assistant/lib/measure-card');

const root = path.join(__dirname, '..');
const chatRoot = path.join(root, 'packages', 'assistant', 'chat');

test('measurement intent only catches a booking request, not an informational question', () => {
  assert.equal(measureIntent('需要量房吗？'), true);
  assert.equal(measureIntent('想预约量房'), true);
  assert.equal(measureIntent('帮我安排一次上门测量'), true);
  assert.equal(measureIntent('量房要准备什么'), false);
  assert.equal(measureIntent('量房后多久出方案'), false);
  assert.equal(measureIntent('今天工地做了什么'), false);
});

test('a backend invitation can open the card, while general stage advice cannot', () => {
  assert.equal(measureInvite('需要我帮你安排一次免费量房吗？'), true);
  assert.equal(measureInvite('量房可以安排在这周吗？'), true);
  assert.equal(measureInvite('量房当天需要带什么？'), false);
  assert.equal(measureInvite('水电阶段要注意什么？'), false);
});

test('the card only appears in an active AI conversation and opens the booking sheet', () => {
  const js = fs.readFileSync(path.join(chatRoot, 'chat-definition.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(chatRoot, 'chat.wxml'), 'utf8');
  const bookingLess = fs.readFileSync(path.join(chatRoot, 'floorplan-booking.less'), 'utf8');
  assert.match(wxml, /measureCardVisible/);
  assert.match(wxml, /conversation\.mode === 'ai'/);
  assert.match(wxml, /预约量房/);
  assert.match(wxml, /bindtap="bookMeasure"/);
  assert.match(wxml, /bindtap="dismissMeasure"/);
  assert.match(js, /async bookMeasure\(\)[\s\S]{0,200}openMeasureBooking/);
  assert.match(wxml, /sheet === 'measure'/);
  assert.match(wxml, /submitMeasureBooking/);
  assert.match(wxml, /选择上门时间/);
  assert.match(js, /measureCardDismissed: true/);
  assert.match(js, /!this\.data\.siteContext && measureIntent\(this\.data\.draft\)/);
  assert.match(js, /this\.data\.siteContext \|\| this\.data\.measureCardVisible/);
  assert.match(js, /if \(this\.data\.measureCardDismissed\) return/);
  assert.match(js, /this\.data\.conversation\?\.measureOffer/);
  assert.match(js, /measureOfferAt/);
  assert.match(js, /_measureOfferDismissedAt/);
  assert.match(js, /_measureOfferLoadedFor/);
  assert.match(js, /maybeShowMeasureCard/);
  assert.match(wxml, /猜你想问/);
  assert.match(bookingLess, /\.measure-card/);
  assert.match(bookingLess, /\.mb-primary/);
});
