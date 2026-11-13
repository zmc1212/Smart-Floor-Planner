import assert from 'node:assert/strict';
import test from 'node:test';
import { consultationSpecialist, specialistConsultationTools, specialistFollowupRequested } from './consultation';
import { bindSpecialistInput, specialistRegistry, specialists, waterproofAgentId } from './registry';
import type { ModelTool } from '../contracts/model';
import { projectCitedAcceptanceCondition, projectUnconfirmedWaterproofAcceptance } from '../agent/formal-claim-scope';
import { guardAnswerCommitments } from '../agent/context';

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
  assert.equal(specialistFollowupRequested('卫生间准备做防水，开工前要核对哪些地方？'), false);
  assert.equal(specialistFollowupRequested('帮我持续跟进卫生间的管根，师傅核实后在这里告诉我。'), true);
  assert.equal(specialistFollowupRequested('卫生间的防水不用跟进，我只想先问问。'), false);
  assert.equal(consultationSpecialist('刚才那个 GB 50108-2008 的防水条文呢？', prior)?.standard, undefined);
  assert.equal(consultationSpecialist('我们公司的卫生间防水标准是什么？', [])?.companyOnly, true);
  assert.equal(consultationSpecialist('这个和国家通用要求有什么区别？', ['我们公司的卫生间防水标准是什么？'])?.companyPractice, true);
});

test('a verified technical prerequisite cannot authorize a completed project status', () => {
  const quote = '5.1.4 防水施工前应确认基层已验收合格，基层质量应符合防水材料施工要求。';
  const condition = '防水施工前应确认基层已验收合格，基层质量应符合防水材料施工要求。';
  assert.throws(() => guardAnswerCommitments(condition));
  assert.doesNotThrow(() => guardAnswerCommitments(projectCitedAcceptanceCondition(condition, [quote])));
  assert.throws(() => guardAnswerCommitments(projectCitedAcceptanceCondition(condition, ['另一个技术条款'])));
  assert.throws(() => guardAnswerCommitments(projectCitedAcceptanceCondition(condition + '你家基层已验收合格。', [quote])));
  assert.throws(() => guardAnswerCommitments(projectCitedAcceptanceCondition('防水施工前应确认基层已验收合格且已批准。', [quote])));
  assert.doesNotThrow(() => guardAnswerCommitments(projectUnconfirmedWaterproofAcceptance('也不能确认管根处理已完成或基层已验收合格。')));
  assert.throws(() => guardAnswerCommitments(projectUnconfirmedWaterproofAcceptance('不能确认基层已验收合格，项目已经验收。')));
});
