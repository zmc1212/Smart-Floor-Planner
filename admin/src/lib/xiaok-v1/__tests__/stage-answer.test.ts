import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerStageQuestion, selectStageFaq, stageAnswerViolations, unresolvedProjectAnswer } from '../stage-answer';
import { stageKnowledgeRegistry } from '../stage-knowledge';
import { classifyStageIntent, isStageKnowledgeQuestion, routeStageQuestion } from '../stage-router';
import { isStageChatQuestion } from '../stage-chat-service';
import { constructionKeysForStage, stageDefinitions } from '../stages';

const utilities = stageKnowledgeRegistry.get('utilities')!;
const painting = stageKnowledgeRegistry.get('painting')!;

test('ordinary stage questions use the lightweight knowledge pack and state enterprise limits', () => {
  const answer = answerStageQuestion({ constructionStageKey: 'utilities', question: '插座和开关点位如何结合生活需求考虑？', audience: 'owner' });
  assert.equal(answer.agentId, 'stage-utilities');
  assert.equal(answer.stageId, 'utilities');
  assert.equal(answer.matchedFaqId, 'outlet_planning');
  assert.equal(answer.enterpriseKnowledgeStatus, 'not_configured');
  assert.match(answer.answer, /本次未核实企业施工标准/u);
  assert.match(answer.answer, /不代表公司规定/u);
  assert.deepEqual(answer.citations, []);
});

test('no fabricated parameters, completion or enterprise rules pass the answer guard', () => {
  assert.deepEqual(stageAnswerViolations(utilities.faqs[0].answer), []);
  assert.deepEqual(stageAnswerViolations(painting.faqs[0].answer), []);
  assert.deepEqual(stageAnswerViolations('本次未核实企业施工标准，以下为通用常识。'), []);
  assert.ok(stageAnswerViolations('线管埋深必须 30mm。').includes('unverified_numeric_parameter'));
  assert.ok(stageAnswerViolations('本工程已验收合格。').includes('unverified_completion_claim'));
  assert.ok(stageAnswerViolations('公司标准要求这样做。').includes('unverified_enterprise_claim'));
});

test('faq selection is audience-aware and falls back to the pack intro when unrelated', () => {
  assert.equal(selectStageFaq(utilities, '隐蔽前需要确认什么？', 'worker')?.id, 'concealment');
  assert.equal(selectStageFaq(utilities, '今天天气怎么样？', 'owner'), null);
  const answer = answerStageQuestion({ constructionStageKey: 'utilities', question: '今天天气怎么样？', audience: 'owner' });
  assert.match(answer.answer, /可以先从这些事项看起/u);
  assert.equal(answer.matchedFaqId, null);
});

test('unknown or custom stages never get a guessed answer', () => {
  const answer = answerStageQuestion({ constructionStageKey: 'custom_stage', question: '现在做什么？' });
  assert.equal(answer.basis, 'no_stage');
  assert.equal(answer.agentId, null);
  assert.match(answer.answer, /阶段未知/u);
});

test('deep professional questions hand off to the existing specialist agents', () => {
  const waterproof = routeStageQuestion({ constructionStageKey: 'utilities', message: '闭水试验要怎么做？' });
  assert.equal(waterproof.kind, 'specialist');
  if (waterproof.kind === 'specialist') assert.equal(waterproof.domain, 'waterproof');
  const electrical = routeStageQuestion({ constructionStageKey: 'utilities', message: '配电箱回路和线径怎么核对？' });
  assert.equal(electrical.kind, 'specialist');
  if (electrical.kind === 'specialist') assert.equal(electrical.agentId, 'electrical-specialist');
  const ordinary = routeStageQuestion({ constructionStageKey: 'utilities', message: '插座点位怎么结合生活需求？' });
  assert.equal(ordinary.kind, 'stage_agent');
});

test('all ten stage packs answer their own first question without unsafe parameters', () => {
  for (const pack of stageKnowledgeRegistry.list()) {
    const constructionKey = constructionKeysForStage(pack.stageId)[0];
    const faq = pack.faqs[0];
    const answer = answerStageQuestion({ constructionStageKey: constructionKey, question: faq.question,
      audience: faq.audience === 'all' ? 'owner' : faq.audience });
    assert.equal(answer.stageId, pack.stageId, pack.stageId);
    assert.equal(answer.matchedFaqId, faq.id, pack.stageId);
    assert.deepEqual(stageAnswerViolations(answer.answer), [], pack.stageId);
    assert.equal(answer.answer.includes('本次未核实企业施工标准'), true, pack.stageId);
  }
});

test('verified enterprise knowledge is cited but never invented', () => {
  const answer = answerStageQuestion({ constructionStageKey: 'utilities', question: '企业有什么要求？',
    enterpriseKnowledge: [{ sourceId: 'K1', title: '企业水电工艺', quote: '按企业书面工艺执行。' }],
    enterpriseKnowledgeStatus: 'available' });
  assert.equal(answer.basis, 'enterprise_knowledge');
  assert.deepEqual(answer.citations, [{ sourceId: 'K1', title: '企业水电工艺', quote: '按企业书面工艺执行。' }]);
  assert.doesNotMatch(answer.answer, /本次未核实企业施工标准/u);
});

test('missing or unavailable enterprise knowledge is always labelled general knowledge', () => {
  for (const status of ['not_configured', 'unavailable'] as const) {
    const answer = answerStageQuestion({ constructionStageKey: 'utilities', question: '插座点位怎么准备？',
      enterpriseKnowledgeStatus: status });
    assert.match(answer.answer, /本次未核实企业施工标准/u);
    assert.deepEqual(answer.citations, []);
    assert.notEqual(answer.basis, 'enterprise_knowledge');
  }
});

test('every stage pack carries common questions, cautions and a next step', () => {
  assert.equal(stageDefinitions.length, 10);
  for (const stage of stageDefinitions) {
    const pack = stageKnowledgeRegistry.get(stage.stageId)!;
    assert.ok(pack.faqs.length >= 4, stage.stageId);
    assert.ok(pack.ownerConcerns.length >= 1 && pack.workerConcerns.length >= 1, stage.stageId);
    assert.ok(pack.nextStage.trim().length > 0, stage.stageId);
    const key = constructionKeysForStage(stage.stageId)[0];
    const answer = answerStageQuestion({ constructionStageKey: key, question: '这个阶段需要注意什么？', audience: 'owner' });
    assert.equal(answer.stageId, stage.stageId);
    assert.match(answer.answer, new RegExp(pack.nextStage.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').slice(0, 8), 'u'));
    assert.equal(answer.answer.includes('本次未核实企业施工标准'), true, stage.stageId);
  }
});

test('only ordinary stage knowledge turns use the deterministic pack', () => {
  for (const question of ['泥木阶段需要准备什么？', '墙面基层施工要注意什么？', '安装阶段下一步要注意什么？'])
    assert.equal(isStageKnowledgeQuestion(question), true, question);
  for (const question of ['我家现在做到哪一步了？', '这个项目现在是什么状态？', '现在有没有需要我处理的事？',
    '工地现在有照片或记录吗？', '本周周报发了吗？', '什么时候提醒我？', '待办还有哪些？'])
    assert.equal(isStageKnowledgeQuestion(question), false, question);
  assert.equal(isStageKnowledgeQuestion('闭水试验要怎么做？'), false);
  assert.equal(isStageKnowledgeQuestion('配电箱回路和线径怎么核对？'), false);
});

test('renovation plans and preferences stay in the consultation instead of borrowing the current stage', () => {
  for (const statement of ['我家是套旧房，准备重新装修。', '我准备把房子重新装一下。',
    '厨房的材料我更喜欢好清洁的。', '父母跟我一起住，施工期间会暂时搬出去。']) {
    assert.equal(isStageKnowledgeQuestion(statement), false, statement);
    assert.equal(isStageChatQuestion(statement), false, statement);
  }
  for (const question of ['水电阶段需要准备什么？', '开工前，我需要核对哪些事项', '帮我解释一下施工流程'])
    assert.equal(isStageChatQuestion(question), true, question);
});

test('preparation wording uses the known stage; actual status and an ambiguous next step stay separate', () => {
  const constructionStageKey = 'design';
  for (const question of ['做设计这一阶段要提前核对哪些事项？', '现在做设计，接下来需要准备什么？', '这阶段要做哪些准备？']) {
    assert.equal(isStageKnowledgeQuestion(question), true, question);
    const answer = answerStageQuestion({ constructionStageKey, question });
    assert.equal(answer.stageId, 'design', question);
    assert.match(answer.answer, /图纸|方案/u, question);
  }
  for (const question of ['我们现在到哪个阶段了？', '做设计这一步提前了几天？', '施工计划排出来了吗？']) {
    assert.equal(classifyStageIntent(question), 'progress', question);
    assert.equal(isStageKnowledgeQuestion(question), false, question);
    assert.equal(answerStageQuestion({ constructionStageKey, question }).matchedFaqId, null, question);
  }
  const answer = answerStageQuestion({ constructionStageKey, question: '那接下来呢？' });
  assert.equal(answer.intent, 'clarification');
  assert.equal(answer.matchedFaqId, null);
  assert.match(answer.answer, /一般要准备什么.*还是.*实际安排/u);
  assert.equal(isStageChatQuestion('那接下来呢？', ['做设计这一阶段要提前核对哪些事项？']), true);
  assert.equal(isStageChatQuestion('那接下来呢？', ['卫生间管根的防水要怎么做？']), false);
});

test('deep professional questions never borrow pack answers', () => {
  for (const question of ['闭水试验要怎么做？', '配电箱回路和线径怎么核对？']) {
    const route = routeStageQuestion({ constructionStageKey: 'utilities', message: question });
    assert.equal(route.kind, 'specialist', question);
    assert.equal(isStageKnowledgeQuestion(question), false);
  }
});

test('unresolved or ambiguous projects ask for the project instead of guessing a stage', () => {
  const none = unresolvedProjectAnswer('none');
  assert.equal(none.basis, 'no_stage');
  assert.equal(none.agentId, null);
  assert.match(none.answer, /无法确认装修阶段/u);
  const ambiguous = unresolvedProjectAnswer('ambiguous', ['工地甲', '工地乙']);
  assert.equal(ambiguous.basis, 'no_stage');
  assert.match(ambiguous.answer, /多个在施项目/u);
  assert.match(ambiguous.answer, /工地甲、工地乙/u);
  assert.match(ambiguous.answer, /我不会替你猜/u);
});
