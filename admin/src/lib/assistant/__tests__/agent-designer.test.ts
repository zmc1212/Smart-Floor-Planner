import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentToolsForMessage, assertDesignerReply, designerClarificationFollowup } from '../agent/worker';
import type { DesignerCard } from '@/lib/portfolio/designer-recommendation';

const card = {} as DesignerCard;

test('designer intent exposes the designer tool without replacing reference-image search', () => {
  const names = (text: string) => agentToolsForMessage(text, true).map(tool => tool.name);
  assert.ok(names('我想找设计师看看').includes('recommend_designers'));
  assert.ok(!names('我想找设计师看看').includes('recommend_references'));
  assert.ok(names('看看风格图和效果图').includes('recommend_references'));
  assert.ok(!names('看看风格图和效果图').includes('recommend_designers'));
  const mixed = names('想看效果图，也想找擅长三居的设计师');
  assert.ok(mixed.includes('recommend_references'));
  assert.ok(mixed.includes('recommend_designers'));
  assert.ok(names('谁设计过这种原木风').includes('recommend_designers'));
  assert.ok(!names('今天天气怎么样').includes('recommend_designers'));
  assert.deepEqual(agentToolsForMessage('我想找设计师', false), []);
});

test('a clarification turn supplies city/style/layout after XiaoK asked for them', () => {
  const names = (text: string, followup: boolean) => agentToolsForMessage(text, true, false, false, followup).map(tool => tool.name);
  assert.ok(!names('在成都，两居也可以看看。', false).includes('recommend_designers'));
  assert.ok(names('在成都，两居也可以看看。', true).includes('recommend_designers'));
  assert.ok(names('换成奶油风吧', true).includes('recommend_designers'));
  assert.equal(designerClarificationFollowup('想找一位设计师，我比较喜欢奶油风。', '在成都，两居也可以看看。'), true);
  assert.equal(designerClarificationFollowup('书房想更亮一点。', '在成都，两居也可以看看。'), false);
  assert.equal(designerClarificationFollowup('想找设计师', '谢谢'), false);
});

test('designer replies cannot claim appointments, prices, availability or visits', () => {
  for (const text of ['已经为你预约了设计师。', '已经安排设计师明天联系你。', '价格可以保证最低。',
    '设计师可随时参观样板间。', '已联系上设计师了。'])
    assert.throws(() => assertDesignerReply(text, [card]), /unsupported_model_commitment/, text);
  for (const text of ['可以申请联系设计师进一步沟通。', '作品仅供方向参考，不承诺可预约日期。', '同一小区不代表同一户型。'])
    assert.doesNotThrow(() => assertDesignerReply(text, [card]), text);
  assert.throws(() => assertDesignerReply('为你推荐4位设计师。', [card, card]), /invalid_model_citation/);
  assert.doesNotThrow(() => assertDesignerReply('为你推荐2位设计师。', [card, card]));
});
