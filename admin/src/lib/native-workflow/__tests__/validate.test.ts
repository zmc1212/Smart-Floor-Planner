import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compileDefinition,
  createPeriodReportDefinition,
  createStageReminderDefinition,
  definitionDigest,
  exportDefinitionJson,
  parseDefinitionJson,
  validateDefinition,
  WorkflowDefinitionError,
  type JsonValue,
  type WorkflowDefinition,
} from '../index';

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

function assertRejected(definition: unknown, code: string): void {
  const result = validateDefinition(definition);
  assert.equal(result.ok, false);
  const codes = result.ok ? [] : result.issues.map((issue) => issue.code);
  assert.ok(codes.includes(code), `expected ${code}, received ${codes.join(',')}`);
}

test('both templates validate, compile to frozen plans and stay within bounds', () => {
  const definitions = [
    createStageReminderDefinition(),
    createPeriodReportDefinition('daily'),
    createPeriodReportDefinition('weekly'),
  ];
  for (const definition of definitions) {
    const result = validateDefinition(definition);
    assert.equal(result.ok, true);
    const plan = compileDefinition(definition);
    assert.equal(plan.definitionId, definition.definitionId);
    assert.equal(plan.revision, 1);
    assert.match(plan.digest, /^[0-9a-f]{64}$/);
    assert.equal(plan.bounds.nodeCount, definition.nodes.length);
    assert.equal(plan.bounds.edgeCount, definition.edges.length);
    assert.ok(Object.isFrozen(plan));
    assert.ok(Object.isFrozen(plan.nodes['trigger-1']));
    assert.ok(Object.isFrozen(plan.nodes['trigger-1']?.inputs ?? {}));
  }
});

test('rejects duplicate nodes, unknown types, capabilities and versions', () => {
  const duplicate = draft(createStageReminderDefinition());
  duplicate.nodes.push(structuredClone(duplicate.nodes[0] as DraftNode));
  assertRejected(duplicate, 'duplicate_node');

  const unknownType = draft(createStageReminderDefinition());
  (unknownType.nodes[1] as DraftNode).type = 'http_request';
  assertRejected(unknownType, 'unknown_node_type');

  const unknownCapability = draft(createStageReminderDefinition());
  (unknownCapability.nodes[1] as DraftNode).capabilityRef = 'http.fetch';
  assertRejected(unknownCapability, 'unknown_capability');

  const wrongVersion = draft(createStageReminderDefinition());
  (wrongVersion.nodes[1] as DraftNode).typeVersion = 2;
  assertRejected(wrongVersion, 'unsupported_node_version');
});

test('rejects bad references, missing outputs and type mismatches', () => {
  const missingNode = draft(createStageReminderDefinition());
  missingNode.nodes[1]!.inputs = { stageKey: { nodeId: 'ghost', outputPath: 'stageKey' } };
  assertRejected(missingNode, 'unknown_input_node');

  const missingOutput = draft(createStageReminderDefinition());
  missingOutput.nodes[1]!.inputs = { stageKey: { nodeId: 'trigger-1', outputPath: 'stageTitle' } };
  assertRejected(missingOutput, 'unknown_output_path');

  const typeMismatch = draft(createStageReminderDefinition());
  typeMismatch.nodes[5]!.inputs = { left: { nodeId: 'read-craft', outputPath: 'craftSummary' } };
  assertRejected(typeMismatch, 'input_type_mismatch');

  const forwardReference = draft(createStageReminderDefinition());
  forwardReference.nodes[1]!.inputs = { stageKey: { nodeId: 'compose-model', outputPath: 'title' } };
  assertRejected(forwardReference, 'input_not_upstream');
});

test('rejects illegal edges, missing branches and invalid entry', () => {
  const unknownEdge = draft(createStageReminderDefinition());
  unknownEdge.edges.push({ from: 'trigger-1', to: 'ghost' });
  assertRejected(unknownEdge, 'unknown_edge_node');

  const duplicateEdge = draft(createStageReminderDefinition());
  duplicateEdge.edges.push(structuredClone(duplicateEdge.edges[0] as { from: string; to: string }));
  assertRejected(duplicateEdge, 'duplicate_edge');

  const selfEdge = draft(createStageReminderDefinition());
  selfEdge.edges.push({ from: 'read-context', to: 'read-context' });
  assertRejected(selfEdge, 'self_edge');

  const branchOnRead = draft(createStageReminderDefinition());
  branchOnRead.edges.push({ from: 'read-context', to: 'read-craft', when: 'true' });
  assertRejected(branchOnRead, 'branch_on_non_condition');

  const missingWhen = draft(createStageReminderDefinition());
  const conditionEdge = missingWhen.edges.find((edge) => edge.from === 'condition-stage');
  assert.ok(conditionEdge);
  delete conditionEdge.when;
  assertRejected(missingWhen, 'condition_branch_missing_when');

  const duplicateBranch = draft(createStageReminderDefinition());
  duplicateBranch.edges.push({ from: 'condition-stage', to: 'read-craft', when: 'true' });
  assertRejected(duplicateBranch, 'duplicate_branch');

  const wrongEntry = draft(createStageReminderDefinition());
  wrongEntry.entryNodeId = 'read-context';
  assertRejected(wrongEntry, 'entry_not_trigger');
});

test('rejects cycles, dangling outputs, unreachable nodes and oversized graphs', () => {
  const cyclic = draft(createStageReminderDefinition());
  cyclic.edges.push({ from: 'deliver-model', to: 'trigger-1' });
  assertRejected(cyclic, 'cycle_detected');

  const dangling = draft(createStageReminderDefinition());
  dangling.edges = dangling.edges.filter(
    (edge) => !(edge.from === 'compose-deterministic' && edge.to === 'save-deterministic'),
  );
  assertRejected(dangling, 'dangling_node');

  const orphan = draft(createStageReminderDefinition());
  orphan.nodes.push({
    nodeId: 'read-orphan',
    type: 'read_materials',
    typeVersion: 1,
    capabilityRef: 'read.enterprise_craft',
  });
  assertRejected(orphan, 'unreachable_node');

  const nodes: DraftDefinition['nodes'] = [
    {
      nodeId: 'trigger-1',
      type: 'trigger',
      typeVersion: 1,
      capabilityRef: 'trigger.stage_changed',
      config: { eventType: 'stage_changed' },
    },
  ];
  const edges: DraftDefinition['edges'] = [];
  let previous = 'trigger-1';
  for (let index = 0; index < 30; index += 1) {
    const nodeId = `read-${index}`;
    nodes.push({ nodeId, type: 'read_materials', typeVersion: 1, capabilityRef: 'read.enterprise_craft' });
    edges.push({ from: previous, to: nodeId });
    previous = nodeId;
  }
  nodes.push({
    nodeId: 'compose-1',
    type: 'compose_content',
    typeVersion: 1,
    capabilityRef: 'compose.stage_reminder_deterministic',
    config: { title: '阶段提醒', template: '项目已进入{{stageLabel}}阶段' },
    inputs: { stageLabel: { nodeId: 'trigger-1', outputPath: 'stageLabel' } },
  });
  edges.push({ from: previous, to: 'compose-1' });
  nodes.push({
    nodeId: 'save-1',
    type: 'save_result',
    typeVersion: 1,
    capabilityRef: 'save.stage_reminder',
    inputs: {
      title: { nodeId: 'compose-1', outputPath: 'title' },
      body: { nodeId: 'compose-1', outputPath: 'body' },
    },
  });
  edges.push({ from: 'compose-1', to: 'save-1' });
  nodes.push({
    nodeId: 'deliver-1',
    type: 'deliver_inapp',
    typeVersion: 1,
    capabilityRef: 'deliver.inapp',
    inputs: {
      receivers: { nodeId: 'save-1', outputPath: 'saveReceipt' },
      title: { nodeId: 'compose-1', outputPath: 'title' },
      body: { nodeId: 'compose-1', outputPath: 'body' },
    },
  });
  edges.push({ from: 'save-1', to: 'deliver-1' });
  const oversized: DraftDefinition = {
    schemaVersion: 1,
    definitionId: 'oversized-flow',
    revision: 1,
    entryNodeId: 'trigger-1',
    inputSchema: { eventType: 'stage_changed' },
    nodes,
    edges,
  };
  const codes = failingCodes(oversized);
  assert.ok(codes.includes('bounds_exceeded'), `received ${codes.join(',')}`);
});

test('rejects unsafe config and unsafe imported JSON', () => {
  const extraConfig = draft(createStageReminderDefinition());
  extraConfig.nodes[5]!.config = { op: 'eq', right: true, url: 'https://evil.example/hook' };
  assertRejected(extraConfig, 'unknown_config_key');

  const badPlaceholder = draft(createStageReminderDefinition());
  badPlaceholder.nodes[6]!.config = { title: '阶段提醒', template: '项目已进入{{stageTitle}}阶段' };
  assertRejected(badPlaceholder, 'unknown_template_placeholder');

  const malformed = draft(createStageReminderDefinition());
  malformed.nodes[6]!.config = { title: '阶段提醒', template: '项目已进入{{stageLabel 阶段' };
  assertRejected(malformed, 'invalid_template');

  const urlJson = JSON.stringify(createStageReminderDefinition()).replace('阶段提醒', 'https://evil.example/hook');
  assert.throws(
    () => parseDefinitionJson(urlJson),
    (error: unknown) => error instanceof WorkflowDefinitionError && error.issues.some((issue) => issue.code === 'forbidden_content'),
  );

  const sqlJson = JSON.stringify(createStageReminderDefinition()).replace(
    '项目已进入{{stageLabel}}阶段，请按既定安排关注本阶段施工注意事项。',
    'select * from users',
  );
  assert.throws(
    () => parseDefinitionJson(sqlJson),
    (error: unknown) => error instanceof WorkflowDefinitionError && error.issues.some((issue) => issue.code === 'forbidden_content'),
  );

  assert.throws(
    () => parseDefinitionJson('{'),
    (error: unknown) => error instanceof WorkflowDefinitionError && error.issues.some((issue) => issue.code === 'invalid_json'),
  );
  assert.throws(
    () => parseDefinitionJson('x'.repeat(70 * 1024)),
    (error: unknown) =>
      error instanceof WorkflowDefinitionError && error.issues.some((issue) => issue.code === 'definition_too_large'),
  );
});

test('export/import round-trips and digests bind revision and content', () => {
  const original = createStageReminderDefinition();
  const exported = exportDefinitionJson(original);
  const parsed = parseDefinitionJson(exported);
  assert.equal(validateDefinition(parsed).ok, true);
  assert.equal(definitionDigest(parsed), definitionDigest(original));

  const revised: WorkflowDefinition = { ...original, revision: 2 };
  assert.notEqual(definitionDigest(revised), definitionDigest(original));

  const changedContent = draft(original);
  changedContent.nodes[0]!.config = { eventType: 'period_report' };
  assert.notEqual(definitionDigest(changedContent as unknown as WorkflowDefinition), definitionDigest(original));
});
