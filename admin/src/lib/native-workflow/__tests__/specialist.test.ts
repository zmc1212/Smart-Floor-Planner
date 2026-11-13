import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';
import { createWaterproofInspectionDefinition } from '../specialist-template';
import { compileDefinition } from '../compile';
import type { WorkflowDefinition } from '../types';
import { readFile } from 'node:fs/promises';
import { validateDefinition } from '../validate';
import { specialistFixtures, specialistScenario } from '../fixtures/specialist';
import { runPublishedLive } from '../live/runner';
import { LiveOperationWaiting, type LiveRunRecord, type LiveRunStore } from '../live/types';

const definitionId = 'waterproof-inspection-v1';

test('waterproof template uses the existing validator, compiler, store and simulator', async () => {
  const definition = createWaterproofInspectionDefinition();
  assert.equal(validateDefinition(definition).ok, true);
  const service = createWorkflowService({ store: createMemoryWorkflowStore() });
  const draft = await service.createFromTemplate(definitionId);
  const { version } = await service.publishDraft({ definitionId, expectedDraftRevision: draft.draft.draftRevision });
  assert.equal(version.digest, compileDefinition(version.definition).digest);
  for (const [fixtureSetId, status, branch, node] of [
    ['waterproof-reviewed', 'completed', 'issue', 'issue'],
    ['waterproof-waiting', 'waiting', 'true', 'checklist'],
    ['waterproof-missing-evidence', 'waiting', 'false', 'request_material'],
  ] as const) {
    const result = await service.simulate({ definitionId, source: 'published', revision: version.revision, fixtureSetId });
    assert.equal(result.simulation.runs[0].status, status);
    assert.equal(result.simulation.runs[0].modelComposeCount, 1);
    assert.equal(result.simulation.runs[0].trace.find(entry => entry.kind === 'branch_selected')?.detail?.branch, branch);
    assert.ok(result.simulation.runs[0].outputs[node]);
    assert.equal(result.simulation.runs[0].proposedOperations.some(op => op.nodeId === 'issue'), branch === 'issue');
  }
  const invalid = { ...definition, nodes: definition.nodes.map(node => node.type === 'agent'
    ? { ...node, config: { agentId: 'electrical-specialist', agentVersion: 1 } } : node) };
  assert.equal(validateDefinition(invalid).ok, false);
});

test('a missing issue branch or cross-wired evidence branch cannot publish', () => {
  const definition = createWaterproofInspectionDefinition();
  for (const edges of [
    definition.edges.filter(edge => edge.when !== 'issue'),
    definition.edges.map(edge => edge.when === 'false' ? { ...edge, to: 'checklist' } : edge),
  ]) {
    const checked = validateDefinition({ ...definition, edges });
    assert.equal(checked.ok, false);
    if (!checked.ok) assert.ok(checked.issues.some(issue => issue.code === 'invalid_specialist_branch'));
  }
});

test('a matching JSON type cannot substitute an unrelated output for specialist provenance', () => {
  const definition = createWaterproofInspectionDefinition();
  const nodes = definition.nodes.map(node => node.nodeId === 'result'
    ? { ...node, inputs: { ...node.inputs, review: { nodeId: 'project', outputPath: 'project' } } } : node);
  const checked = validateDefinition({ ...definition, nodes });
  assert.equal(checked.ok, false);
  if (!checked.ok) assert.ok(checked.issues.some(issue => issue.code === 'invalid_specialist_input'));
});

test('the original published definition still resolves with its original digest', async () => {
  const legacy = JSON.parse((await readFile(new URL('./fixtures/waterproof-v1.json', import.meta.url), 'utf8')).replace(/^\uFEFF/u, '')) as {
    definition: WorkflowDefinition; digest: string;
  };
  assert.equal(compileDefinition(legacy.definition).digest, legacy.digest);
});

test('the live runner restores a pending event, absorbs a replay, and preserves the selected publication', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore() });
  const draft = await service.createFromTemplate(definitionId);
  const { version } = await service.publishDraft({ definitionId, expectedDraftRevision: draft.draft.draftRevision });
  let stored: LiveRunRecord | null = null;
  const store: LiveRunStore = {
    create: async record => stored ? { record: structuredClone(stored), created: false }
      : { record: structuredClone(stored = record), created: true },
    update: async record => structuredClone(stored = record),
    get: async () => structuredClone(stored),
    list: async () => stored ? [structuredClone(stored)] : [],
  };
  let ready = false, readCount = 0, issueCount = 0;
  const event = specialistScenario.events[0];
  const run = (wakeEventId: string, published = version) => runPublishedLive({
    published, enterpriseId: '1454', projectId: '1', event, store, runId: 'specialist:test', resume: true, wakeEventId,
    businessEvent: { source: 'outbox', outboxEventId: null, progressRevision: 0, stageKey: 'waterproof', settingsVersion: 1 },
    ports: { async execute(operation) {
      if (operation.nodeId === 'site_record') {
        readCount++;
        if (!ready) throw new LiveOperationWaiting('site_record_pending');
      }
      if (operation.nodeId === 'issue') issueCount++;
      const fixture = specialistFixtures.capabilities?.[operation.capabilityRef];
      assert.equal(fixture?.status, 'ok');
      if (fixture.status !== 'ok') throw Error('fixture cannot produce output');
      return {
        ...fixture.outputs,
        ...(operation.nodeId === 'analysis' ? { hasIssue: false } : {}),
        ...(operation.nodeId === 'issue' ? { saveReceipt: { receiptId: 'site-issue-1', simulated: false } } : {}),
        ...(operation.nodeId === 'result' ? { deliveryReceipt: { receiptId: 'message-1', simulated: false } } : {}),
      };
    } },
  });
  const waiting = await run('request');
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.state.pendingNodeId, 'site_record');
  assert.deepEqual(await run('request'), waiting);
  assert.equal(readCount, 1);
  const changed = await service.saveDraft({ definitionId, expectedDraftRevision: draft.draft.draftRevision,
    definition: { ...draft.draft.definition, nodes: draft.draft.definition.nodes.map(node => node.nodeId === 'analysis_ready'
      ? { ...node, config: { evidencePolicy: 'both' } } : node) } });
  const newer = await service.publishDraft({ definitionId, expectedDraftRevision: changed.draft.draftRevision });
  assert.ok(newer.version.revision > version.revision);
  const simulation = await service.simulate({ definitionId, source: 'published', fixtureSetId: 'waterproof-waiting' });
  assert.ok(simulation.simulation.runs[0].outputs.request_material);
  assert.equal(simulation.simulation.runs[0].outputs.checklist, undefined);
  ready = true;
  await assert.rejects(() => run('photo', newer.version), /different enterprise, project, event or published revision/);
  const completed = await run('photo');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.binding.digest, version.digest);
  assert.ok(completed.trace.some(entry => entry.kind === 'run_resumed'));
  assert.deepEqual(await run('photo'), completed);
  assert.equal(issueCount, 1);
});
