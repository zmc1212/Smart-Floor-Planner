import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compileDefinition, createStageReminderDefinition, type WorkflowDefinition } from '../index';
import { WorkflowOperationError } from '../errors';
import { createFileWorkflowStore } from '../store/file-store';
import { createMemoryWorkflowStore } from '../store/memory-store';
import type { PublishedWorkflowVersion, WorkflowDefinitionStore } from '../store/types';

const now = '2026-11-11T12:00:00.000Z';

function publishedVersion(definition: WorkflowDefinition): PublishedWorkflowVersion {
  const plan = compileDefinition(definition);
  return {
    revision: definition.revision,
    digest: plan.digest,
    definition,
    publishedAt: now,
    nodeVersions: Object.fromEntries(Object.values(plan.nodes).map((node) => [node.nodeId, node.nodeVersion])),
  };
}

function isOperationError(code: string) {
  return (error: unknown) => error instanceof WorkflowOperationError && error.code === code;
}

async function exerciseStore(store: WorkflowDefinitionStore): Promise<void> {
  const template = createStageReminderDefinition();
  const created = await store.create({ definition: template, now });
  assert.equal(created.draft.draftRevision, 1);
  assert.equal(created.versions.length, 0);
  assert.deepEqual(await store.list(), [{
    definitionId: 'stage-reminder',
    eventType: 'stage_changed',
    periodKind: null,
    latestPublishedRevision: null,
    draftRevision: 1,
    updatedAt: now,
    publishedAt: null,
  }]);

  await assert.rejects(store.create({ definition: template, now }), isOperationError('definition_exists'));
  await assert.rejects(
    store.saveDraft({ definitionId: 'missing', definition: template, expectedDraftRevision: 1, now }),
    isOperationError('definition_not_found'),
  );
  await assert.rejects(
    store.saveDraft({ definitionId: 'stage-reminder', definition: template, expectedDraftRevision: 2, now }),
    (error: unknown) =>
      error instanceof WorkflowOperationError
      && error.code === 'draft_conflict'
      && (error.details as { currentDraftRevision?: number }).currentDraftRevision === 1,
  );

  const saved = await store.saveDraft({ definitionId: 'stage-reminder', definition: template, expectedDraftRevision: 1, now });
  assert.equal(saved.draft.draftRevision, 2);

  const version = publishedVersion(template);
  const published = await store.appendVersion({ definitionId: 'stage-reminder', expectedDraftRevision: 2, version });
  assert.equal(published.versions.length, 1);
  assert.equal(published.versions[0]?.revision, 1);

  await assert.rejects(
    store.appendVersion({ definitionId: 'stage-reminder', expectedDraftRevision: 2, version }),
    isOperationError('version_conflict'),
  );

  const returned = await store.get('stage-reminder');
  assert.ok(returned);
  (returned.versions[0]!.definition.nodes[0] as { nodeId: string }).nodeId = 'tampered';
  const reloaded = await store.get('stage-reminder');
  assert.equal(reloaded?.versions[0]?.definition.nodes[0]?.nodeId, 'trigger-1');
}

test('memory store enforces draft conflicts and immutable versions', async () => {
  await exerciseStore(createMemoryWorkflowStore());
});

test('file store persists drafts and published versions across instances', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'native-workflow-store-'));
  try {
    const store = createFileWorkflowStore({ rootDir });
    await exerciseStore(store);

    const reopened = createFileWorkflowStore({ rootDir });
    const record = await reopened.get('stage-reminder');
    assert.equal(record?.draft.draftRevision, 2);
    assert.equal(record?.versions[0]?.revision, 1);
    assert.equal((await reopened.list())[0]?.latestPublishedRevision, 1);
    const files = await readFile(path.join(rootDir, 'stage-reminder.json'), 'utf8');
    assert.match(files, /"storeVersion": 1/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('file store reports corrupt files explicitly', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'native-workflow-corrupt-'));
  try {
    const store = createFileWorkflowStore({ rootDir });
    await store.create({ definition: createStageReminderDefinition(), now });
    await writeFile(path.join(rootDir, 'stage-reminder.json'), '{not-json', 'utf8');
    await assert.rejects(store.get('stage-reminder'), isOperationError('store_corrupt'));
    await assert.rejects(store.list(), isOperationError('store_corrupt'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
