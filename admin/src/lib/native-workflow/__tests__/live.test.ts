import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createStageReminderDefinition, type JsonValue, type WorkflowDefinition, type WorkflowValue } from '../index';
import { createFileWorkflowRunStore, createMemoryWorkflowRunStore } from '../live/run-store';
import { runPublishedLive } from '../live/runner';
import {
  LiveOperationFailure,
  LiveOperationUnknownError,
  type LiveOperationPorts,
  type LiveRunContext,
  type LiveRunRecord,
} from '../live/types';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';
import type { PublishedWorkflowVersion } from '../store/types';

const now = '2026-11-11T12:00:00.000Z';
const event = {
  eventId: 'b4-evt-stage-0001',
  eventType: 'stage_changed' as const,
  occurredAt: '2026-11-11T11:58:00.000Z',
  stageKey: 'plumbing',
  stageLabel: '水路',
};

function mutableTemplate(): WorkflowDefinition {
  return JSON.parse(JSON.stringify(createStageReminderDefinition())) as WorkflowDefinition;
}

function setTemplate(definition: WorkflowDefinition, template: string): WorkflowDefinition {
  const node = definition.nodes.find((candidate) => candidate.nodeId === 'compose-deterministic');
  assert.ok(node);
  (node as { config?: Record<string, JsonValue> }).config = { ...(node.config ?? {}), template };
  return definition;
}

async function publishFirst(): Promise<{
  service: ReturnType<typeof createWorkflowService>;
  version: PublishedWorkflowVersion;
}> {
  const service = createWorkflowService({ store: createMemoryWorkflowStore(), now: () => now });
  await service.createFromTemplate('stage-reminder');
  const published = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 1 });
  return { service, version: published.version };
}

interface World {
  ports: LiveOperationPorts;
  readonly calls: string[];
  saves: number;
  deliveries: number;
  bodies: string[];
  saveReceipts: Map<string, string>;
  deliveryReceipts: Map<string, string>;
}

function makeWorld(overrides: {
  failSave?: boolean;
  failDelivery?: boolean;
  denyRead?: boolean;
  unknownSave?: boolean;
} = {}): World {
  const world: World = {
    calls: [],
    saves: 0,
    deliveries: 0,
    bodies: [],
    saveReceipts: new Map(),
    deliveryReceipts: new Map(),
    ports: undefined as unknown as LiveOperationPorts,
  };
  const ports: LiveOperationPorts = {
    async execute(operation, context: LiveRunContext): Promise<Record<string, WorkflowValue>> {
      world.calls.push(operation.capabilityRef);
      if (operation.capabilityRef === 'read.project_context') {
        if (overrides.denyRead) {
          throw new LiveOperationFailure({
            code: 'construction_forbidden',
            path: 'nodes.read-context',
            message: 'permission revoked',
          });
        }
        return {
          stageKey: context.event.stageKey ?? '',
          stageLabel: context.event.stageLabel ?? '',
          stageKnown: true,
          subscribed: true,
          receivers: {
            scope: 'customer_conversation',
            projectId: context.projectId,
            conversationId: 'conversation-1',
            customerUserId: 'customer-1',
          },
          receiverCount: 1,
        };
      }
      if (operation.capabilityRef === 'read.enterprise_craft') {
        return { craftEnabled: false, craftSummary: '' };
      }
      if (operation.capabilityRef === 'save.stage_reminder') {
        world.bodies.push(String(operation.input.body ?? ''));
        if (overrides.unknownSave) {
          throw new LiveOperationUnknownError({
            code: 'live_operation_unknown',
            path: 'nodes.save-deterministic',
            message: 'commit outcome unknown',
          });
        }
        const businessKey = context.event.eventId;
        const existing = world.saveReceipts.get(businessKey);
        if (existing) {
          return {
            saved: true,
            saveReceipt: { receiptId: existing, simulated: false, reused: true },
          };
        }
        world.saves += 1;
        const receiptId = `outbox-${world.saves}`;
        world.saveReceipts.set(businessKey, receiptId);
        if (overrides.failSave) {
          return { saved: false, saveReceipt: { receiptId: '', simulated: false } };
        }
        return { saved: true, saveReceipt: { receiptId, simulated: false, reused: false } };
      }
      if (operation.capabilityRef === 'deliver.inapp') {
        const businessKey = context.event.eventId;
        const existing = world.deliveryReceipts.get(businessKey);
        if (existing) {
          return {
            delivered: true,
            deliveryReceipt: { receiptId: existing, simulated: false, reused: true },
          };
        }
        world.deliveries += 1;
        const receiptId = `delivery-${world.deliveries}`;
        world.deliveryReceipts.set(businessKey, receiptId);
        if (overrides.failDelivery) {
          return { delivered: false, deliveryReceipt: { receiptId: '', simulated: false, status: 'failed' } };
        }
        return {
          delivered: true,
          deliveryReceipt: { receiptId, simulated: false },
        };
      }
      throw new LiveOperationFailure({
        code: 'unsupported_live_capability',
        path: `nodes.${operation.nodeId}`,
        message: operation.capabilityRef,
      });
    },
  };
  world.ports = ports;
  return world;
}

async function run(
  version: PublishedWorkflowVersion,
  world: World,
  runId = 'run-1',
  eventOverride = event,
) {
  return runPublishedLive({
    published: version,
    enterpriseId: '1454',
    projectId: 'project-1',
    event: eventOverride,
    ports: world.ports,
    store: createMemoryWorkflowRunStore(),
    runId,
    now: () => now,
  });
}

test('live run completes the deterministic knowledge-off path with real receipts', async () => {
  const { version } = await publishFirst();
  const world = makeWorld();
  const record = await run(version, world);

  assert.equal(record.status, 'completed');
  assert.equal(record.state.outcome, 'delivered');
  assert.deepEqual(world.calls, [
    'read.project_context',
    'read.enterprise_craft',
    'save.stage_reminder',
    'deliver.inapp',
  ]);
  assert.equal(world.calls.includes('compose.stage_reminder_model'), false);
  assert.equal(record.binding.revision, 1);
  assert.equal(record.binding.digest, version.digest);
  assert.equal(world.saves, 1);
  assert.equal(world.deliveries, 1);
  assert.equal(record.operations.find((operation) => operation.effect === 'save')?.outcome, 'succeeded');
  assert.equal(record.operations.find((operation) => operation.effect === 'deliver')?.outcome, 'succeeded');
});

test('save failure stops before delivery and preserves the failed run', async () => {
  const { version } = await publishFirst();
  const world = makeWorld({ failSave: true });
  const record = await run(version, world);

  assert.equal(record.status, 'failed');
  assert.equal(record.state.error?.code, 'save_not_confirmed');
  assert.equal(world.saves, 1);
  assert.equal(world.deliveries, 0);
  assert.equal(world.calls.includes('deliver.inapp'), false);
  assert.equal(record.operations.find((operation) => operation.effect === 'save')?.outcome, 'succeeded');
});

test('delivery failure keeps the saved outbox record and does not claim delivery', async () => {
  const { version } = await publishFirst();
  const world = makeWorld({ failDelivery: true });
  const record = await run(version, world);

  assert.equal(record.status, 'failed');
  assert.equal(record.state.error?.code, 'delivery_not_confirmed');
  assert.equal(world.saves, 1);
  assert.equal(world.deliveries, 1);
  assert.ok(world.saveReceipts.get(event.eventId));
  const saved = record.operations.find((operation) => operation.effect === 'save');
  assert.equal((saved?.outputs?.saveReceipt as { receiptId?: string }).receiptId, 'outbox-1');
  const failed = record.operations.find((operation) => operation.effect === 'deliver');
  assert.equal(failed?.outcome, 'succeeded');
  assert.equal((failed?.outputs?.deliveryReceipt as { status?: string }).status, 'failed');
});

test('permission denial fails the run before any business write', async () => {
  const { version } = await publishFirst();
  const world = makeWorld({ denyRead: true });
  const record = await run(version, world);

  assert.equal(record.status, 'failed');
  assert.equal(record.state.error?.code, 'construction_forbidden');
  assert.equal(world.saves, 0);
  assert.equal(world.deliveries, 0);
});

test('an unknown outcome stops immediately and is never retried', async () => {
  const { version } = await publishFirst();
  const store = createMemoryWorkflowRunStore();
  const world = makeWorld({ unknownSave: true });
  const record = await runPublishedLive({
    published: version,
    enterpriseId: '1454',
    projectId: 'project-1',
    event,
    ports: world.ports,
    store,
    runId: 'run-unknown',
    now: () => now,
  });

  assert.equal(record.status, 'unknown');
  assert.equal(world.calls.filter((call) => call === 'save.stage_reminder').length, 1);
  assert.equal(world.deliveries, 0);
  assert.equal(record.operations.at(-1)?.outcome, 'unknown');
  const stored = await store.get('run-unknown');
  assert.equal(stored?.status, 'unknown');
});

test('a live run stays bound to its published revision after a newer publish', async () => {
  const { service, version: first } = await publishFirst();
  const edited = setTemplate(mutableTemplate(), '第一版：{{stageLabel}}');
  await service.saveDraft({ definitionId: 'stage-reminder', definition: edited, expectedDraftRevision: 1 });
  const second = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 2 });
  const changed = setTemplate(mutableTemplate(), '第二版：{{stageLabel}}');
  await service.saveDraft({ definitionId: 'stage-reminder', definition: changed, expectedDraftRevision: 2 });
  const third = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 3 });

  assert.notEqual(second.version.digest, first.digest);
  assert.notEqual(third.version.digest, second.version.digest);

  const world = makeWorld();
  const record = await run(first, world);
  assert.equal(record.status, 'completed');
  assert.equal(record.binding.revision, 1);
  assert.equal(record.binding.digest, first.digest);
  assert.deepEqual(record.binding.nodeVersions, first.nodeVersions);
  assert.equal(world.bodies[0], '项目已进入水路阶段，请按既定安排关注本阶段施工注意事项。');
});

test('the same business event does not create a second save or delivery', async () => {
  const { version } = await publishFirst();
  const world = makeWorld();
  const firstRun = await run(version, world, 'run-duplicate-1');
  const secondRun = await run(version, world, 'run-duplicate-2');

  assert.equal(firstRun.status, 'completed');
  assert.equal(secondRun.status, 'completed');
  assert.equal(world.saves, 1);
  assert.equal(world.deliveries, 1);
  const secondSave = secondRun.operations.find((operation) => operation.effect === 'save');
  assert.equal((secondSave?.outputs?.saveReceipt as { reused?: boolean }).reused, true);
});

test('file run store persists the version binding and lists records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'native-workflow-runs-'));
  try {
    const store = createFileWorkflowRunStore({ rootDir: dir });
    const record: LiveRunRecord = {
      binding: {
        runId: 'run-file-1',
        definitionId: 'stage-reminder',
        revision: 1,
        digest: 'a'.repeat(64),
        nodeVersions: { 'trigger-1': 'trigger@1/trigger.stage_changed' },
        event,
      },
      enterpriseId: '1454',
      projectId: 'project-1',
      status: 'completed',
      state: {
        runId: 'run-file-1',
        definitionId: 'stage-reminder',
        revision: 1,
        digest: 'a'.repeat(64),
        mode: 'live',
        status: 'completed',
        currentNodeId: null,
        pendingNodeId: null,
        visitedNodeIds: [],
        outputs: {},
        processedEventIds: [event.eventId],
        error: null,
        outcome: 'delivered',
        stepCount: 1,
        traceSeq: 1,
      },
      trace: [],
      operations: [],
      createdAt: now,
      updatedAt: now,
    };
    await store.save(record);
    const stored = await store.get('run-file-1');
    assert.equal(stored?.binding.digest, 'a'.repeat(64));
    assert.equal(stored?.binding.revision, 1);
    assert.equal((await store.list()).some((candidate) => candidate.binding.runId === 'run-file-1'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
