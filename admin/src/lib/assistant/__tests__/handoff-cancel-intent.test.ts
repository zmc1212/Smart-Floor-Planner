import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cancelsWaitingHandoff, requestsDesigner } from '../handoff/intent';

test('an explicit whole-message cancellation remains distinct from asking for a designer', () => {
  for (const text of ['取消人工接待', '请取消本次人工接待。', '请帮我取消设计师接待吧', '取消等待设计师', '不找设计师了', '我先不找设计师了！', '暂时不找设计师', '  帮我取消这次人工接续。\n']) {
    assert.equal(cancelsWaitingHandoff(text), true, text);
    assert.equal(requestsDesigner(text), false, text);
  }
  assert.equal(requestsDesigner('请设计师接着聊'), true);
  assert.equal(cancelsWaitingHandoff('请设计师接着聊'), false);
});

test('a refusal, question, quotation, hypothetical, mixed topic or vague withdrawal is not cancellation', () => {
  for (const text of ['', '不要取消人工接待', '先别取消人工接待', '取消人工接待吗？', '取消人工接待？', '如果取消人工接待会怎样', '“取消人工接待”', '他说不找设计师了', '我之前说过不找设计师了', '取消人工接待，顺便看看预算', '算了', '不等了', '取消', '不找设计师了？', '先不取消人工接待', '取消量房预约', '取消关注照片', '取消人工接待\n但先别结束']) {
    assert.equal(cancelsWaitingHandoff(text), false, text);
  }
});
