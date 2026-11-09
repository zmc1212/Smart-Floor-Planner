import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAgentV2Configuration } from '../fastgpt/agent-v2/config';
import { agentV2SkillIds, agentV2SkillPack, agentV2SkillPrompt, agentV2Skills, parseAgentV2Skills } from '../fastgpt/agent-v2/skills';

const base = {
  protocol: 'fastgpt-agent-v2-v1' as const, enterpriseId: '1454', appId: '6af16527093915ea6cf38496',
  model: 'deepseek-v4.1-flash-1017', bridgeKey: 'b'.repeat(64), runtime: 'fastgpt-agent-v2' as const,
};
const all = [...agentV2SkillIds];

test('the skill selection is versioned and validated with the private binding', () => {
  const parsed = parseAgentV2Configuration({ ...base, skills: { version: agentV2SkillPack, enabled: all } });
  assert.deepEqual(parsed.skills, { version: agentV2SkillPack, enabled: all });
  assert.deepEqual(parseAgentV2Configuration({ ...base, skills: { version: agentV2SkillPack, enabled: [] } }).skills,
    { version: agentV2SkillPack, enabled: [] });
  for (const bad of [
    { version: 'v2', enabled: all },
    { version: agentV2SkillPack, enabled: ['unknown-skill'] },
    { version: agentV2SkillPack, enabled: [all[0], all[0]] },
    { version: agentV2SkillPack, enabled: [...all, all[0]] },
    { version: agentV2SkillPack, enabled: [1] },
  ]) assert.throws(() => parseAgentV2Configuration({ ...base, skills: bad }), /context_changed/);
  assert.throws(() => parseAgentV2Skills({ version: agentV2SkillPack, enabled: 'stage-reminder' }), /context_changed/);
});

test('only enabled skills are resolved, in catalog order', () => {
  const selected = agentV2Skills({ version: agentV2SkillPack, enabled: ['report-followup', 'stage-reminder'] });
  assert.deepEqual(selected.map(skill => skill.id), ['stage-reminder', 'report-followup']);
  assert.equal(agentV2Skills({ version: agentV2SkillPack, enabled: [] }).length, 0);
  assert.equal(agentV2Skills(undefined).length, 0);
});

test('the skill prompt carries only enabled SOPs and keeps the permission boundary', () => {
  const prompt = agentV2SkillPrompt({ version: agentV2SkillPack, enabled: ['stage-reminder', 'appointment-guidance'] })!;
  assert.match(prompt, /不授予任何工具、权限或业务动作/);
  assert.match(prompt, /施工阶段提醒/);
  assert.match(prompt, /量房预约/);
  assert.equal(prompt.includes('验收要点'), false);
  assert.equal(prompt.includes('日周报追问'), false);
  assert.ok(Array.from(prompt).length < 3000);
  assert.equal(agentV2SkillPrompt({ version: agentV2SkillPack, enabled: [] }), null);
  assert.equal(agentV2SkillPrompt(undefined), null);
});
