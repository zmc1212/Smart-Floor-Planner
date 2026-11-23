import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';
import { createStageConsultationDefinition } from '../stage-consultation-template';
import { validateDefinition } from '../validate';
import { answerStageQuestion } from '../../xiaok-v1/stage-answer';
import { executeStageWorkflow } from '../../xiaok-v1/stage-workflow-invocation';
import { stageDefinitions } from '../../xiaok-v1/stages';

test('the same published graph serves all ten stages with separate invocation state', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore() });
  const definitionId = 'stage-tool-visit';
  await service.createFromTemplate('stage-checklist', definitionId);
  const { version } = await service.publishDraft({ definitionId, expectedDraftRevision: 1 });
  const texts = new Set<string>();
  for (const stage of stageDefinitions) {
    const answer = answerStageQuestion({ constructionStageKey: stage.constructionKeys[0], question: '到现场可以先看哪些地方？' });
    const run = executeStageWorkflow(version, answer, 'owner', stage.stageId);
    assert.ok(run.text.startsWith(stage.name + '阶段'));
    assert.deepEqual(run.nodes, ['entry', 'guide', 'reply']);
    texts.add(run.text);
  }
  assert.equal(texts.size, stageDefinitions.length);
  const changed = { ...version.definition, nodes: version.definition.nodes.map(node => node.nodeId === 'reply'
    ? { ...node, inputs: { text: { nodeId: 'guide', outputPath: 'nextStage' } } } : node) };
  const draft = await service.saveDraft({ definitionId, expectedDraftRevision: 1, definition: changed });
  const newer = await service.publishDraft({ definitionId, expectedDraftRevision: draft.draft.draftRevision });
  const answer = answerStageQuestion({ constructionStageKey: 'utilities', question: '去现场要注意什么？' });
  assert.notEqual(executeStageWorkflow(newer.version, answer, 'owner', 'b').text,
    executeStageWorkflow(version, answer, 'owner', 'a').text);
  assert.throws(() => executeStageWorkflow({ ...newer.version, digest: version.digest }, answer, 'owner', 'tampered'));
  const sim = await service.simulate({ definitionId, source: 'published', fixtureSetId: 'stage-consultation' });
  assert.equal(sim.simulation.runs[0].outcome, 'returned');
  await assert.rejects(service.createFromTemplate('stage-reminder', 'stage-tool-other'));
  await assert.rejects(service.createFromTemplate('stage-checklist', 'electrical-inspection-v1'));
});

test('an authored condition chooses the configured output and requires a return on each branch', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore() });
  const definitionId = 'stage-tool-preparation';
  const record = await service.createFromTemplate('stage-guidance', definitionId);
  const base = record.draft.definition;
  const definition: typeof base = { ...base, nodes: [...base.nodes,
    { nodeId: 'matched', type: 'condition', typeVersion: 1, capabilityRef: 'condition.compare_boolean',
      config: { op: 'eq', right: true }, inputs: { left: { nodeId: 'guide', outputPath: 'matched' } } },
    { nodeId: 'next', type: 'output', typeVersion: 1, capabilityRef: 'output.stage_guide',
      inputs: { text: { nodeId: 'guide', outputPath: 'nextStage' } } }],
    edges: [{ from: 'entry', to: 'guide' }, { from: 'guide', to: 'matched' },
      { from: 'matched', to: 'reply', when: 'true' }, { from: 'matched', to: 'next', when: 'false' }] };
  const saved = await service.saveDraft({ definitionId, expectedDraftRevision: 1, definition });
  const { version } = await service.publishDraft({ definitionId, expectedDraftRevision: saved.draft.draftRevision });
  const answer = answerStageQuestion({ constructionStageKey: 'painting', question: '墙面涂饰阶段到现场看什么？' });
  const matched = executeStageWorkflow(version, { ...answer, matchedFaqId: 'known' }, 'owner', 'matched');
  const unmatched = executeStageWorkflow(version, { ...answer, matchedFaqId: null }, 'owner', 'unmatched');
  assert.equal(matched.text, answer.answer);
  assert.equal(matched.keepsSources, true);
  assert.equal(unmatched.nodes.at(-1), 'next');
  assert.equal(unmatched.keepsSources, false);
  assert.notEqual(unmatched.text, matched.text);
  assert.equal(validateDefinition({ ...definition, edges: definition.edges.slice(0, -1) }).ok, false);
});

test('callable workflows only return stage material and cannot introduce business effects', () => {
  const base = createStageConsultationDefinition('stage-guidance');
  const nodes = [...base.nodes];
  nodes[1] = { ...nodes[1], type: 'create_issue', capabilityRef: 'save.specialist_issue' };
  assert.equal(validateDefinition({ ...base, nodes }).ok, false);
  nodes[1] = base.nodes[1];
  nodes[2] = { ...nodes[2], inputs: { text: { nodeId: 'entry', outputPath: 'eventId' } } };
  assert.equal(validateDefinition({ ...base, nodes }).ok, false);
});
