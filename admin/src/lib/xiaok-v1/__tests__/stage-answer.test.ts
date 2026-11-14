import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerStageQuestion, selectStageFaq, stageAnswerViolations } from '../stage-answer';
import { stageKnowledgeRegistry } from '../stage-knowledge';
import { routeStageQuestion } from '../stage-router';
import { constructionKeysForStage } from '../stages';

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
