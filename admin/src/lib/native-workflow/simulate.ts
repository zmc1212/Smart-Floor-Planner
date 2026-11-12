import { advance, createRunState, type WorkflowEvent } from './advance';
import { compileDefinition } from './compile';
import { WorkflowRuntimeError, workflowIssue, type WorkflowIssue } from './errors';
import { cloneJsonValue, isPlainObject, ownValue } from './guards';
import type {
  PendingOperation,
  RunStatus,
  TriggerEvent,
  WorkflowTraceEntry,
  WorkflowValue,
} from './types';

export interface NodeFixtureSuccess {
  readonly status: 'ok';
  readonly outputs: Readonly<Record<string, WorkflowValue>>;
}

export interface NodeFixtureFailure {
  readonly status: 'failed';
  readonly error: WorkflowIssue;
}

export type NodeFixture = NodeFixtureSuccess | NodeFixtureFailure;

export interface SimulationFixtures {
  readonly nodes: Readonly<Record<string, NodeFixture>>;
}

export interface SimulationScenario {
  readonly runIdPrefix: string;
  readonly clock: { readonly startedAt: string; readonly stepMs: number };
  readonly events: readonly TriggerEvent[];
}

export interface FixtureLogEntry {
  readonly nodeId: string;
  readonly result: 'ok' | 'failed' | 'missing';
  readonly code?: string;
}

export interface SimulationRun {
  readonly runId: string;
  readonly eventId: string;
  readonly status: RunStatus;
  readonly outcome: string | null;
  readonly error: WorkflowIssue | null;
  readonly trace: readonly WorkflowTraceEntry[];
  readonly proposedOperations: readonly PendingOperation[];
  readonly fixtureLog: readonly FixtureLogEntry[];
  readonly modelComposeCount: number;
  readonly outputs: Readonly<Record<string, Readonly<Record<string, WorkflowValue>>>>;
}

export interface SimulationResult {
  readonly mode: 'simulation';
  readonly definitionId: string;
  readonly revision: number;
  readonly digest: string;
  readonly runs: readonly SimulationRun[];
  readonly duplicateEventIds: readonly string[];
}

/**
 * Fixture-driven execution. Every simulated save/delivery receipt is forced to
 * carry `simulated: true`; a fixture that claims a real receipt is rejected.
 */
export function simulate(input: {
  readonly definition: unknown;
  readonly scenario: SimulationScenario;
  readonly fixtures: SimulationFixtures;
}): SimulationResult {
  const plan = compileDefinition(input.definition);
  const { scenario, fixtures } = input;
  validateScenario(scenario);

  const seen = new Set<string>();
  const duplicateEventIds: string[] = [];
  const runs: SimulationRun[] = [];
  let step = 0;
  const clockStart = Date.parse(scenario.clock.startedAt);
  const nextAt = (): string => {
    const at = new Date(clockStart + step * scenario.clock.stepMs).toISOString();
    step += 1;
    return at;
  };

  for (const event of scenario.events) {
    if (seen.has(event.eventId)) {
      duplicateEventIds.push(event.eventId);
      continue;
    }
    seen.add(event.eventId);
    const runId = `${scenario.runIdPrefix}:${event.eventId}`;
    const trace: WorkflowTraceEntry[] = [];
    const proposedOperations: PendingOperation[] = [];
    const fixtureLog: FixtureLogEntry[] = [];
    let modelComposeCount = 0;
    let state = createRunState(plan, { runId, mode: 'simulation' });

    try {
      let result = advance(plan, state, { type: 'start', at: nextAt(), event });
      state = result.state;
      trace.push(...result.trace);
      proposedOperations.push(...result.pending);

      while (state.status === 'waiting') {
        const operation = result.pending[0];
        if (!operation) {
          state = {
            ...state,
            status: 'failed',
            error: workflowIssue('simulation_stalled', '$', 'run is waiting without a pending operation'),
          };
          break;
        }
        if (operation.effect === 'compose') modelComposeCount += 1;
        const observation = observeWithFixture(operation, fixtures, nextAt());
        fixtureLog.push(observation.fixture);
        result = advance(plan, state, observation.event);
        state = result.state;
        trace.push(...result.trace);
        proposedOperations.push(...result.pending);
      }
    } catch (error) {
      const issue =
        error instanceof WorkflowRuntimeError
          ? workflowIssue(error.code, '$', error.message)
          : workflowIssue('simulation_error', '$', error instanceof Error ? error.message : 'unknown error');
      state = { ...state, status: 'failed', error: issue, pendingNodeId: null };
    }

    runs.push({
      runId,
      eventId: event.eventId,
      status: state.status,
      outcome: state.outcome,
      error: state.error,
      trace,
      proposedOperations,
      fixtureLog,
      modelComposeCount,
      outputs: state.outputs,
    });
  }

  return {
    mode: 'simulation',
    definitionId: plan.definitionId,
    revision: plan.revision,
    digest: plan.digest,
    runs,
    duplicateEventIds,
  };
}

function validateScenario(scenario: SimulationScenario): void {
  if (typeof scenario.runIdPrefix !== 'string' || scenario.runIdPrefix === '') {
    throw new WorkflowRuntimeError('invalid_scenario', 'scenario.runIdPrefix is required');
  }
  if (!Array.isArray(scenario.events)) {
    throw new WorkflowRuntimeError('invalid_scenario', 'scenario.events must be an array');
  }
  if (!isPlainObject(scenario.clock) || typeof scenario.clock.startedAt !== 'string') {
    throw new WorkflowRuntimeError('invalid_scenario', 'scenario.clock.startedAt is required');
  }
  if (!Number.isFinite(Date.parse(scenario.clock.startedAt))) {
    throw new WorkflowRuntimeError('invalid_scenario', 'scenario.clock.startedAt must be an ISO timestamp');
  }
  if (!Number.isFinite(scenario.clock.stepMs) || scenario.clock.stepMs < 0) {
    throw new WorkflowRuntimeError('invalid_scenario', 'scenario.clock.stepMs must be a non-negative number');
  }
}

function observeWithFixture(
  operation: PendingOperation,
  fixtures: SimulationFixtures,
  at: string,
): { event: WorkflowEvent; fixture: FixtureLogEntry } {
  const fixture = ownValue(fixtures.nodes, operation.nodeId);
  if (!fixture) {
    return {
      event: {
        type: 'observation',
        at,
        nodeId: operation.nodeId,
        status: 'failed',
        error: workflowIssue('fixture_missing', `fixtures.nodes.${operation.nodeId}`, 'no fixture was supplied for this node'),
      },
      fixture: { nodeId: operation.nodeId, result: 'missing', code: 'fixture_missing' },
    };
  }
  if (fixture.status === 'failed') {
    return {
      event: { type: 'observation', at, nodeId: operation.nodeId, status: 'failed', error: fixture.error },
      fixture: { nodeId: operation.nodeId, result: 'failed', code: fixture.error.code },
    };
  }
  const withReceipt = applySimulationReceipt(operation, fixture.outputs);
  if (!withReceipt.ok) {
    return {
      event: { type: 'observation', at, nodeId: operation.nodeId, status: 'failed', error: withReceipt.issue },
      fixture: { nodeId: operation.nodeId, result: 'failed', code: withReceipt.issue.code },
    };
  }
  return {
    event: { type: 'observation', at, nodeId: operation.nodeId, status: 'succeeded', outputs: withReceipt.outputs },
    fixture: { nodeId: operation.nodeId, result: 'ok' },
  };
}

function applySimulationReceipt(
  operation: PendingOperation,
  outputs: Readonly<Record<string, WorkflowValue>>,
): { ok: true; outputs: Record<string, WorkflowValue> } | { ok: false; issue: WorkflowIssue } {
  if (operation.effect !== 'save' && operation.effect !== 'deliver') {
    return { ok: true, outputs: cloneJsonValue({ ...outputs }) };
  }
  const receiptKey = operation.effect === 'save' ? 'saveReceipt' : 'deliveryReceipt';
  const receipt = ownValue(outputs, receiptKey);
  if (!isPlainObject(receipt)) {
    // The core reports `invalid_receipt`; the simulator does not invent one.
    return { ok: true, outputs: cloneJsonValue({ ...outputs }) };
  }
  if (ownValue(receipt, 'simulated') === false) {
    return {
      ok: false,
      issue: workflowIssue(
        'receipt_not_simulated',
        `nodes.${operation.nodeId}.${receiptKey}.simulated`,
        'simulation fixtures may not carry real receipts',
      ),
    };
  }
  return {
    ok: true,
    outputs: {
      ...cloneJsonValue({ ...outputs }),
      [receiptKey]: { ...cloneJsonValue(receipt), simulated: true },
    },
  };
}
