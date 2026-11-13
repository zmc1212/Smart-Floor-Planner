import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardAnswerCommitments, parseAgentReply } from '../agent/context';
import { projectDeniedApprovalList } from '../agent/formal-claim-scope';

const original = '本次读取只是查询状态，不代表方案、费用、工期、现场落实或验收已批准；也没有已确认的处理期限，不能据此判断是否逾期。';
const parse = (text: string) => parseAgentReply(JSON.stringify({ kind: 'general', text }));
test('model prose cannot claim delegation registration or promise a date or delivery', () => {
  const scope = { delegationReply: true };
  for (const text of ['已为你登记跟进事项「卫生间管根」。', '跟进已取消。', '预计核对时间是明天。',
    '届时我会在这里告知你。', '明天一定完成核对。']) {
    assert.throws(() => guardAnswerCommitments(text, scope), /unsupported_model_commitment/, text);
  }
  assert.doesNotThrow(() => guardAnswerCommitments('目前缺少能核对管根的现场照片。', scope));
});
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

// I6.10 saved-draft replay: 7/28 drafts were rejected because a cited standard
// condition or its explanation was read as a completed project fact. Each
// mention is classified on its own; a project/formal completion in the same
// paragraph still fails.
const gb55030 = [
  '5.1.1 防水施工前应依据设计文件编制防水专项施工方案。',
  '5.1.4 防水施工前应确认基层已验收合格，基层质量应符合防水材料施工要求。',
  '5.1.11 穿结构管道、埋设件等应在防水层施工前埋设完成。',
  '5.1.12 应在防水层验收合格后进行下一道工序的施工。',
  '5.6.1 管根、地漏与基层交接部位应进行防水密封处理。',
  '5.6.2 墙面装饰层应与防水层粘结牢固。',
  '5.6.3 室内装修改造施工应保证防水层完整，出现损坏时应修补。',
];
const savedDrafts = [
  '管根、地漏与基层交接部位应进行防水密封处理。也就是说，管根处理是否到位，要看它是否已按设计/方案完成密封，并且基层验收合格，而不是单凭“处理完了”就放行。',
  '实操上，管根密封处理完成后，先确认管道已固定埋设到位、管根与基层交接处密封处理到位，再走基层验收；基层验收合格并有相应记录后，才安排防水层施工。防水层做完还要验收合格，才能进行下一道工序。',
  '按《建筑与市政工程防水通用规范》GB 55030-2022，防水施工前应确认基层已验收合格，基层质量应符合防水材料施工要求；穿结构管道、埋设件等应在防水层施工前埋设完成。因此判断能否做防水，看的是基层验收合格这一结论，而不是“管根处理过了”这个动作本身。',
  '同一规范还要求墙面装饰层应与防水层粘结牢固，室内装修改造施工应保证防水层完整，出现损坏时应修补。贴砖属于墙面装饰层施工，需在防水层完整、验收合格的基础上进行。',
  '所以“什么时候能贴砖”的关键节点不是防水做完后固定等几天，而是防水层验收合格。厨房若涉及管根、地漏与基层交接部位，还应先完成防水密封处理。',
];
test('cited standard conditions and their explanations are not project completions', () => {
  for (const text of savedDrafts) assert.doesNotThrow(() => guardAnswerCommitments(text, { acceptanceQuotes: gb55030 }), text);
  // The same wording without the selected standard is still unsupported.
  assert.throws(() => guardAnswerCommitments(savedDrafts[0], { acceptanceQuotes: ['另一个技术条款'] }), /unsupported_model_commitment/);
  assert.throws(() => guardAnswerCommitments(savedDrafts[4], { acceptanceQuotes: [] }), /unsupported_model_commitment/);
});
test('a project or formal completion in the same paragraph is still rejected', () => {
  for (const text of [
    savedDrafts[0] + '你家基层已经验收合格。',
    savedDrafts[1] + '本项目已经验收通过。',
    savedDrafts[2] + '项目已经正式验收通过。',
    savedDrafts[3] + '现场已正式验收。',
    savedDrafts[4] + '我们已经拿到防水层验收合格的回执。',
    '验收结果：防水层验收合格后可以贴砖。',
  ]) assert.throws(() => guardAnswerCommitments(text, { acceptanceQuotes: gb55030 }), /unsupported_model_commitment/, text);
});
