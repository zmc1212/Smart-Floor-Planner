import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stageAgentRegistrations, stageAgentRegistry } from '../stage-agent-registry';
import { stageDefinitions, stageForConstructionKey } from '../stages';
import { stageKnowledgePacks, stageKnowledgeRegistry } from '../stage-knowledge';
import { stageReminderPolicies, reminderPolicyForStage } from '../stage-reminder-policies';

test('ten renovation stages have exactly one active lightweight agent', () => {
  assert.equal(stageDefinitions.length, 10);
  assert.equal(stageAgentRegistry.activeList().length, 10);
  assert.equal(new Set(stageAgentRegistrations.map(agent => agent.agentId)).size, 10);
  for (const stage of stageDefinitions) {
    const agent = stageAgentRegistry.active(stage.stageId);
    assert.ok(agent, 'missing agent for ' + stage.stageId);
    assert.equal(agent.knowledgePackId, 'stage-knowledge-' + stage.stageId + '-v1');
    assert.equal(agent.reminderPolicyId, 'stage-reminder-' + stage.stageId + '-v1');
    assert.equal(agent.weeklyReportTemplateId, 'stage-weekly-' + stage.stageId + '-v1');
    assert.deepEqual(agent.supportedConstructionStageKeys, [...stage.constructionKeys]);
  }
});

test('existing construction stage keys map without changing historical projects', () => {
  assert.equal(stageForConstructionKey('preparation')?.stageId, 'pre_construction');
  assert.equal(stageForConstructionKey('masonry_carpentry')?.stageId, 'masonry');
  assert.equal(stageForConstructionKey('move_in')?.stageId, 'occupancy');
  assert.equal(stageForConstructionKey('custom_enterprise_stage'), undefined);
  assert.equal(stageAgentRegistry.forConstructionKey('custom_enterprise_stage'), null);
});

test('each stage has one active versioned knowledge pack and reminder policy', () => {
  for (const stage of stageDefinitions) {
    const pack = stageKnowledgeRegistry.get(stage.stageId);
    assert.ok(pack, 'missing pack for ' + stage.stageId);
    assert.equal(pack.status, 'active');
    assert.equal(pack.version, 1);
    assert.ok(pack.faqs.length >= 4);
    const policy = reminderPolicyForStage(stage.stageId);
    assert.ok(policy, 'missing reminder policy for ' + stage.stageId);
    assert.equal(policy.status, 'active');
  }
  assert.equal(stageKnowledgePacks.length, 10);
  assert.equal(stageReminderPolicies.length, 10);
});

test('knowledge pack ids are unique and all active agents are versioned', () => {
  assert.equal(new Set(stageKnowledgePacks.map(pack => pack.packId)).size, 10);
  assert.equal(new Set(stageAgentRegistrations.map(agent => agent.agentId + '@' + agent.version)).size, 10);
  for (const agent of stageAgentRegistrations) assert.equal(agent.status, 'active');
});
