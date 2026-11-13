import assert from 'node:assert/strict';
import test from 'node:test';
import { consultationSpecialist, specialistConsultationTools, specialistFollowupRequested } from './consultation';
import { bindSpecialistInput, specialistRegistry, specialists, waterproofAgentId } from './registry';
import type { ModelTool } from '../contracts/model';
import { guardAnswerCommitments } from '../agent/context';
import { knowledgeReadPending } from '../agent/read-tool-input';

test('only the active waterproof registration is selectable and can narrow authorized tools', () => {
  const active = specialists.active(waterproofAgentId)!;
  assert.equal(active.version, 1);
  assert.equal(specialists.active('electrical-specialist'), undefined);
  assert.equal(specialists.version('electrical-specialist', 1)?.status, 'draft');
  assert.throws(() => specialistRegistry([active, { ...active, version: 2 }]), /duplicate_specialist_registration/);
  const disabled = specialistRegistry([{ ...active, status: 'disabled' }]);
  assert.equal(disabled.active(active.agentId), undefined);
  assert.equal(disabled.version(active.agentId, 1)?.status, 'disabled');
  const input = bindSpecialistInput({ ...active, knowledgeScopes: ['enterprise'], toolPermissions: ['knowledge'] }, {
    question: '卫生间防水什么时候做？', conversation: [], enterpriseId: '1454', projectId: '1', stage: 'waterproof', room: '卫生间',
    knowledgeScopes: ['enterprise', 'project'], toolPermissions: ['knowledge', 'project_progress', 'followup'],
  });
  const tools = ['search_knowledge', 'query_business', 'start_delegation', 'query_materials'].map(name => ({ name, description: name, parameters: {} } as ModelTool));
  assert.deepEqual(input.knowledgeScopes, ['enterprise']);
  assert.deepEqual(specialistConsultationTools(tools, input, false).map(tool => tool.name), ['search_knowledge']);
  assert.deepEqual(specialistConsultationTools(tools, input, true), []);
});

test('advice, latest room corrections, company standards, other editions and project facts use separate reads', () => {
  const prior = ['厨房管根处理完怎么知道可以做防水？'];
  assert.equal(consultationSpecialist('处理完以后什么时候可以做防水？', prior)?.agent.agentId, waterproofAgentId);
  assert.equal(consultationSpecialist('刚才说的是卫生间，不是厨房。', prior)?.room, '卫生间');
  assert.equal(consultationSpecialist('不是厨房，是卫生间。', prior)?.room, '卫生间');
  assert.equal(consultationSpecialist('我家卫生间现在做到哪一步？', prior)?.progressRequested, true);
  assert.equal(consultationSpecialist('我家书房做到哪一步？', [])?.agent, undefined);
  assert.equal(consultationSpecialist('我家主卧现在做到哪一步？', [])?.room, '主卧');
  assert.equal(consultationSpecialist('那我家主卧现在施工到哪一步了？', prior)?.progressRequested, true);
  assert.equal(specialistFollowupRequested('卫生间准备做防水，开工前要核对哪些地方？'), false);
  assert.equal(specialistFollowupRequested('帮我持续跟进卫生间的管根，师傅核实后在这里告诉我。'), true);
  assert.equal(specialistFollowupRequested('卫生间的防水不用跟进，我只想先问问。'), false);
  assert.equal(consultationSpecialist('刚才那个 GB 50108-2008 的防水条文呢？', prior)?.standard, undefined);
  assert.equal(consultationSpecialist('我们公司的卫生间防水标准是什么？', [])?.companyOnly, true);
  assert.equal(consultationSpecialist('这个和国家通用要求有什么区别？', ['我们公司的卫生间防水标准是什么？'])?.companyPractice, true);
  assert.equal(consultationSpecialist('那国标对卫生间管根是怎么要求的？', ['我们这家公司安排卫生间防水和后面的检查是怎么做的？'])?.companyPractice, false);
  assert.equal(knowledgeReadPending('那国标对卫生间管根是怎么要求的？能给我原文出处吗？', [], '1'), false);
  assert.equal(knowledgeReadPending('请给我原文出处。我们这家公司内部的防水标准怎么写的？', [], '1'), true);
  assert.equal(consultationSpecialist('能按这间卫生间给我列个开工前的检查清单吗？', ['卫生间准备做防水，开工前注意什么？'])?.room, '卫生间');
});

test('selected originals qualify normative acceptance only, across construction stages', () => {
  const quotes = [
    '5.1.4 防水施工前应确认基层已验收合格，基层质量应符合防水材料施工要求。',
    '5.1.12 应在防水层验收合格后进行下一道工序的施工。',
  ];
  const scope = { acceptanceQuotes: quotes };
  for (const text of [
    '第5.1.4条要求施工前确认基层已验收合格。',
    '施工前基层要先验收通过。',
    '铺砖这类后续工序要以防水层验收合格为前提。',
    '开工前先落实两件事：施工方案，以及基层验收合格的确认。',
    '建议先核对基层是否已验收合格。',
    '目前无法判断防水层验收是否通过。',
  ]) assert.doesNotThrow(() => guardAnswerCommitments(text, scope), text);
  for (const text of [
    '你家基层已经验收合格。', '现场正式验收通过。', '工程已放行。',
    '防水层已经验收合格了，才能做下一道工序。',
    '应在防水层验收合格后进行下一道工序，但项目已正式验收。',
    '不能确认基层已验收合格吗？', '不能确认基层已验收合格但项目验收通过。',
    '本项目基层验收合格后已经付款。',
    '应在基层和防水层验收合格后继续。',
    '我们已经拿到基层验收合格的确认。',
    '不是不能作为隐蔽工程验收合格的回执。',
  ]) assert.throws(() => guardAnswerCommitments(text, scope), /unsupported_model_commitment/, text);
  assert.doesNotThrow(() => guardAnswerCommitments('所以防水做完后要先验收，验收合格才能做下一道工序。',
    { acceptanceQuotes: quotes.slice(1) }));
  const anotherStage = { acceptanceQuotes: ['吊顶封板前应确认龙骨已验收合格。'] };
  assert.doesNotThrow(() => guardAnswerCommitments('封板之前应确认龙骨已验收合格。', anotherStage));
  assert.throws(() => guardAnswerCommitments('封板之前应确认吊杆已验收合格。', anotherStage), /unsupported_model_commitment/);
});

test('a verified technical prerequisite cannot authorize a completed project status', () => {
  const quote = '5.1.4 防水施工前应确认基层已验收合格，基层质量应符合防水材料施工要求。';
  const condition = '防水施工前应确认基层已验收合格，基层质量应符合防水材料施工要求。';
  assert.throws(() => guardAnswerCommitments(condition));
  assert.doesNotThrow(() => guardAnswerCommitments(condition, { acceptanceQuotes: [quote] }));
  assert.throws(() => guardAnswerCommitments(condition, { acceptanceQuotes: ['另一个技术条款'] }));
  assert.throws(() => guardAnswerCommitments(condition + '你家基层已验收合格。', { acceptanceQuotes: [quote] }));
  assert.throws(() => guardAnswerCommitments('防水施工前应确认基层已验收合格且已批准。', { acceptanceQuotes: [quote] }));
  assert.doesNotThrow(() => guardAnswerCommitments('也不能确认管根处理已完成或基层已验收合格。', { acceptanceQuotes: [] }));
  assert.throws(() => guardAnswerCommitments('不能确认基层已验收合格，项目已经验收。', { acceptanceQuotes: [] }));
  assert.doesNotThrow(() => guardAnswerCommitments('这份照片不能作为隐蔽工程验收合格或铺砖放行的回执。', { acceptanceQuotes: [] }));
  assert.doesNotThrow(() => guardAnswerCommitments('这是现场记录，不是隐蔽工程验收合格或铺砖放行的回执。', { acceptanceQuotes: [] }));
});
