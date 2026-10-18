import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatFirstProgress, defaultGuidance } from '../requirements/guidance';
import { requestsDesigner, needsDesignerSuggestion } from '../handoff/intent';
import { dispatchHandoff } from '../handoff/service';
const turns = (...texts: string[]) => texts.map((text, i) => ({ id: String(i + 1), text }));
test('reference browsing is not a need or summary bookmark; independent needs in another clause remain',()=>{
  const browsing=chatFirstProgress(defaultGuidance,turns('给我看看原木参考案例','这个原木案例我喜欢','先看看简约','第一个原木喜欢'));
  assert.equal(browsing.fields.style.text,'');
  const mixed=chatFirstProgress(defaultGuidance,turns('书房要双人桌，给我看看原木参考案例','我喜欢简约风'));
  assert.match(mixed.fields.room.text,/书房要双人桌/);assert.equal(mixed.fields.style.text,'我喜欢简约风');
});
test('topic interruption remains paused after subsequent statements and never fills an unrelated field', () => {
  const p = chatFirstProgress(defaultGuidance, turns('90平旧房，两个人住，喜欢原木风', '预算还没想好。这面墙能拆吗？', '先保留墙体'));
  assert.equal(p.paused, true); assert.equal(p.next, undefined);
  assert.equal(p.fields.budget.text, '预算还没想好');
  assert.equal(p.fields.timeline.text, ''); assert.equal(p.fields.housing.text, '90平旧房');
});
test('natural corrections retain negation, source ids and separate named rooms', () => {
  const p = chatFirstProgress(defaultGuidance, turns('预算20万，书房书桌靠窗', '客厅保留沙发', '预算不是20万，是30万', '书房保留原书桌'));
  assert.equal(p.fields.budget.text, '是30万'); assert.equal(p.fields.budget.sourceMessageId, '3');
  assert.match(p.fields.room.text, /客厅保留沙发/); assert.match(p.fields.room.text, /书房保留原书桌/);
  assert.doesNotMatch(p.fields.room.text, /靠窗/);
});
test('direct human intent never accepts refusal, hypotheticals or quoted requests', () => {
  for (const s of ['找设计师', '帮我找个设计师聊聊', '请设计师接着聊', '转人工']) assert.equal(requestsDesigner(s), true, s);
  for (const s of ['不要找设计师', '如果我要找设计师呢？', '他说“找设计师”', '先继续聊预算']) assert.equal(requestsDesigner(s), false, s);
  assert.equal(needsDesignerSuggestion('我想要正式报价'), true);
  assert.equal(needsDesignerSuggestion('具体工期是多少'), true);
});
test('dispatch projection never leaks packet, phone, summary or image consent before claim', () => {
  const h = { state: 'waiting' as const, requestId: '1', recipientId: null, recipientName: '团队', requestedAt: '',
    packet: { messages: ['private'], summary: 'secret' }, contactConsent: true, phone: '13800000000', source: {}, leadId: '4', mediaConsent: true };
  const projected = JSON.stringify(dispatchHandoff(h));
  assert.doesNotMatch(projected, /private|secret|13800000000|packet|mediaConsent|leadId/);
});
