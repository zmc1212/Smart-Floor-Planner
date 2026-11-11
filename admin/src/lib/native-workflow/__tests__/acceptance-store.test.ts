import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import { publishAcceptanceDefinition } from '../live/acceptance-store';
import { createWorkflowService } from '../service';
import { createFileWorkflowStore } from '../store/file-store';
import { createStageReminderDefinition } from '../templates';
import type { WorkflowDefinition } from '../types';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function titledDraft(title: string): WorkflowDefinition {
  const definition = JSON.parse(JSON.stringify(createStageReminderDefinition())) as WorkflowDefinition;
  const node = definition.nodes.find((candidate) => candidate.nodeId === 'compose-deterministic');
  if (!node) throw new Error('missing compose node');
  (node as { config?: Record<string, unknown> }).config = { ...(node.config ?? {}), title };
  return definition;
}

test('publishing into the acceptance store leaves a normal unpublished draft byte-identical', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'b5-1-acceptance-store-'));
  const normalDir = path.join(root, 'normal');
  const acceptanceDir = path.join(root, 'acceptance');
  const normalFile = path.join(normalDir, 'stage-reminder.json');
  try {
    const normalStore = createFileWorkflowStore({ rootDir: normalDir });
    const normalService = createWorkflowService({ store: normalStore });
    await normalService.createFromTemplate('stage-reminder');
    const customTitle = '自定义未发布草稿标题';
    await normalService.saveDraft({
      definitionId: 'stage-reminder',
      definition: titledDraft(customTitle),
      expectedDraftRevision: 1,
    });

    const before = await readFile(normalFile);
    const beforeHash = sha256(before);

    const publication = await publishAcceptanceDefinition({
      storeDir: acceptanceDir,
      definitionId: 'stage-reminder',
      now: '2026-11-11T12:00:00.000Z',
    });
    assert.equal(publication.definitionId, 'stage-reminder');
    assert.equal(publication.revision, 1);
    assert.equal(publication.created, true);
    assert.match(publication.digest, /^[a-f0-9]{64}$/u);

    const after = await readFile(normalFile);
    assert.equal(sha256(after), beforeHash);
    assert.deepEqual(after, before);

    const normalRecord = await normalStore.get('stage-reminder');
    assert.ok(normalRecord);
    assert.equal(normalRecord.versions.length, 0, 'the normal store must stay unpublished');
    const compose = normalRecord.draft.definition.nodes.find((node) => node.nodeId === 'compose-deterministic');
    assert.equal((compose as { config?: Record<string, unknown> }).config?.title, customTitle);

    const acceptanceRecord = await createFileWorkflowStore({ rootDir: acceptanceDir }).get('stage-reminder');
    assert.ok(acceptanceRecord);
    assert.equal(acceptanceRecord.versions.length, 1);
    assert.equal(acceptanceRecord.versions[0]?.revision, 1);
    assert.equal(acceptanceRecord.versions[0]?.digest, publication.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the acceptance store refuses a definition id it does not own', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'b5-1-acceptance-store-'));
  try {
    await assert.rejects(
      publishAcceptanceDefinition({ storeDir: path.join(root, 'store'), definitionId: 'period-report-daily' }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'invalid_request'
        && error.status === 400,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
