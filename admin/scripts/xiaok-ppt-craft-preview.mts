import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '../src/db/transaction';
import type { Row } from '../src/db/repositories/assistant-repository';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const require = createRequire(path.resolve('package.json'));
require('@next/env').loadEnvConfig(process.cwd(), true);
const root = path.resolve('..');
const enterpriseId = '1454';
const category = 'synthetic-xiaok-ppt-craft-20261107';
const evidenceRoot = path.join(root, 'tmp/xiaok-mineru-fastgpt-preview-20261107');
const out = path.join(evidenceRoot, 'craft-only');
const fixturePath = path.resolve('scripts/fixtures/xiaok-ppt-craft-preview.json');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixture = read(fixturePath);
const previous = read(path.join(evidenceRoot, 'ocr-followup/preparation.json'));
assert.equal(fixture.protocol, 'xiaok-ppt-craft-preview-v1');
assert.equal(hash(path.join(root, fixture.source.file)), fixture.source.sha256);
assert.equal(previous.status, 'ready');
assert.equal(previous.enterpriseId, enterpriseId);
assert.equal(previous.parts.length, 28);
assert.match(previous.prefix, /^synthetic-mineru-preview-[a-f0-9-]+$/);
assert.equal(new Set(previous.parts.map((part: { documentId: string }) => part.documentId)).size, 28);
assert.deepEqual(fixture.drafts.map((draft: { slide: number }) => draft.slide), [17, 18, 19, 21]);

process.env.DATABASE_URL = read(path.join(root, 'tmp/xiaok-vector/connection.private.json')).DATABASE_URL;
process.env.XIAOK_FASTGPT_RETRIEVAL_FILE = '';
const target = new URL(process.env.DATABASE_URL!);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '55432');
assert.equal(target.pathname, '/xiaok_embedding_eval');

const { withTenantTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { ConversationService } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { claimKnowledgeJob, runKnowledgeJob } = require(path.resolve('src/lib/assistant/knowledge/index-worker.ts'));
const { closePostgresPool } = require(path.resolve('src/lib/postgresql.ts'));
const tenant = <T,>(run: (tx: PostgresTransaction) => Promise<T>): Promise<T> => withTenantTransaction(enterpriseId, run);
const manager = { enterpriseId, adminId: previous.adminIds[0] };
const service = new KnowledgeService(manager);
const owner = new ConversationService({ enterpriseId, principal: { kind: 'admin', adminId: manager.adminId },
  contextVersion: 1, capabilities: ['assistant.preview.self'] });
const report = {
  status: 'preparing', protocol: fixture.protocol, enterpriseId, prefix: previous.prefix, adminIds: previous.adminIds,
  sourceSha256: fixture.source.sha256, manifestSha256: hash(fixturePath), category,
  retired: [] as Array<{ documentId: string; version: number }>,
  parts: [] as Array<{ page: number; documentId: string; versionId: string; contentHash: string; indexJobId?: string }>,
  oldPreviewRejected: false, unpublished: 0, error: '', restored: false,
};
fs.mkdirSync(out, { recursive: true });
const reportPath = path.join(out, 'preparation.json');
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
assert.ok(!fs.existsSync(reportPath), 'Read the retained preparation before another attempt');
const settings = () => tenant<Row>(tx => one(tx, sql`select enabled,agent_config,active_index_profile_id
  from app.assistant_enterprise_settings where enterprise_id=${enterpriseId}`));
let release: Awaited<ReturnType<typeof lockAssistantAcceptance>> | undefined;
let restoreEnabled = false;

try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  const before = await settings();
  assert.equal(before.enabled, false);
  assert.ok(before.active_index_profile_id);
  const publishedStaff = await tenant<Row[]>(tx => rows(tx, sql`select id from app.assistant_knowledge_documents
    where enterprise_id=${enterpriseId} and status='active' and audience='staff_internal' and published_version_id is not null`));
  assert.equal(publishedStaff.length, 0, 'The staff preview must have only the selected PPT drafts');

  // Validate every old document before changing any of them.
  const old = [];
  for (const part of previous.parts) {
    const detail = await service.execute('detail', { documentId: part.documentId });
    const d = detail.document;
    assert.equal(d.category, previous.prefix);
    assert.equal(d.audience, 'staff_internal');
    assert.equal(d.source_type, 'file');
    assert.ok(['draft', 'retired'].includes(d.status));
    assert.equal(d.published_version_id, null);
    assert.ok(detail.versions.every((v: { published_at: unknown }) => v.published_at === null));
    assert.ok(detail.versions.some((v: { id: unknown }) => String(v.id) === part.versionId));
    old.push(d);
  }

  save();
  for (const d of old) {
    await release.assertHeld();
    const documentId = String(d.id);
    const retired = d.status === 'retired' ? d : await service.execute('retire', {
      documentId, expectedVersion: Number(d.version),
    }, randomUUID());
    assert.equal(retired.status, 'retired');
    report.retired.push({ documentId, version: Number(retired.version) });
    save();
  }

  await tenant(tx => tx.execute(sql`update app.assistant_enterprise_settings
    set enabled=true,version=version+1 where enterprise_id=${enterpriseId}`));
  restoreEnabled = true;
  const retiredReady = previous.parts.find((part: { indexed?: boolean }) => part.indexed);
  assert.ok(retiredReady);
  await assert.rejects(() => owner.create(randomUUID(), {
    audience: 'staff_internal', draftVersionIds: [retiredReady.versionId],
  }), (error: unknown) => (error as { code?: string }).code === 'knowledge_not_ready');
  report.oldPreviewRejected = true;

  for (const source of fixture.drafts) {
    await release.assertHeld();
    const existing = await tenant<Row[]>(tx => rows(tx, sql`select id from app.assistant_knowledge_documents
      where enterprise_id=${enterpriseId} and category=${category} and title=${source.title}`));
    assert.ok(existing.length <= 1);
    const detail = existing.length
      ? await service.execute('detail', { documentId: String(existing[0].id) })
      : await service.execute('create', { sourceType: 'manual_text', audience: 'staff_internal',
        category, title: source.title, body: source.body }, randomUUID());
    const document = detail.document;
    const draft = detail.draft ?? detail.versions[0];
    assert.equal(document.status, 'draft');
    assert.equal(document.audience, 'staff_internal');
    assert.equal(document.source_type, 'manual_text');
    assert.equal(document.published_version_id, null);
    assert.equal(draft.published_at, null);
    assert.equal(draft.body, source.body);
    const part = { page: source.slide, documentId: String(document.id), versionId: String(draft.id),
      contentHash: draft.content_hash, indexJobId: undefined as string | undefined };
    report.parts.push(part);
    save();
    if (draft.index_status !== 'ready') {
      assert.equal(draft.index_status, 'pending', 'Do not replay a failed or unknown index attempt');
      const index = await service.execute('index', { documentId: part.documentId, versionId: part.versionId,
        expectedEditVersion: Number(draft.edit_version) }, randomUUID());
      part.indexJobId = index.jobId;
      save();
      const lease = await claimKnowledgeJob();
      assert.equal(lease?.jobId, index.jobId);
      await runKnowledgeJob(lease);
      const job = await service.execute('job', { jobId: index.jobId });
      assert.equal(job.status, 'succeeded', String(job.last_error));
    }
    const ready = (await service.execute('detail', { documentId: part.documentId })).versions[0];
    assert.equal(ready.index_status, 'ready');
    assert.equal(ready.indexed_hash, part.contentHash);
    assert.equal(String(ready.index_profile_id), String(before.active_index_profile_id));
    assert.equal(ready.published_at, null);
    report.unpublished++;
    save();
  }
  assert.equal(hash(fixturePath), report.manifestSha256);
  assert.equal(hash(path.join(root, fixture.source.file)), report.sourceSha256);
  report.status = 'ready';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  try {
    if (restoreEnabled) await tenant(tx => tx.execute(sql`update app.assistant_enterprise_settings
      set enabled=false,version=version+1 where enterprise_id=${enterpriseId}`));
    report.restored = !restoreEnabled || (await settings()).enabled === false;
  } finally {
    save();
    await release?.();
    await closePostgresPool();
  }
  console.log(JSON.stringify({ status: report.status, retired: report.retired.length, drafts: report.unpublished,
    oldPreviewRejected: report.oldPreviewRejected, restored: report.restored, error: report.error }));
}
