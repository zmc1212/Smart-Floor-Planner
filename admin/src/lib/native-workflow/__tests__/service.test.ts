import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPeriodReportDefinition,
  createStageReminderDefinition,
  WorkflowDefinitionError,
  type JsonValue,
  type WorkflowDefinition,
} from '../index';
import { WorkflowOperationError } from '../errors';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';

const now = '2026-11-11T12:00:00.000Z';

function mutableTemplate(): WorkflowDefinition {
  return JSON.parse(JSON.stringify(createStageReminderDefinition())) as WorkflowDefinition;
}

function setTitle(definition: WorkflowDefinition, title: string): WorkflowDefinition {
  const node = definition.nodes.find((candidate) => candidate.nodeId === 'compose-deterministic');
  assert.ok(node);
  (node as { config?: Record<string, JsonValue> }).config = { ...(node.config ?? {}), title };
  return definition;
}

function setTemplate(definition: WorkflowDefinition, template: string): WorkflowDefinition {
  const node = definition.nodes.find((candidate) => candidate.nodeId === 'compose-deterministic');
  assert.ok(node);
  (node as { config?: Record<string, JsonValue> }).config = { ...(node.config ?? {}), template };
  return definition;
}

function isOperationError(code: string) {
  return (error: unknown) => error instanceof WorkflowOperationError && error.code === code;
}

test('service creates template drafts and enforces optimistic draft conflicts', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore(), now: () => now });
  const created = await service.createFromTemplate('stage-reminder');
  assert.equal(created.draft.draftRevision, 1);
  assert.equal(created.draft.definition.revision, 1);
  await assert.rejects(service.createFromTemplate('stage-reminder'), isOperationError('definition_exists'));
  await assert.rejects(service.createFromTemplate('unknown' as never), isOperationError('invalid_request'));

  const saved = await service.saveDraft({
    definitionId: 'stage-reminder',
    definition: { ...mutableTemplate(), definitionId: 'hijacked', revision: 99 },
    expectedDraftRevision: 1,
  });
  assert.equal(saved.draft.draftRevision, 2);
  assert.equal(saved.draft.definition.definitionId, 'stage-reminder');
  assert.equal(saved.draft.definition.revision, 1);

  await assert.rejects(
    service.saveDraft({ definitionId: 'stage-reminder', definition: mutableTemplate(), expectedDraftRevision: 1 }),
    (error: unknown) =>
      error instanceof WorkflowOperationError
      && error.code === 'draft_conflict'
      && (error.details as { currentDraftRevision?: number }).currentDraftRevision === 2,
  );

  const invalid = mutableTemplate();
  (invalid.nodes as unknown as Array<{ nodeId: string }>).push({ nodeId: 'trigger-1' });
  await assert.rejects(
    service.saveDraft({ definitionId: 'stage-reminder', definition: invalid, expectedDraftRevision: 2 }),
    WorkflowDefinitionError,
  );
  assert.equal((await service.getDefinition('stage-reminder')).record.draft.draftRevision, 2);
});

test('publishing compiles once, keeps versions immutable and creates a new version only after edits', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore(), now: () => now });
  await service.createFromTemplate('stage-reminder');
  const first = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 1 });
  assert.equal(first.created, true);
  assert.equal(first.version.revision, 1);
  assert.match(first.version.digest, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(first.version.nodeVersions).length, 12);

  const unchanged = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 1 });
  assert.equal(unchanged.created, false);
  assert.equal(unchanged.version.revision, 1);
  assert.equal(unchanged.record.versions.length, 1);

  const edited = setTitle(mutableTemplate(), '阶段提醒（第二版）');
  const saved = await service.saveDraft({ definitionId: 'stage-reminder', definition: edited, expectedDraftRevision: 1 });
  assert.equal(saved.draft.draftRevision, 2);
  assert.equal(saved.draft.definition.revision, 2);

  const second = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 2 });
  assert.equal(second.created, true);
  assert.equal(second.version.revision, 2);
  assert.equal(second.record.versions.length, 2);
  assert.equal(second.record.versions[0]?.digest, first.version.digest);
  assert.equal(
    (second.record.versions[0]?.definition.nodes.find((node) => node.nodeId === 'compose-deterministic')?.config as { title?: string }).title,
    '阶段提醒',
  );
  assert.equal(
    (second.record.versions[1]?.definition.nodes.find((node) => node.nodeId === 'compose-deterministic')?.config as { title?: string }).title,
    '阶段提醒（第二版）',
  );
});

test('simulation debugging runs draft or a fixed published revision and keeps simulation markers', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore(), now: () => now });
  await service.createFromTemplate('stage-reminder');
  const first = await service.publishDraft({ definitionId: 'stage-reminder', expectedDraftRevision: 1 });

  const draftRun = await service.simulate({ definitionId: 'stage-reminder', fixtureSetId: 'stage-normal' });
  assert.equal(draftRun.source, 'draft');
  assert.equal(draftRun.simulation.mode, 'simulation');
  assert.equal(draftRun.simulation.runs[0]?.status, 'completed');
  assert.equal(draftRun.simulation.runs[0]?.outcome, 'delivered');
  assert.ok(draftRun.simulation.runs[0]?.trace.every((entry) => entry.mode === 'simulation'));
  const saveReceipt = draftRun.simulation.runs[0]?.outputs['save-model']?.saveReceipt;
  assert.equal((saveReceipt as { simulated?: boolean }).simulated, true);

  await service.saveDraft({
    definitionId: 'stage-reminder',
    definition: setTitle(mutableTemplate(), '阶段提醒（第二版）'),
    expectedDraftRevision: 1,
  });
  const publishedRun = await service.simulate({
    definitionId: 'stage-reminder',
    source: 'published',
    revision: 1,
    fixtureSetId: 'stage-normal',
  });
  assert.equal(publishedRun.source, 'published');
  assert.equal(publishedRun.simulation.digest, first.version.digest);
  assert.equal(publishedRun.simulation.revision, 1);

  const failed = await service.simulate({ definitionId: 'stage-reminder', fixtureSetId: 'stage-save-failed' });
  assert.equal(failed.simulation.runs[0]?.status, 'failed');
  assert.equal(failed.simulation.runs[0]?.error?.code, 'save_failed');

  await assert.rejects(
    service.simulate({ definitionId: 'stage-reminder', fixtureSetId: 'report-weekly-normal' }),
    isOperationError('fixture_incompatible'),
  );
  await assert.rejects(
    service.simulate({ definitionId: 'stage-reminder', fixtureSetId: 'missing-fixture' }),
    isOperationError('fixture_not_found'),
  );
  await assert.rejects(
    service.simulate({ definitionId: 'stage-reminder', source: 'published', revision: 9, fixtureSetId: 'stage-normal' }),
    isOperationError('version_not_found'),
  );
});

test('service rejects invalid drafts and unknown definitions', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore(), now: () => now });
  await service.createFromTemplate('period-report-daily');
  const broken = mutableTemplate();
  (broken.nodes as unknown as Array<{ nodeId: string }>).push({ nodeId: 'trigger-1' });
  await assert.rejects(
    service.saveDraft({ definitionId: 'period-report-daily', definition: broken, expectedDraftRevision: 1 }),
    WorkflowDefinitionError,
  );
  await assert.rejects(
    service.publishDraft({ definitionId: 'missing', expectedDraftRevision: 1 }),
    isOperationError('definition_not_found'),
  );
  await assert.rejects(
    service.simulate({ definitionId: 'period-report-daily', fixtureSetId: 'stage-normal' }),
    isOperationError('fixture_incompatible'),
  );
  const record = await service.getDefinition('period-report-daily');
  assert.equal(record.fixtureSets.filter(fixture => fixture.eventType !== 'specialist_followup').length, 14);
  assert.deepEqual(record.fixtureSets.filter(fixture => fixture.eventType === 'specialist_followup').map(fixture => fixture.id),
    ['waterproof-reviewed', 'waterproof-waiting']);
});

test('a stale retry cannot overwrite the other editor change', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore(), now: () => now });
  await service.createFromTemplate('stage-reminder');

  const pageA = setTitle(mutableTemplate(), 'A 页面标题');
  await service.saveDraft({ definitionId: 'stage-reminder', definition: pageA, expectedDraftRevision: 1 });

  const pageB = setTemplate(mutableTemplate(), '项目已进入{{stageLabel}}阶段（B 页面）');
  await assert.rejects(
    service.saveDraft({ definitionId: 'stage-reminder', definition: pageB, expectedDraftRevision: 1 }),
    isOperationError('draft_conflict'),
  );
  await assert.rejects(
    service.saveDraft({ definitionId: 'stage-reminder', definition: pageB, expectedDraftRevision: 1 }),
    isOperationError('draft_conflict'),
  );

  const record = await service.getDefinition('stage-reminder');
  const compose = record.record.draft.definition.nodes.find((node) => node.nodeId === 'compose-deterministic');
  const config = compose?.config as { title?: string; template?: string };
  assert.equal(config.title, 'A 页面标题');
  assert.equal(config.template, '{{stageLabel}}');
  assert.equal(record.record.draft.draftRevision, 2);
});

test('a published weekly revision keeps weekly fixtures after the draft becomes daily', async () => {
  const service = createWorkflowService({ store: createMemoryWorkflowStore(), now: () => now });
  await service.createFromTemplate('period-report-weekly');
  const published = await service.publishDraft({ definitionId: 'period-report-weekly', expectedDraftRevision: 1 });

  const saved = await service.saveDraft({
    definitionId: 'period-report-weekly',
    definition: createPeriodReportDefinition('daily'),
    expectedDraftRevision: 1,
  });
  assert.equal(saved.draft.definition.inputSchema.periodKind, 'daily');

  const weeklyRun = await service.simulate({
    definitionId: 'period-report-weekly',
    source: 'published',
    revision: 1,
    fixtureSetId: 'report-weekly-normal',
  });
  assert.equal(weeklyRun.simulation.runs[0]?.status, 'completed');
  assert.equal(weeklyRun.simulation.digest, published.version.digest);
  await assert.rejects(
    service.simulate({
      definitionId: 'period-report-weekly',
      source: 'published',
      revision: 1,
      fixtureSetId: 'report-daily-normal',
    }),
    isOperationError('fixture_incompatible'),
  );

  const dailyRun = await service.simulate({
    definitionId: 'period-report-weekly',
    fixtureSetId: 'report-daily-normal',
  });
  assert.equal(dailyRun.simulation.runs[0]?.status, 'completed');
});
