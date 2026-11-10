import type { CompiledNode, CompiledWorkflowPlan } from './compile';
import { WorkflowRuntimeError, workflowIssue, type WorkflowIssue } from './errors';
import { cloneJsonValue, ownValue, valueMatchesType } from './guards';
import { validateEffectReceipt } from './receipts';
import {
  WORKFLOW_BOUNDS,
  type PendingOperation,
  type RunMode,
  type TraceKind,
  type TriggerEvent,
  type WorkflowRunState,
  type WorkflowTraceEntry,
  type WorkflowValue,
} from './types';

export type WorkflowEvent =
  | { readonly type: 'start'; readonly at: string; readonly event: TriggerEvent }
  | {
      readonly type: 'observation';
      readonly at: string;
      readonly nodeId: string;
      readonly status: 'succeeded';
      readonly outputs: Readonly<Record<string, WorkflowValue>>;
    }
  | {
      readonly type: 'observation';
      readonly at: string;
      readonly nodeId: string;
      readonly status: 'failed';
      readonly error: WorkflowIssue;
    };

export interface AdvanceResult {
  readonly state: WorkflowRunState;
  readonly pending: readonly PendingOperation[];
  readonly trace: readonly WorkflowTraceEntry[];
}

export function createRunState(
  plan: CompiledWorkflowPlan,
  options: { readonly runId: string; readonly mode: RunMode },
): WorkflowRunState {
  return {
    runId: options.runId,
    definitionId: plan.definitionId,
    revision: plan.revision,
    digest: plan.digest,
    mode: options.mode,
    status: 'running',
    currentNodeId: plan.entryNodeId,
    pendingNodeId: null,
    visitedNodeIds: [],
    outputs: {},
    processedEventIds: [],
    error: null,
    outcome: null,
    stepCount: 0,
    traceSeq: 0,
  };
}

function cloneState(state: WorkflowRunState): WorkflowRunState {
  const outputs: Record<string, Record<string, WorkflowValue>> = {};
  for (const [nodeId, ports] of Object.entries(state.outputs)) {
    const owned: Record<string, WorkflowValue> = {};
    for (const [port, value] of Object.entries(ports)) owned[port] = cloneJsonValue(value);
    outputs[nodeId] = owned;
  }
  return {
    ...state,
    visitedNodeIds: [...state.visitedNodeIds],
    processedEventIds: [...state.processedEventIds],
    outputs,
    error: state.error ? { ...state.error } : null,
  };
}

function pushTrace(
  state: WorkflowRunState,
  trace: WorkflowTraceEntry[],
  at: string,
  kind: TraceKind,
  nodeId: string | null,
  nodeType: CompiledNode['type'] | null,
  detail?: Readonly<Record<string, unknown>>,
): void {
  state.traceSeq += 1;
  trace.push({
    seq: state.traceSeq,
    at,
    kind,
    nodeId,
    nodeType,
    mode: state.mode,
    ...(detail ? { detail } : {}),
  });
}

function triggerPayload(plan: CompiledWorkflowPlan, event: TriggerEvent): Record<string, WorkflowValue> {
  if (typeof event.eventId !== 'string' || event.eventId === '') {
    throw new WorkflowRuntimeError('event_mismatch', 'trigger event needs an eventId');
  }
  if (typeof event.occurredAt !== 'string' || event.occurredAt === '') {
    throw new WorkflowRuntimeError('event_mismatch', 'trigger event needs occurredAt');
  }
  if (event.eventType !== plan.inputSchema.eventType) {
    throw new WorkflowRuntimeError(
      'event_mismatch',
      `expected ${plan.inputSchema.eventType}, received ${String(event.eventType)}`,
    );
  }
  if (event.eventType === 'stage_changed') {
    if (typeof event.stageKey !== 'string' || event.stageKey === '') {
      throw new WorkflowRuntimeError('event_mismatch', 'stage events need stageKey');
    }
    if (typeof event.stageLabel !== 'string' || event.stageLabel === '') {
      throw new WorkflowRuntimeError('event_mismatch', 'stage events need stageLabel');
    }
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      stageKey: event.stageKey,
      stageLabel: event.stageLabel,
    };
  }
  if (event.periodKind !== plan.inputSchema.periodKind) {
    throw new WorkflowRuntimeError(
      'event_mismatch',
      `expected period kind ${String(plan.inputSchema.periodKind)}, received ${String(event.periodKind)}`,
    );
  }
  if (typeof event.periodStart !== 'string' || event.periodStart === '') {
    throw new WorkflowRuntimeError('event_mismatch', 'period events need periodStart');
  }
  if (typeof event.periodEnd !== 'string' || event.periodEnd === '') {
    throw new WorkflowRuntimeError('event_mismatch', 'period events need periodEnd');
  }
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    periodKind: event.periodKind as string,
    periodStart: event.periodStart,
    periodEnd: event.periodEnd,
  };
}

function resolveInputs(
  node: CompiledNode,
  outputs: Readonly<Record<string, Readonly<Record<string, WorkflowValue>>>>,
): Record<string, WorkflowValue> {
  const resolved: Record<string, WorkflowValue> = {};
  for (const [name, ref] of Object.entries(node.inputs)) {
    const ports = ownValue(outputs, ref.nodeId);
    const value = ports ? ownValue(ports, ref.outputPath) : undefined;
    if (value === undefined) {
      throw new WorkflowRuntimeError(
        'input_unresolved',
        `${node.nodeId}.${name} <- ${ref.nodeId}.${ref.outputPath} is not available`,
      );
    }
    resolved[name] = cloneJsonValue(value);
  }
  return resolved;
}

function evaluateCondition(node: CompiledNode, left: WorkflowValue): boolean {
  const op = String(node.config.op ?? '');
  const right = node.config.right;
  switch (op) {
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
    default:
      throw new WorkflowRuntimeError('invalid_condition', `condition ${node.nodeId} has an unsupported operator`);
  }
}

function composeDeterministic(node: CompiledNode, inputs: Record<string, WorkflowValue>): Record<string, WorkflowValue> {
  const template = String(node.config.template ?? '');
  const title = String(node.config.title ?? '');
  const body = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) =>
    String(inputs[name] ?? ''),
  );
  return { title, body };
}

function failRun(
  state: WorkflowRunState,
  trace: WorkflowTraceEntry[],
  at: string,
  issue: WorkflowIssue,
  nodeType: CompiledNode['type'] | null = null,
): void {
  state.status = 'failed';
  state.error = issue;
  state.pendingNodeId = null;
  pushTrace(state, trace, at, 'node_failed', state.currentNodeId, nodeType, { code: issue.code, path: issue.path });
}

function validateObservation(
  node: CompiledNode,
  outputs: Readonly<Record<string, WorkflowValue>>,
): { ok: true; outputs: Record<string, WorkflowValue> } | { ok: false; issue: WorkflowIssue } {
  const accepted: Record<string, WorkflowValue> = {};
  for (const [port, type] of Object.entries(node.outputTypes)) {
    const value = ownValue(outputs, port);
    if (value === undefined) {
      return {
        ok: false,
        issue: workflowIssue('invalid_observation', `nodes.${node.nodeId}.${port}`, 'observation is missing an output'),
      };
    }
    if (!valueMatchesType(value, type)) {
      return {
        ok: false,
        issue: workflowIssue('invalid_observation', `nodes.${node.nodeId}.${port}`, `observation output is not ${type}`),
      };
    }
    accepted[port] = value;
  }
  return { ok: true, outputs: accepted };
}

export function advance(plan: CompiledWorkflowPlan, state: WorkflowRunState, event: WorkflowEvent): AdvanceResult {
  if (state.definitionId !== plan.definitionId || state.revision !== plan.revision || state.digest !== plan.digest) {
    throw new WorkflowRuntimeError(
      'run_definition_mismatch',
      `state ${state.definitionId}@${state.revision}#${state.digest.slice(0, 12)} does not match plan ${plan.definitionId}@${plan.revision}#${plan.digest.slice(0, 12)}`,
    );
  }
  const isStart = event.type === 'start';
  if (isStart && state.processedEventIds.includes(event.event.eventId)) {
    const duplicate = cloneState(state);
    const trace: WorkflowTraceEntry[] = [];
    pushTrace(duplicate, trace, event.at, 'event_duplicate_ignored', null, null, { eventId: event.event.eventId });
    return { state: duplicate, pending: [], trace };
  }
  if (state.status !== 'running' && state.status !== 'waiting') {
    throw new WorkflowRuntimeError('run_terminal', `run ${state.runId} is ${state.status}`);
  }

  const next = cloneState(state);
  const trace: WorkflowTraceEntry[] = [];
  const pending: PendingOperation[] = [];

  if (event.type === 'start') {
    if (next.visitedNodeIds.length > 0 || next.pendingNodeId !== null) {
      throw new WorkflowRuntimeError('run_already_started', `run ${next.runId} already received a start event`);
    }
    if (next.currentNodeId !== plan.entryNodeId) {
      throw new WorkflowRuntimeError('run_already_started', 'run is not positioned at the entry node');
    }
    const payload = triggerPayload(plan, event.event);
    const entry = ownValue(plan.nodes, plan.entryNodeId);
    if (!entry || entry.type !== 'trigger') {
      throw new WorkflowRuntimeError('invalid_plan', 'entry node is not a trigger');
    }
    next.processedEventIds.push(event.event.eventId);
    next.outputs[entry.nodeId] = payload;
    next.visitedNodeIds.push(entry.nodeId);
    next.stepCount += 1;
    pushTrace(next, trace, event.at, 'run_started', entry.nodeId, entry.type, {
      eventId: event.event.eventId,
      digest: plan.digest,
      definitionId: plan.definitionId,
      revision: plan.revision,
    });
    pushTrace(next, trace, event.at, 'node_succeeded', entry.nodeId, entry.type, { trigger: true });
    pump(plan, next, entry.nodeId, event.at, trace, pending);
    return { state: next, pending, trace };
  }

  if (next.status !== 'waiting' || next.pendingNodeId === null) {
    throw new WorkflowRuntimeError('run_not_waiting', `run ${next.runId} has no pending operation`);
  }
  if (event.nodeId !== next.pendingNodeId) {
    throw new WorkflowRuntimeError(
      'observation_node_mismatch',
      `expected ${next.pendingNodeId}, received ${event.nodeId}`,
    );
  }
  const node = ownValue(plan.nodes, event.nodeId);
  if (!node) throw new WorkflowRuntimeError('invalid_plan', `unknown pending node ${event.nodeId}`);

  if (event.status === 'failed') {
    next.status = 'failed';
    next.error = { ...event.error };
    next.pendingNodeId = null;
    pushTrace(next, trace, event.at, 'node_failed', node.nodeId, node.type, {
      code: event.error.code,
      path: event.error.path,
    });
    return { state: next, pending, trace };
  }

  const validated = validateObservation(node, event.outputs);
  if (!validated.ok) {
    failRun(next, trace, event.at, validated.issue, node.type);
    return { state: next, pending, trace };
  }
  const ownedOutputs: Record<string, WorkflowValue> = {};
  for (const [port, value] of Object.entries(validated.outputs)) ownedOutputs[port] = cloneJsonValue(value);
  next.outputs[node.nodeId] = ownedOutputs;
  next.pendingNodeId = null;
  next.status = 'running';
  const receiptIssue = validateEffectReceipt(node, ownedOutputs, next.mode);
  if (receiptIssue) {
    failRun(next, trace, event.at, receiptIssue, node.type);
    return { state: next, pending, trace };
  }
  pushTrace(next, trace, event.at, 'node_succeeded', node.nodeId, node.type, { effect: node.effect });
  pump(plan, next, node.nodeId, event.at, trace, pending);
  return { state: next, pending, trace };
}

function pump(
  plan: CompiledWorkflowPlan,
  state: WorkflowRunState,
  completedNodeId: string,
  at: string,
  trace: WorkflowTraceEntry[],
  pending: PendingOperation[],
): void {
  let completed = completedNodeId;
  while (state.status === 'running') {
    const nextNodeId = route(plan, state, completed, at, trace);
    if (nextNodeId === null) return;
    if (state.stepCount >= WORKFLOW_BOUNDS.maxExecutionSteps) {
      failRun(state, trace, at, workflowIssue('bounded_execution_exceeded', '$', 'workflow exceeded its step bound'));
      return;
    }
    state.stepCount += 1;
    state.currentNodeId = nextNodeId;
    state.visitedNodeIds.push(nextNodeId);
    const node = ownValue(plan.nodes, nextNodeId);
    if (!node) {
      failRun(state, trace, at, workflowIssue('invalid_plan', '$', `unknown node ${nextNodeId}`));
      return;
    }
    pushTrace(state, trace, at, 'node_started', node.nodeId, node.type, { nodeVersion: node.nodeVersion });

    if (node.effect !== 'none') {
      const input = resolveInputs(node, state.outputs);
      state.status = 'waiting';
      state.pendingNodeId = node.nodeId;
      pending.push({
        nodeId: node.nodeId,
        nodeType: node.type,
        capabilityRef: node.capabilityRef,
        nodeVersion: node.nodeVersion,
        effect: node.effect,
        input,
        mode: state.mode,
        simulation: state.mode === 'simulation',
        idempotencyKey: `${plan.digest}:${state.runId}:${node.nodeId}`,
      });
      pushTrace(state, trace, at, 'node_pending', node.nodeId, node.type, {
        effect: node.effect,
        nodeVersion: node.nodeVersion,
      });
      return;
    }

    if (node.type === 'condition') {
      const input = resolveInputs(node, state.outputs);
      const result = evaluateCondition(node, input.left as WorkflowValue);
      state.outputs[node.nodeId] = { result };
      pushTrace(state, trace, at, 'branch_selected', node.nodeId, node.type, { result });
      pushTrace(state, trace, at, 'node_succeeded', node.nodeId, node.type, { effect: 'none' });
      completed = node.nodeId;
      continue;
    }

    if (node.capabilityRef === 'compose.stage_reminder_deterministic') {
      const input = resolveInputs(node, state.outputs);
      state.outputs[node.nodeId] = composeDeterministic(node, input);
      pushTrace(state, trace, at, 'node_succeeded', node.nodeId, node.type, { effect: 'none' });
      completed = node.nodeId;
      continue;
    }

    failRun(
      state,
      trace,
      at,
      workflowIssue('unsupported_deterministic_node', `nodes.${node.nodeId}`, 'node requires a host capability'),
      node.type,
    );
    return;
  }
}

function route(
  plan: CompiledWorkflowPlan,
  state: WorkflowRunState,
  completedNodeId: string,
  at: string,
  trace: WorkflowTraceEntry[],
): string | null {
  const node = ownValue(plan.nodes, completedNodeId);
  if (!node) {
    failRun(state, trace, at, workflowIssue('invalid_plan', '$', `unknown node ${completedNodeId}`));
    return null;
  }
  const edges = ownValue(plan.outgoing, completedNodeId) ?? [];
  if (node.type === 'condition') {
    const ports = ownValue(state.outputs, completedNodeId);
    const result = Boolean(ports ? ownValue(ports, 'result') : undefined);
    const branch = result ? 'true' : 'false';
    const edge = edges.find((candidate) => candidate.when === branch);
    if (!edge) {
      state.status = 'halted';
      state.outcome = `halted:${completedNodeId}:${branch}`;
      pushTrace(state, trace, at, 'run_halted', completedNodeId, node.type, { branch });
      return null;
    }
    return edge.to;
  }
  if (edges.length === 0) {
    if (node.type === 'save_result' || node.type === 'deliver_inapp') {
      state.status = 'completed';
      state.outcome = node.type === 'deliver_inapp' ? 'delivered' : 'saved';
      pushTrace(state, trace, at, 'run_completed', completedNodeId, node.type, { outcome: state.outcome });
      return null;
    }
    failRun(state, trace, at, workflowIssue('dangling_node', `nodes.${completedNodeId}`, 'node has no outgoing edge'));
    return null;
  }
  return edges[0]?.to ?? null;
}
