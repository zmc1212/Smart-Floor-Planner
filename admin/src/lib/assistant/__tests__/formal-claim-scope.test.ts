import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAgentReply } from '../agent/context';
import { projectDeniedApprovalList } from '../agent/formal-claim-scope';

const original = '本次读取只是查询状态，不代表方案、费用、工期、现场落实或验收已批准；也没有已确认的处理期限，不能据此判断是否逾期。';
const parse = (text: string) => parseAgentReply(JSON.stringify({ kind: 'general', text }));
test('the actual sourced denial keeps its original wording and cannot become a completion receipt', () => {
  assert.equal(parse(original), original);
  for (const text of ['不代表方案、费用已批准。', '这并不代表方案和工期已经正式批准。', '不能证明现场落实及验收已批准。']) assert.equal(parse(text), text);
  assert.match(projectDeniedApprovalList(original), /不能据此确认操作状态/);
});
test('denial projection does not hide a later positive, double negation, an unknown subject or a second predicate', () => {
  for (const text of [original + '但方案已批准。', original + '已联系师傅。', '不代表方案、费用已批准，但已经验收。',
    '并非不代表方案、费用已批准。', '不是不代表方案、费用已批准。', '不代表方案、费用已批准以及已联系师傅。',
    '不代表方案、费用、承重已批准。', '不代表方案、费用已批准并已付款。', '也不代表已经预约或联系过，但已经付款。',
    '已经预约或联系过了。']) assert.throws(() => parse(text), /unsupported_model_commitment/, text);
});
test('a negated disclaimer with 也 and an or-list stays a disclaimer', () => {
  const text = '这些只是已公开的作品展示，不代表他们已经与您匹配，也不代表已经预约或联系过；最终效果还要看您的户型和实际施工条件。';
  assert.equal(parse(text), text);
});
