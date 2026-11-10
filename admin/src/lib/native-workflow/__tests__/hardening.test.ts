import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advance,
  compileDefinition,
  createPeriodReportDefinition,
  createRunState,
  createStageReminderDefinition,
  definitionDigest,
  exportDefinitionJson,
  getCapability,
  parseDefinitionJson,
  simulate,
  validateDefinition,
  WORKFLOW_BOUNDS,
  WorkflowDefinitionError,
  WorkflowRuntimeError,
  type JsonValue,
  type SimulationFixtures,
  type WorkflowDefinition,
  type WorkflowEvent,
  type WorkflowValue,
} from '../index';
import { stageReminderFixtures, stageReminderScenario } from '../fixtures/stage-reminder';

const at = '2026-11-11T09:00:05.000Z';
const startEvent = stageReminderScenario.events[0]!;

interface DraftNode {
  nodeId: string;
  type: string;
  typeVersion: number;
  capabilityRef: string;
  config?: Record<string, JsonValue>;
  inputs?: Record<string, { nodeId: string; outputPath: string }>;
}

interface DraftDefinition {
  schemaVersion: number;
  definitionId: string;
  revision: number;
  entryNodeId: string;
  inputSchema: { eventType: string; periodKind?: string };
  nodes: DraftNode[];
  edges: Array<{ from: string; to: string; when?: string }>;
}

function draft(definition: WorkflowDefinition): DraftDefinition {
  return structuredClone(definition) as unknown as DraftDefinition;
}

function failingCodes(definition: unknown): string[] {
  const result = validateDefinition(definition);
  if (result.ok) return [];
  return result.issues.map((issue) => issue.code);
}

function fixtureOutputs(nodeId: string): Record<string, WorkflowValue> {
  const fixture = stageReminderFixtures.nodes[nodeId];
  if (!fixture || fixture.status !== 'ok') throw new Error(`missing fixture ${nodeId}`);
  return structuredClone(fixture.outputs) as Record<string, WorkflowValue>;
}

function observation(nodeId: string, outputs: Record<string, WorkflowValue>): WorkflowEvent {
  return { type: 'observation', at, nodeId, status: 'succeeded', outputs };
}

function stagePlan() {
  return compileDefinition(createStageReminderDefinition());
}

function startStage() {
  const plan = stagePlan();
  return {
    plan,
    result: advance(plan, createRunState(plan, { runId: 'run-hardening', mode: 'simulation' }), {
      type: 'start',
      at,
      event: startEvent,
    }),
  };
}

function advanceToPendingSave() {
  const started = startStage();
  let result = started.result;
  for (const nodeId of ['read-context', 'read-craft', 'compose-model']) {
    result = advance(started.plan, result.state, observation(nodeId, fixtureOutputs(nodeId)));
  }
  assert.equal(result.pending[0]?.nodeId, 'save-model');
  return { plan: started.plan, result };
}

function advanceToPendingDeliver() {
  const pendingSave = advanceToPendingSave();
  const saved = advance(pendingSave.plan, pendingSave.result.state, observation('save-model', {
    saved: true,
    saveReceipt: { receiptId: 'sim-save-hardening', simulated: true },
  }));
  assert.equal(saved.pending[0]?.nodeId, 'deliver-model');
  return { plan: pendingSave.plan, result: saved };
}

/** trigger -> read-scope -> read-flag -> condition -> (read-a | read-b) -> compose -> save -> deliver. */
function branchMergeDefinition(): WorkflowDefinition {
  const nodes: DraftNode[] = [
    {
      nodeId: 'trigger-1',
      type: 'trigger',
      typeVersion: 1,
      capabilityRef: 'trigger.stage_changed',
      config: { eventType: 'stage_changed' },
    },
    { nodeId: 'read-scope', type: 'read_materials', typeVersion: 1, capabilityRef: 'read.receiver_scope' },
    { nodeId: 'read-flag', type: 'read_materials', typeVersion: 1, capabilityRef: 'read.enterprise_craft' },
    {
      nodeId: 'condition-1',
      type: 'condition',
      typeVersion: 1,
      capabilityRef: 'condition.compare_boolean',
      config: { op: 'eq', right: true },
      inputs: { left: { nodeId: 'read-flag', outputPath: 'craftEnabled' } },
    },
    {
      nodeId: 'read-a',
      type: 'read_materials',
      typeVersion: 1,
      capabilityRef: 'read.project_context',
      inputs: { stageKey: { nodeId: 'trigger-1', outputPath: 'stageKey' } },
    },
    {
      nodeId: 'read-b',
      type: 'read_materials',
      typeVersion: 1,
      capabilityRef: 'read.project_context',
      inputs: { stageKey: { nodeId: 'trigger-1', outputPath: 'stageKey' } },
    },
    {
      nodeId: 'compose-1',
      type: 'compose_content',
      typeVersion: 1,
      capabilityRef: 'compose.stage_reminder_deterministic',
      config: { title: '阶段提醒', template: '项目已进入{{stageLabel}}阶段' },
      inputs: { stageLabel: { nodeId: 'trigger-1', outputPath: 'stageLabel' } },
    },
    {
      nodeId: 'save-1',
      type: 'save_result',
      typeVersion: 1,
      capabilityRef: 'save.stage_reminder',
      inputs: {
        title: { nodeId: 'compose-1', outputPath: 'title' },
        body: { nodeId: 'compose-1', outputPath: 'body' },
      },
    },
    {
      nodeId: 'deliver-1',
      type: 'deliver_inapp',
      typeVersion: 1,
      capabilityRef: 'deliver.inapp',
      inputs: {
        receivers: { nodeId: 'read-scope', outputPath: 'receivers' },
        title: { nodeId: 'compose-1', outputPath: 'title' },
        body: { nodeId: 'compose-1', outputPath: 'body' },
      },
    },
  ];
  const edges: DraftDefinition['edges'] = [
    { from: 'trigger-1', to: 'read-scope' },
    { from: 'read-scope', to: 'read-flag' },
    { from: 'read-flag', to: 'condition-1' },
    { from: 'condition-1', to: 'read-a', when: 'true' },
    { from: 'condition-1', to: 'read-b', when: 'false' },
    { from: 'read-a', to: 'compose-1' },
    { from: 'read-b', to: 'compose-1' },
    { from: 'compose-1', to: 'save-1' },
    { from: 'save-1', to: 'deliver-1' },
  ];
  return {
    schemaVersion: 1,
    definitionId: 'branch-merge',
    revision: 1,
    entryNodeId: 'trigger-1',
    inputSchema: { eventType: 'stage_changed' },
    nodes,
    edges,
  } as unknown as WorkflowDefinition;
}

test('advance rejects state bound to another definition version before handling any event', () => {
  const plan = stagePlan();
  const base = createRunState(plan, { runId: 'run-version', mode: 'simulation' });
  for (const mismatch of [{ definitionId: 'other-flow' }, { revision: 2 }, { digest: 'f'.repeat(64) }]) {
    const state = { ...base, ...mismatch };
    assert.throws(
      () => advance(plan, state, { type: 'start', at, event: startEvent }),
      (error: unknown) => error instanceof WorkflowRuntimeError && error.code === 'run_definition_mismatch',
    );
  }
  const duplicateFromOtherDigest = {
    ...base,
    digest: 'f'.repeat(64),
    processedEventIds: [startEvent.eventId],
  };
  assert.throws(
    () => advance(plan, duplicateFromOtherDigest, { type: 'start', at, event: startEvent }),
    (error: unknown) => error instanceof WorkflowRuntimeError && error.code === 'run_definition_mismatch',
  );
});

test('references reject self and branch-only sources but allow common pre-branch sources', () => {
  assert.equal(validateDefinition(branchMergeDefinition()).ok, true);

  const branchOnly = draft(branchMergeDefinition());
  branchOnly.nodes[6]!.inputs = { stageLabel: { nodeId: 'read-a', outputPath: 'stageLabel' } };
  assert.ok(failingCodes(branchOnly).includes('input_not_mandatory'));

  const branchOnlyDelivery = draft(branchMergeDefinition());
  branchOnlyDelivery.nodes[8]!.inputs = {
    receivers: { nodeId: 'read-b', outputPath: 'receivers' },
    title: { nodeId: 'compose-1', outputPath: 'title' },
    body: { nodeId: 'compose-1', outputPath: 'body' },
  };
  assert.ok(failingCodes(branchOnlyDelivery).includes('input_not_mandatory'));

  const selfReference = draft(branchMergeDefinition());
  selfReference.nodes[4]!.inputs = { stageKey: { nodeId: 'read-a', outputPath: 'stageLabel' } };
  assert.ok(failingCodes(selfReference).includes('self_input_reference'));
});

test('capabilities, ports, required fields and placeholders only use own properties', () => {
  assert.equal(getCapability('constructor'), undefined);
  assert.equal(getCapability('toString'), undefined);
  assert.equal(getCapability('trigger.stage_changed')?.type, 'trigger');

  const inheritedCapability = draft(createStageReminderDefinition());
  inheritedCapability.nodes[1]!.capabilityRef = 'constructor';
  assert.ok(failingCodes(inheritedCapability).includes('unknown_capability'));

  const inheritedInput = draft(createStageReminderDefinition());
  inheritedInput.nodes[1]!.inputs = {
    constructor: { nodeId: 'trigger-1', outputPath: 'stageKey' },
    stageKey: { nodeId: 'trigger-1', outputPath: 'stageKey' },
  };
  assert.ok(failingCodes(inheritedInput).includes('unknown_input'));

  const inheritedOutput = draft(createStageReminderDefinition());
  inheritedOutput.nodes[1]!.inputs = { stageKey: { nodeId: 'trigger-1', outputPath: 'constructor' } };
  assert.ok(failingCodes(inheritedOutput).includes('unknown_output_path'));

  const inheritedPlaceholder = draft(createStageReminderDefinition());
  inheritedPlaceholder.nodes[6]!.config = { title: '阶段提醒', template: '项目已进入{{constructor}}阶段' };
  assert.ok(failingCodes(inheritedPlaceholder).includes('unknown_template_placeholder'));
});

test('false saves, false deliveries and invalid receipts never complete a run', () => {
  const pendingSave = advanceToPendingSave();
  const falseSave = advance(pendingSave.plan, pendingSave.result.state, observation('save-model', {
    saved: false,
    saveReceipt: { receiptId: 'sim-save-false', simulated: true },
  }));
  assert.equal(falseSave.state.status, 'failed');
  assert.equal(falseSave.state.error?.code, 'save_not_confirmed');
  assert.equal(falseSave.state.outcome, null);

  const pendingDeliver = advanceToPendingDeliver();
  const falseDeliver = advance(pendingDeliver.plan, pendingDeliver.result.state, observation('deliver-model', {
    delivered: false,
    deliveryReceipt: { receiptId: 'sim-deliver-false', simulated: true },
  }));
  assert.equal(falseDeliver.state.status, 'failed');
  assert.equal(falseDeliver.state.error?.code, 'delivery_not_confirmed');
  assert.equal(falseDeliver.state.outcome, null);

  const invalidReceipt = advanceToPendingSave();
  const missingId = advance(invalidReceipt.plan, invalidReceipt.result.state, observation('save-model', {
    saved: true,
    saveReceipt: { simulated: true },
  }));
  assert.equal(missingId.state.status, 'failed');
  assert.equal(missingId.state.error?.code, 'invalid_receipt');

  const notSimulated = advanceToPendingSave();
  const unmarked = advance(notSimulated.plan, notSimulated.result.state, observation('save-model', {
    saved: true,
    saveReceipt: { receiptId: 'sim-save-real', simulated: false },
  }));
  assert.equal(unmarked.state.status, 'failed');
  assert.equal(unmarked.state.error?.code, 'receipt_not_simulated');

  const success = advanceToPendingDeliver();
  const delivered = advance(success.plan, success.result.state, observation('deliver-model', {
    delivered: true,
    deliveryReceipt: { receiptId: 'sim-deliver-ok', simulated: true },
  }));
  assert.equal(delivered.state.status, 'completed');
  assert.equal(delivered.state.outcome, 'delivered');
});

test('simulation applies the same save semantics instead of reporting success', () => {
  const fixtures = structuredClone(stageReminderFixtures) as { nodes: Record<string, unknown> };
  fixtures.nodes['save-model'] = {
    status: 'ok',
    outputs: { saved: false, saveReceipt: { receiptId: 'sim-save-false', simulated: true } },
  };
  const result = simulate({
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures: fixtures as unknown as SimulationFixtures,
  });
  const run = result.runs[0]!;
  assert.equal(run.status, 'failed');
  assert.equal(run.error?.code, 'save_not_confirmed');
  assert.equal(run.outcome, null);
});

test('observation, state and pending inputs do not share mutable JSON values', () => {
  const started = startStage();
  const outputs = structuredClone(fixtureOutputs('read-context'));
  const result = advance(started.plan, started.result.state, observation('read-context', outputs));
  const roles = ((outputs.receivers as Record<string, unknown>).roles as string[]);
  roles.push('tampered-after-advance');
  assert.deepEqual(
    (result.state.outputs['read-context']?.receivers as Record<string, unknown>).roles,
    ['owner', 'manager', 'worker'],
  );

  const snapshot = structuredClone(result.state);
  const next = advance(started.plan, result.state, observation('read-craft', fixtureOutputs('read-craft')));
  ((next.state.outputs['read-context']?.receivers as Record<string, unknown>).roles as string[]).push('tampered-state');
  assert.deepEqual(result.state, snapshot);

  const pendingDeliver = advanceToPendingDeliver();
  const operation = pendingDeliver.result.pending[0]!;
  assert.equal(operation.nodeId, 'deliver-model');
  ((operation.input.receivers as Record<string, unknown>).roles as string[]).push('tampered-pending');
  assert.deepEqual(
    (pendingDeliver.result.state.outputs['read-context']?.receivers as Record<string, unknown>).roles,
    ['owner', 'manager', 'worker'],
  );
});

test('exported definitions always re-import under one canonical size rule', () => {
  const definitions = [
    createStageReminderDefinition(),
    createPeriodReportDefinition('daily'),
    createPeriodReportDefinition('weekly'),
  ];
  for (const definition of definitions) {
    const text = exportDefinitionJson(definition);
    assert.ok(new TextEncoder().encode(text).length <= WORKFLOW_BOUNDS.maxDefinitionBytes + 1);
    const parsed = parseDefinitionJson(text);
    assert.equal(definitionDigest(parsed), definitionDigest(definition));
  }

  const padded = `${' '.repeat(100_000)}${exportDefinitionJson(createStageReminderDefinition())}`;
  assert.equal(definitionDigest(parseDefinitionJson(padded)), definitionDigest(createStageReminderDefinition()));

  assert.throws(
    () => parseDefinitionJson(' '.repeat(WORKFLOW_BOUNDS.maxImportTextBytes + 1)),
    (error: unknown) =>
      error instanceof WorkflowDefinitionError && error.issues.some((issue) => issue.code === 'definition_too_large'),
  );
});

test('cyclic or non-JSON observation values fail with invalid_observation', () => {
  const started = startStage();
  const withReceivers = (receivers: unknown): Record<string, WorkflowValue> => ({
    ...fixtureOutputs('read-context'),
    receivers: receivers as WorkflowValue,
  });

  const cyclicReceivers: Record<string, unknown> = { scope: 'project_members', roles: [] };
  cyclicReceivers.self = cyclicReceivers;

  let deep: Record<string, unknown> = { value: 'leaf' };
  for (let index = 0; index < 40; index += 1) deep = { child: deep };

  const invalidReceivers = [
    cyclicReceivers,
    { scope: 'project_members', roles: [], capturedAt: new Date('2026-11-11T00:00:00.000Z') },
    { scope: 'project_members', roles: [], callback: () => undefined },
    deep,
  ];
  for (const receivers of invalidReceivers) {
    const result = advance(started.plan, started.result.state, observation('read-context', withReceivers(receivers)));
    assert.equal(result.state.status, 'failed');
    assert.equal(result.state.error?.code, 'invalid_observation');
    assert.equal(result.pending.length, 0);
  }
});

test('import scan bounds depth, total traversal and cyclic structures', () => {
  const deepRoot = draft(createStageReminderDefinition()) as unknown as Record<string, unknown>;
  let deep: Record<string, unknown> = {};
  deepRoot.extra = deep;
  for (let index = 0; index < 40; index += 1) {
    const child: Record<string, unknown> = {};
    deep.child = child;
    deep = child;
  }
  assert.ok(failingCodes(deepRoot).includes('scan_depth_exceeded'));

  const cyclicRoot = draft(createStageReminderDefinition()) as unknown as Record<string, unknown>;
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  cyclicRoot.extra = cyclic;
  assert.ok(failingCodes(cyclicRoot).includes('cyclic_structure'));

  const wideRoot = draft(createStageReminderDefinition()) as unknown as Record<string, unknown>;
  wideRoot.extra = Array.from({ length: WORKFLOW_BOUNDS.maxScanNodes + 2000 }, (_, index) => `item-${index}`);
  assert.ok(failingCodes(wideRoot).includes('scan_nodes_exceeded'));
});
