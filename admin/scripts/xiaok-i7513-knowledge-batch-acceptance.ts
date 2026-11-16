/** Isolated PG17 acceptance with a synthetic Bailian transport and per-run tenants. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db/repositories/assistant-repository';
import { assistantCounts, deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { claimJob, failRun } from '@/lib/assistant/infrastructure/job-queue';
import { assistantWorkerPreflight } from '@/lib/assistant/infrastructure/worker-preflight';
import { workerTaskScope } from '@/lib/assistant/infrastructure/worker-scope';
import { advanceKnowledgeBatches } from '@/lib/assistant/knowledge/batch-worker';
import { claimKnowledgeJob, processKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { processManagedKnowledgeCleanup } from '@/lib/assistant/knowledge/managed-cleanup';
import { KnowledgeOperations } from '@/lib/assistant/knowledge/operations';
import { KnowledgeService, type KnowledgeActor } from '@/lib/assistant/knowledge/service';
import { evaluateWorkerSafetyGate } from '@/lib/xiaok-v1/worker-safety-gate';

const runId = randomUUID();
const output = path.resolve(process.argv.find(value => value.startsWith('--output='))?.slice(9)
  || `../tmp/xiaok-i7513/${runId}`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(output);
const restoredDatabase = process.argv.find(value => value.startsWith('--restore-db='))?.slice('--restore-db='.length);
const database = restoredDatabase ?? 'i745_f1_accept';
const port = restoredDatabase === undefined ? '55432' : '55436';
const user = 'sfp_app';
const workspaceId = `i7513-${runId}`;
const embeddingUrl = 'http://127.0.0.1/i7513/embeddings';
const evidence: {
  runId: string; target: string; startedAt: string; finishedAt?: string; scriptSha256: string;
  status: 'running' | 'passed' | 'failed' | 'not_run';
  checks: Array<{ id: string; status: 'passed' | 'failed' | 'not_run'; evidence: unknown }>;
} = {
  runId, target: `127.0.0.1:${port}/${database}`, startedAt: new Date().toISOString(), status: 'running',
  scriptSha256: createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'), checks: [],
};

function save() {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
}

function record(id: string, status: 'passed' | 'failed' | 'not_run', value: unknown) {
  evidence.checks.push({ id, status, evidence: value });
  console.log(`${id}: ${status}`);
  save();
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: 'UnknownError' };
  const cause = (error.cause ?? error) as Error & { code?: string; constraint?: string };
  return { name: cause.name, code: cause.code, constraint: cause.constraint, message: cause.message.split('\n')[0] };
}

function configure() {
  let url: URL;
  if (restoredDatabase !== undefined) {
    assert.match(restoredDatabase, /^xiaok_migration_restore_i7513_[0-9a-f]{8}$/);
    const credentials = JSON.parse(fs.readFileSync('C:/i794/credentials.json', 'utf8'));
    url = new URL(`postgresql://${user}@127.0.0.1:${port}/${database}`);
    assert.ok(typeof credentials.sfp_app === 'string' && credentials.sfp_app);
    url.password = credentials.sfp_app;
  } else {
    const { DATABASE_URL } = JSON.parse(fs.readFileSync('../tmp/xiaok-i745-f2/connection.private.json', 'utf8'));
    url = new URL(DATABASE_URL);
  }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1'
    && url.port === port && url.pathname === `/${database}` && url.username === user && !url.search && !url.hash,
  'Expected a documented isolated PG17 target');
  process.env.DATABASE_URL = url.href;
  process.env.POSTGRES_APPLICATION_NAME = 'xiaok-i7513-acceptance';

  // Batch configuration resolves the existing provider metadata. Read only the
  // encryption settings, and keep environment provider registration disabled.
  const local = fs.existsSync('.env.local') ? parseEnv(fs.readFileSync('.env.local', 'utf8')) : {};
  for (const key of ['AI_PROVIDER_KEY_ENCRYPTION_SECRET', 'POLLINATIONS_KEY_ENCRYPTION_SECRET', 'JWT_SECRET']) {
    if (!process.env[key] && local[key]) process.env[key] = local[key];
  }
  for (const key of ['GRS_API_KEY', 'APINEBULA_API_KEY', 'POLLINATIONS_API_KEY']) delete process.env[key];
  Object.assign(process.env, {
    ASSISTANT_KNOWLEDGE_PROVIDER: 'bailian',
    ASSISTANT_BAILIAN_RAG_WORKSPACE_ID: workspaceId,
    ASSISTANT_BAILIAN_RAG_API_KEY: 'synthetic',
    ASSISTANT_BAILIAN_RAG_CATEGORY_ID: 'default',
    ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL: 'text-embedding-v4',
    ASSISTANT_EMBEDDING_PROVIDER: 'openai_compatible',
    ASSISTANT_EMBEDDING_MODEL: 'i7513-synthetic',
    ASSISTANT_EMBEDDING_REVISION: 'i7513-v1',
    ASSISTANT_EMBEDDING_URL: embeddingUrl,
    ASSISTANT_EMBEDDING_API_KEY: 'synthetic',
  });
}

const tenantTables = [
  'assistant_enterprise_settings', 'assistant_knowledge_documents', 'assistant_knowledge_versions',
  'assistant_knowledge_chunks', 'assistant_knowledge_index_profiles', 'assistant_knowledge_attempts',
  'assistant_knowledge_cases', 'assistant_knowledge_evaluations', 'assistant_knowledge_batches',
  'assistant_knowledge_batch_items', 'assistant_managed_knowledge_imports', 'assistant_managed_knowledge_libraries',
  'assistant_jobs', 'assistant_runs', 'assistant_conversations', 'assistant_messages', 'assistant_message_citations',
  'assistant_quota_reservations', 'assistant_usage_records', 'assistant_run_steps', 'assistant_idempotency_records',
  'ai_provider_attempts', 'domain_event_outbox', 'domain_event_deliveries',
] as const;

function snapshotRows(tx: PostgresTransaction, enterpriseId: string) {
  return rows<{ name: string; count: number; digest: string }>(tx, sql.join(tenantTables.map(name => sql`
    select ${name}::text as name, count(*)::int as count,
      md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) as digest
    from app.${sql.identifier(name)} t where enterprise_id=${enterpriseId}
  `), sql` union all `));
}

const snapshot = (enterpriseId: string) => withTenantTransaction(enterpriseId,
  tx => snapshotRows(tx, enterpriseId), { readOnly: true });

async function verifyEnvironment() {
  return withPlatformTransaction(async tx => {
    const identity = await one(tx, sql`select current_database() as db, current_user as usr, session_user as session_user,
      current_setting('server_version_num')::int as version, current_setting('transaction_read_only') as read_only,
      rolsuper, rolbypassrls from pg_roles where rolname=current_user`);
    assert.ok(identity && identity.db === database && identity.usr === user && identity.session_user === user
      && Number(identity.version) >= 170000 && Number(identity.version) < 180000
      && identity.read_only === 'on' && identity.rolsuper === false && identity.rolbypassrls === false,
    'Expected PG17 with a non-bypass business role');
    const rls = await rows(tx, sql`select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
      and c.relname in (${sql.join(tenantTables.map(table => sql`${table}`), sql`, `)}) order by c.relname`);
    assert.equal(rls.length, tenantTables.length);
    assert.ok(rls.every(row => row.rls === true && row.forced === true), 'Expected forced RLS on every acceptance table');
    const cluster = await one(tx, sql`select
      (select shobj_description(oid,'pg_database') from pg_database where datname='postgres') as marker,
      (select shobj_description(oid,'pg_database') from pg_database where datname=current_database()) as purpose,
      exists(select from pg_database where datname='smart_floor_planner') as includes_development,
      (select extversion from pg_extension where extname='vector') as vector`);
    if (restoredDatabase !== undefined) {
      assert.equal(cluster?.marker, 'xiaok-i749-isolated-test');
      assert.match(String(cluster?.purpose), /^xiaok-migration-restore-disposable:[0-9a-f-]{36}$/);
      assert.equal(cluster?.includes_development, false);
    }
    const override = await one(tx, sql`select llm_config->'enabled' = 'true'::jsonb as enabled
      from app.platform_configs where key='default'`);
    assert.ok(!override?.enabled, 'An enabled LLM override may write a platform provider projection during batch creation');
    return { identity, rls, cluster };
  }, { readOnly: true });
}

function managedTransport() {
  const origin = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
  const oss = 'https://i7513.oss-cn-beijing.aliyuncs.com';
  const uploadBytes = new Map<string, string>();
  const files = new Map<string, { tag: string; text: string }>();
  const indices = new Map<string, Set<string>>();
  const deletedFiles: string[] = [];
  const deletedDocuments: string[] = [];
  let requests = 0, rejected = 0;
  let pauseUpload: { enter: () => void; response: Promise<Response> } | undefined;
  const receipt = (data: object) => Response.json({ code: 'Success', request_id: `i7513-${requests}`, data });
  const indexed = (indexId: string) => {
    const docs = indices.get(indexId);
    assert.ok(docs);
    return docs;
  };
  const file = (fileId: string) => {
    const entry = files.get(fileId);
    assert.ok(entry);
    return entry;
  };
  const slice = (indexId: string, docId: string) => {
    assert.ok(indexed(indexId).has(docId));
    return { text: file(docId).text, score: 1,
      metadata: { _id: `${docId}-slice`, workspace_id: workspaceId, pipeline_id: indexId, doc_id: docId } };
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests++;
    if (url.origin === oss && init?.method === 'PUT') {
      assert.ok(init.body instanceof Uint8Array);
      uploadBytes.set(url.pathname.slice(1), Buffer.from(init.body).toString('utf8'));
      return new Response(null, { status: 200 });
    }
    if (url.origin !== origin || new Headers(init?.headers).get('authorization') !== 'Bearer synthetic') {
      rejected++;
      return assert.fail('Unexpected outbound fetch');
    }
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
    const first = (field: string) => (body[field] as string[])[0];
    const indexId = String(body.indexId ?? body.index_id ?? url.searchParams.get('index_id'));
    const operation = url.pathname.split('/').at(-1);
    switch (operation) {
      case 'applyFileUploadLease': {
        if (pauseUpload) {
          pauseUpload.enter();
          return pauseUpload.response;
        }
        const leaseId = `upload-${requests}`;
        return receipt({ type: 'OSS.PreSignedUrl', leaseId, param: { url: `${oss}/${leaseId}`, method: 'PUT' } });
      }
      case 'addFile': {
        const leaseId = String(body.leaseId), text = uploadBytes.get(leaseId), tag = first('tags');
        assert.ok(text && tag);
        const fileId = `${tag}-file`;
        uploadBytes.delete(leaseId);
        files.set(fileId, { tag, text });
        return receipt({ fileId });
      }
      case 'describeFile': {
        const fileId = String(body.fileId);
        file(fileId);
        return receipt({ fileId, status: 'PARSE_SUCCESS' });
      }
      case 'create_v2': {
        const id = String(body.name), docId = first('docIds');
        file(docId);
        indices.set(id, new Set([docId]));
        return receipt({ id });
      }
      case 'create': {
        const docId = first('docIds');
        file(docId);
        indexed(indexId).add(docId);
        return receipt({ pipelineId: indexId, ingestionId: `ingest-${requests}` });
      }
      case 'status':
        return receipt({ id: url.searchParams.get('job_id'), ingestion_status: 'COMPLETED' });
      case 'files': {
        const rows = [...indexed(indexId)].map(doc_id => ({ doc_id, status: 'FINISH', tags: [file(doc_id).tag] }));
        return receipt({ rows, total_count: rows.length });
      }
      case 'chunklist':
        return receipt({ nodes: [slice(indexId, String(body.docId))], total: 1 });
      case 'retrieve': {
        const [{ tags }] = body.search_filters as Array<{ tags: string[] }>;
        return receipt({ nodes: [...indexed(indexId)].filter(id => tags.includes(file(id).tag)).map(id => slice(indexId, id)) });
      }
      case 'delete_file': {
        const docId = first('doc_ids');
        assert.ok(indexed(indexId).delete(docId));
        deletedDocuments.push(docId);
        return receipt({ deleted: [docId] });
      }
      case 'deleteFile': {
        const fileId = String(body.fileId);
        assert.ok(files.delete(fileId));
        deletedFiles.push(fileId);
        return receipt({});
      }
      default:
        rejected++;
        return assert.fail('Unexpected synthetic provider operation');
    }
  };
  return { fetcher, deletedFiles, deletedDocuments, traffic: () => ({ requests, rejected }),
    holdUpload: (value?: typeof pauseUpload) => { pauseUpload = value; } };
}

type Fixture = KnowledgeActor & { code: string };
type Scope = { enterpriseId: string };
type DocumentJob = { documentId: string; versionId: string; jobId: string; expectedVersion: number; expectedEditVersion: number };

async function createTenant(role: 'pilot' | 'outside'): Promise<Fixture> {
  const code = `i7513-${role}-${runId}`;
  return withPlatformTransaction(async tx => {
    const enterprise = await one(tx, sql`insert into app.enterprises(name,code,status)
      values(${code},${code},'active') returning id::text`);
    assert.ok(enterprise && String(enterprise.id) !== '1454');
    const enterpriseId = String(enterprise.id);
    const admin = await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${enterpriseId},${code},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id::text`);
    assert.ok(admin);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${enterpriseId},true,100,1200000,100000000,30)`);
    return { enterpriseId, adminId: String(admin.id), code };
  });
}

const body = '测试工艺资料。书房靠窗放书桌，验收时先从坐姿检查屏幕眩光，再确认椅后通道和插座点位。';

async function enqueueIndex(tenant: Fixture, title: string, audience = 'customer_public'): Promise<DocumentJob> {
  const service = new KnowledgeService(tenant);
  const { document, draft } = await service.execute('create', {
    title: `I7.5.13 合成 ${title}`, sourceType: 'manual_text', audience, body,
  }, randomUUID()) as { document: { id: string; version: number }; draft: { id: string; edit_version: number } };
  const binding = { documentId: String(document.id), versionId: String(draft.id),
    expectedVersion: Number(document.version), expectedEditVersion: Number(draft.edit_version) };
  const queued = await service.execute('index', binding, randomUUID());
  assert.equal(queued.status, 'queued');
  return { ...binding, jobId: String(queued.jobId) };
}

function indexState(tenant: Scope, jobId: string) {
  return withTenantTransaction(tenant.enterpriseId, async tx => {
    const job = await one<{ id: string; status: string; attempt_count: number; last_error: string | null;
      index_status: string; chunk_count: number; hash_matches: boolean | null; managed_locator: boolean }>(tx,
    sql`select j.id::text, j.status, j.attempts as attempt_count, j.last_error, v.index_status, v.chunk_count,
      v.indexed_hash = v.content_hash as hash_matches,
      exists(select from app.assistant_knowledge_chunks c where c.enterprise_id=v.enterprise_id
        and c.document_version_id=v.id and c.locator ? 'managed' and c.content_hash=v.content_hash) as managed_locator
      from app.assistant_jobs j join app.assistant_knowledge_versions v on v.enterprise_id=j.enterprise_id and v.id=j.knowledge_version_id
      where j.enterprise_id=${tenant.enterpriseId} and j.id=${jobId}`);
    assert.ok(job);
    const attempts = await rows(tx, sql`select operation,status,error_code from app.assistant_knowledge_attempts
      where enterprise_id=${tenant.enterpriseId} and job_id=${jobId} order by id`);
    return { ...job, attempts };
  }, { readOnly: true });
}

function importState(tenant: Scope, jobId: string) {
  return withTenantTransaction(tenant.enterpriseId, async tx => {
    const row = await one(tx, sql`select i.ready,i.revoked_at,i.removed_at,i.cleanup_attempts,i.cleanup_request_id,i.cleanup_error,
      i.file_id,i.index_document_id,l.index_id from app.assistant_managed_knowledge_imports i
      join app.assistant_managed_knowledge_libraries l on l.enterprise_id=i.enterprise_id and l.workspace_id=i.workspace_id
      where i.enterprise_id=${tenant.enterpriseId} and i.job_id=${jobId} and i.workspace_id=${workspaceId}`);
    assert.ok(row);
    return row;
  }, { readOnly: true });
}

async function createCleanupCandidate(tenant: Fixture) {
  const job = await enqueueIndex(tenant, '托管清理', 'staff_internal');
  assert.equal(await processKnowledgeJob({ enterpriseId: tenant.enterpriseId }), true);
  const indexed = await indexState(tenant, job.jobId);
  assert.equal(indexed.status, 'succeeded', JSON.stringify(indexed));
  const retired = await new KnowledgeService(tenant).execute('retire', job, randomUUID());
  assert.equal(retired.status, 'retired');
  const state = await importState(tenant, job.jobId);
  assert.ok(state.ready && state.revoked_at && state.file_id && state.index_document_id && state.index_id);
  assert.equal(state.removed_at, null);
  return { ...job, state };
}

async function createBatch(tenant: Fixture, source: DocumentJob, count: number) {
  const service = new KnowledgeOperations(tenant);
  const cases = [];
  for (let i = 0; i < count; i++) {
    const item = await service.save({ title: `I7.5.13 合成评测 ${i + 1}`,
      question: '书房的书桌靠窗放，验收时要看哪些地方？',
      expectation: { kind: 'grounded', requiredDocumentIds: [source.documentId], forbiddenDocumentIds: [] },
    }, randomUUID());
    cases.push({ id: item.id, expectedVersion: Number(item.version) });
  }
  const input = { title: `I7.5.13 ${tenant.code}`, concurrency: 1, cases };
  const key = randomUUID();
  const batches = service.batches();
  const { batchId } = await batches.create(input, key);
  assert.deepEqual(await batches.create(input, key), { batchId });
  const read = await batches.read(batchId);
  assert.ok(read.available && read.items && read.state === 'active');
  assert.equal(read.items.length, count);
  assert.ok(read.items.every(item => item.status === 'pending' && item.runId === null));
  const evaluations = [];
  for (const item of read.items) {
    const evaluation = await service.read(item.evaluationId);
    assert.ok(evaluation.available && evaluation.status === 'dispatch_pending');
    assert.deepEqual(evaluation.snapshot?.required.map(ref => [ref.documentId, ref.versionId]), [[source.documentId, source.versionId]]);
    evaluations.push({ evaluationId: item.evaluationId, caseId: item.caseId, required: evaluation.snapshot?.required });
  }
  return { batchId, evaluations, service, batches };
}

function pilotEnvironment(tenant: Fixture) {
  return {
    XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: tenant.enterpriseId,
    XIAOK_STAGE_REMINDER_PILOT_ID: tenant.code, XIAOK_WEEKLY_REPORT_MODE: 'pilot',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: tenant.enterpriseId, XIAOK_WEEKLY_REPORT_PILOT_ID: tenant.code,
  };
}

async function expire(tenant: Scope, jobId: string, leaseToken: string) {
  // Simulate clock expiry only after the real claimant has issued this run's lease.
  const updated = await withTenantTransaction(tenant.enterpriseId, tx => one(tx, sql`update app.assistant_jobs
    set lease_expires_at=now()-interval '1 second' where enterprise_id=${tenant.enterpriseId} and id=${jobId}
    and status='running' and lease_token=${leaseToken} returning id::text`));
  assert.equal(updated?.id, jobId);
}

async function waitForChatJob(tenant: Scope, runId: string) {
  for (let i = 0; i < 60; i++) {
    const job = await withTenantTransaction(tenant.enterpriseId, tx => one(tx, sql`select id::text from app.assistant_jobs
      where enterprise_id=${tenant.enterpriseId} and run_id=${runId} and status='queued' and available_at<=now()`), { readOnly: true });
    if (job) return String(job.id);
    await sleep(250);
  }
  return assert.fail('The synthetic batch job did not become due');
}

async function verifyRls(tenant: Fixture, other: Fixture, ownVersion: string, otherJob: string) {
  const denied = await withTenantTransaction(tenant.enterpriseId, tx => snapshotRows(tx, other.enterpriseId), { readOnly: true });
  assert.ok(denied.every(table => table.count === 0));
  await withTenantTransaction(tenant.enterpriseId, async tx => {
    const hidden = await one(tx, sql`update app.assistant_jobs set updated_at=now() where id=${otherJob} returning id::text`);
    assert.equal(hidden, undefined);
  });
  await assert.rejects(withTenantTransaction(tenant.enterpriseId, async tx => {
    await tx.execute(sql`update app.assistant_knowledge_chunks set enterprise_id=${other.enterpriseId}
      where enterprise_id=${tenant.enterpriseId} and document_version_id=${ownVersion}`);
    assert.fail('The RLS probe allowed a tenant to reassign its chunk to the other enterprise');
  }), error => {
    const rejected = describeError(error);
    assert.equal(rejected.code, '42501', JSON.stringify(rejected));
    assert.match(rejected.message ?? '', /row-level security/i);
    return true;
  });
  return { reader: tenant.enterpriseId, hiddenEnterprise: other.enterpriseId, hiddenTableCount: denied.length,
    crossTenantUpdateRows: 0, reassignSqlstate: '42501' };
}

async function cleanup(tenant: Fixture) {
  return withPlatformTransaction(async tx => {
    assert.notEqual(tenant.enterpriseId, '1454');
    const owned = await one(tx, sql`select id::text from app.enterprises where id=${tenant.enterpriseId}
      and code=${tenant.code} and name=${tenant.code} for update`);
    assert.equal(owned?.id, tenant.enterpriseId);
    // In a failed trial an import may still reference the in-memory provider.
    // Remove only this trial's local mock bindings before using tenant cleanup.
    const mockBindings = await rows(tx, sql`delete from app.assistant_managed_knowledge_imports where
      enterprise_id=${tenant.enterpriseId} and workspace_id=${workspaceId} and removed_at is null returning job_id::text`);
    await deleteAssistantData(tx, BigInt(tenant.enterpriseId));
    await tx.execute(sql`delete from app.admin_users where enterprise_id=${tenant.enterpriseId}
      and id=${tenant.adminId} and username=${tenant.code}`);
    await tx.execute(sql`delete from app.enterprises where id=${tenant.enterpriseId} and code=${tenant.code}`);
    const remaining = await assistantCounts(tx, BigInt(tenant.enterpriseId));
    const residue = await one(tx, sql`select
      (select count(*)::int from app.enterprises where id=${tenant.enterpriseId}) as enterprises,
      (select count(*)::int from app.admin_users where id=${tenant.adminId} or enterprise_id=${tenant.enterpriseId}) as admins,
      (select count(*)::int from app.ai_provider_attempts where enterprise_id=${tenant.enterpriseId}) as provider_attempts`);
    assert.ok(remaining.every(table => table.count === 0));
    assert.deepEqual(residue, { enterprises: 0, admins: 0, provider_attempts: 0 });
    return { enterpriseId: tenant.enterpriseId, checkedTables: remaining.length, mockBindingsRemoved: mockBindings.length, ...residue };
  });
}

async function main() {
  save();
  const tenants: Fixture[] = [];
  const transport = managedTransport();
  const { deletedFiles, deletedDocuments } = transport;
  const originalFetch = globalThis.fetch;
  let textCalls = 0;
  globalThis.fetch = transport.fetcher;

  let phase = 'env.pg17_rls';
  try {
    configure();
    record(phase, 'passed', await verifyEnvironment());
    phase = 'fixture.formal_candidates';
    // Create the counterexample first so unscoped oldest-first consumers would see it.
    const outside = await createTenant('outside');
    tenants.push(outside);
    const pilot = await createTenant('pilot');
    tenants.push(pilot);
    record('fixture.tenants', 'passed', { pilot, outside });
    const outsideManaged = await createCleanupCandidate(outside);
    const pilotManaged = await createCleanupCandidate(pilot);

    const outsideSource = await enqueueIndex(outside, '对照企业来源');
    const pilotSource = await enqueueIndex(pilot, '试点企业来源');
    for (const [tenant, job] of [[outside, outsideSource], [pilot, pilotSource]] as const) {
      assert.equal(await processKnowledgeJob({ enterpriseId: tenant.enterpriseId }), true);
      const indexed = await indexState(tenant, job.jobId);
      assert.equal(indexed.status, 'succeeded', JSON.stringify(indexed));
      const published = await new KnowledgeService(tenant).execute('publish', job, randomUUID());
      assert.equal(String(published.published_version_id), job.versionId);
    }
    const outsideBatch = await createBatch(outside, outsideSource, 1);
    const pilotBatch = await createBatch(pilot, pilotSource, 2);
    const outsideIndex = await enqueueIndex(outside, '对照企业待索引');
    const pilotIndex = await enqueueIndex(pilot, '试点企业待索引');
    record(phase, 'passed', {
      pilot: { source: pilotSource, index: pilotIndex, managed: pilotManaged, batchId: pilotBatch.batchId, evaluations: pilotBatch.evaluations },
      outside: { source: outsideSource, index: outsideIndex, managed: outsideManaged, batchId: outsideBatch.batchId, evaluations: outsideBatch.evaluations },
    });

    phase = 'dryrun.read_only';
    const env = pilotEnvironment(pilot);
    const scope = workerTaskScope(evaluateWorkerSafetyGate(env)).scope;
    const outsideEnv = pilotEnvironment(outside);
    const outsideScope = workerTaskScope(evaluateWorkerSafetyGate(outsideEnv)).scope;
    assert.deepEqual(scope, { enterpriseId: pilot.enterpriseId });
    assert.deepEqual(outsideScope, { enterpriseId: outside.enterpriseId });
    const before = { pilot: await snapshot(pilot.enterpriseId), outside: await snapshot(outside.enterpriseId) };
    const now = new Date();
    const preview = await assistantWorkerPreflight({ env, now });
    const repeated = await assistantWorkerPreflight({ env, now });
    assert.deepEqual(repeated.scopedQueue, preview.scopedQueue);
    assert.deepEqual(repeated.sideEffects, preview.sideEffects);
    const controlPreview = await assistantWorkerPreflight({ env: outsideEnv, now });
    const candidates = (value: typeof preview) => value.sideEffects.tasks.find(task => task.task === 'knowledge_batches');
    assert.equal(preview.sideEffects.scope.enterpriseId, pilot.enterpriseId);
    assert.equal(controlPreview.sideEffects.scope.enterpriseId, outside.enterpriseId);
    assert.equal(candidates(preview)?.pending, 1);
    assert.equal(candidates(preview)?.wouldRun, true);
    assert.equal(candidates(controlPreview)?.pending, 1);
    assert.deepEqual(preview.scopedQueue?.items.map(item => item.jobId), [pilotIndex.jobId]);
    assert.deepEqual(controlPreview.scopedQueue?.items.map(item => item.jobId), [outsideIndex.jobId]);
    const closed = await assistantWorkerPreflight({ env: {}, now });
    assert.equal(closed.safetyGate.status, 'closed');
    assert.ok(closed.sideEffects.tasks.every(task => !task.wouldRun));
    const after = { pilot: await snapshot(pilot.enterpriseId), outside: await snapshot(outside.enterpriseId) };
    assert.deepEqual(after, before);
    record(phase, 'passed', { pilot: candidates(preview), outside: candidates(controlPreview),
      pilotIndex: preview.scopedQueue?.items, outsideIndex: controlPreview.scopedQueue?.items,
      closedTasks: closed.sideEffects.tasks.length, before, after });

    phase = 'rls.read_write';
    await assert.rejects(pilotBatch.batches.read(outsideBatch.batchId), /assistant_resource_not_found/);
    await assert.rejects(outsideBatch.batches.read(pilotBatch.batchId), /assistant_resource_not_found/);
    const rls = [await verifyRls(pilot, outside, pilotSource.versionId, outsideIndex.jobId),
      await verifyRls(outside, pilot, outsideSource.versionId, pilotIndex.jobId)];
    record(phase, 'passed', rls);

    phase = 'scope.batch_advance_idempotent';
    assert.ok(scope && outsideScope);
    assert.deepEqual(await Promise.all([advanceKnowledgeBatches(scope), advanceKnowledgeBatches(scope)]), [1, 1]);
    const started = await pilotBatch.batches.read(pilotBatch.batchId);
    assert.ok(started.available && started.items?.[0].runId);
    assert.deepEqual(started.items.map(item => item.status), ['queued', 'pending']);
    const counts = await snapshot(pilot.enterpriseId);
    for (const name of ['assistant_runs', 'assistant_quota_reservations', 'assistant_conversations']) {
      assert.equal(counts.find(table => table.name === name)?.count, 1, name);
    }
    const outsidePending = await outsideBatch.batches.read(outsideBatch.batchId);
    assert.ok(outsidePending.available && outsidePending.items?.[0].status === 'pending' && outsidePending.items[0].runId === null);
    record(phase, 'passed', { pilot: started.items, outside: outsidePending.items, counts });

    phase = 'scope.index_reclaim_idempotent';
    const leases = await Promise.all([claimKnowledgeJob(scope), claimKnowledgeJob(scope)]);
    const lease = leases.find(Boolean);
    assert.equal(leases.filter(Boolean).length, 1);
    assert.ok(lease && lease.jobId === pilotIndex.jobId && lease.actor.enterpriseId === pilot.enterpriseId);
    await expire(scope, lease.jobId, lease.token);
    const reclaimed = await claimKnowledgeJob(scope);
    assert.ok(reclaimed && reclaimed.jobId === lease.jobId && reclaimed.token !== lease.token);
    const calls = transport.traffic().requests;
    await runKnowledgeJob(lease);
    assert.equal(transport.traffic().requests, calls);
    await runKnowledgeJob(reclaimed);
    const indexed = await indexState(pilot, pilotIndex.jobId);
    assert.equal(indexed.status, 'succeeded', JSON.stringify(indexed));
    assert.equal(indexed.attempt_count, 2);
    assert.ok(indexed.managed_locator && indexed.chunk_count === 1 && indexed.hash_matches);
    assert.deepEqual(indexed.attempts, ['managed_upload', 'managed_import']
      .map(operation => ({ operation, status: 'succeeded', error_code: null })));
    const afterIndex = transport.traffic().requests;
    assert.ok(afterIndex > calls);
    assert.equal(await processKnowledgeJob(scope), false);
    assert.equal(transport.traffic().requests, afterIndex);
    assert.deepEqual(await indexState(pilot, pilotIndex.jobId), indexed);
    assert.equal((await indexState(outside, outsideIndex.jobId)).status, 'queued');
    record(phase, 'passed', { indexed, rotatedLease: true, outsideJobId: outsideIndex.jobId });

    phase = 'scope.managed_cleanup_idempotent';
    assert.equal(await processManagedKnowledgeCleanup(undefined, scope), true);
    const removed = await importState(pilot, pilotManaged.jobId);
    assert.ok(removed.removed_at && removed.cleanup_request_id);
    assert.equal(removed.cleanup_attempts, 1);
    assert.equal(removed.cleanup_error, null);
    assert.deepEqual(deletedFiles, [pilotManaged.state.file_id]);
    assert.deepEqual(deletedDocuments, [pilotManaged.state.index_document_id]);
    assert.equal(await processManagedKnowledgeCleanup(undefined, scope), false);
    assert.deepEqual(await importState(pilot, pilotManaged.jobId), removed);
    assert.deepEqual(await importState(outside, outsideManaged.jobId), outsideManaged.state);
    record(phase, 'passed', { removed, outside: outsideManaged.state, deletedFiles: [...deletedFiles] });

    phase = 'batch.success_and_terminal_failure';
    async function claimEvaluation(runId: string) {
      const jobId = await waitForChatJob(pilot, runId);
      const claimed = await claimJob({ enterpriseId: pilot.enterpriseId });
      assert.ok(claimed && claimed.runId === runId && claimed.jobId === jobId);
      return claimed;
    }
    const first = await claimEvaluation(started.items[0].runId);
    await processAnswer(first, { model: {
      capabilities: { streaming: false, toolCalling: false, usage: false },
      async generate(input) {
        textCalls++;
        const candidates = JSON.parse(input.messages[1].content).evidence as Array<{ selectionId: string }>;
        return { text: JSON.stringify({ selections: candidates.map(candidate => candidate.selectionId) }),
          attemptId: '', usage: null, finishReason: null, providerRequestId: null };
      },
    } });
    const evaluation = await pilotBatch.service.read(started.items[0].evaluationId);
    assert.equal(evaluation.structural?.passed, true, `Grounded evaluation status: ${evaluation.status}`);
    assert.equal(textCalls, 1);

    assert.equal(await advanceKnowledgeBatches(scope), 1);
    const next = await pilotBatch.batches.read(pilotBatch.batchId);
    assert.ok(next.available && next.items?.[1].runId);
    const second = await claimEvaluation(next.items[1].runId);
    await failRun(second, 'i7513_synthetic_failure', true);
    const terminal = await pilotBatch.batches.read(pilotBatch.batchId);
    assert.ok(terminal.available && terminal.items && terminal.state === 'completed');
    assert.deepEqual(terminal.items.map(item => item.status), ['succeeded', 'failed']);
    assert.equal(terminal.items[1].errorCode, 'i7513_synthetic_failure');
    const terminalBefore = await snapshot(pilot.enterpriseId);
    assert.equal(await claimJob(scope), null);
    assert.equal(await advanceKnowledgeBatches(scope), 0);
    assert.deepEqual(await snapshot(pilot.enterpriseId), terminalBefore);
    record(phase, 'passed', { batch: terminal.items, firstJobId: first.jobId, secondJobId: second.jobId, structural: evaluation.structural });

    phase = 'index.expired_and_failed';
    const exhausted = await enqueueIndex(pilot, '租约耗尽');
    for (let i = 0; i < 3; i++) {
      const retry = await claimKnowledgeJob(scope);
      assert.ok(retry && retry.jobId === exhausted.jobId);
      await expire(scope, retry.jobId, retry.token);
    }
    assert.equal(await processKnowledgeJob(scope), false);
    const failed = await indexState(pilot, exhausted.jobId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.attempt_count, 3);
    assert.equal(failed.last_error, 'retry_exhausted');
    assert.equal(failed.index_status, 'failed');
    assert.deepEqual(failed.attempts, []);

    const ambiguous = await enqueueIndex(pilot, '已派发租约过期');
    const launched = await claimKnowledgeJob(scope);
    assert.ok(launched && launched.jobId === ambiguous.jobId);
    const entered = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    transport.holdUpload({ enter: entered.resolve, response: response.promise });
    const inFlight = runKnowledgeJob(launched);
    try {
      await Promise.race([entered.promise, inFlight.then(() => assert.fail('The managed upload attempt did not start'))]);
      await expire(scope, launched.jobId, launched.token);
      assert.equal(await claimKnowledgeJob(scope), null);
    } finally {
      transport.holdUpload();
      response.resolve(new Response(null, { status: 503 }));
      await inFlight;
    }
    const unknown = await indexState(pilot, ambiguous.jobId);
    assert.equal(unknown.status, 'indeterminate');
    assert.equal(unknown.attempt_count, 1);
    assert.deepEqual(unknown.attempts, [{ operation: 'managed_upload', status: 'unknown', error_code: 'provider_outcome_unknown' }]);
    const afterFailure = await snapshot(pilot.enterpriseId);
    assert.equal(await processKnowledgeJob(scope), false);
    assert.deepEqual(await snapshot(pilot.enterpriseId), afterFailure);
    record(phase, 'passed', { failed, unknown });

    phase = 'scope.outside_positive_control';
    const outsideBeforeControl = await snapshot(outside.enterpriseId);
    assert.deepEqual(outsideBeforeControl, before.outside);
    const pilotBeforeControl = await snapshot(pilot.enterpriseId);
    assert.equal(await advanceKnowledgeBatches(outsideScope), 1);
    const outsideStarted = await outsideBatch.batches.read(outsideBatch.batchId);
    assert.ok(outsideStarted.available && outsideStarted.items?.[0].status === 'queued' && outsideStarted.items[0].runId);
    assert.equal(await processKnowledgeJob(outsideScope), true);
    const outsideIndexed = await indexState(outside, outsideIndex.jobId);
    assert.equal(outsideIndexed.status, 'succeeded');
    assert.equal(await processManagedKnowledgeCleanup(undefined, outsideScope), true);
    const outsideRemoved = await importState(outside, outsideManaged.jobId);
    assert.ok(outsideRemoved.removed_at && outsideRemoved.cleanup_request_id && outsideRemoved.cleanup_attempts === 1);
    assert.deepEqual(deletedFiles, [pilotManaged.state.file_id, outsideManaged.state.file_id]);
    assert.deepEqual(deletedDocuments, [pilotManaged.state.index_document_id, outsideManaged.state.index_document_id]);
    assert.deepEqual(await snapshot(pilot.enterpriseId), pilotBeforeControl);
    record(phase, 'passed', { untouchedThroughPilot: outsideBeforeControl, batch: outsideStarted.items,
      index: outsideIndexed, managed: outsideRemoved });

    phase = 'external.no_dispatch';
    const providerAttempts = await Promise.all(tenants.map(async tenant =>
      (await snapshot(tenant.enterpriseId)).find(table => table.name === 'ai_provider_attempts')?.count));
    assert.deepEqual(providerAttempts, [0, 0]);
    assert.equal(transport.traffic().rejected, 0);
    record(phase, 'passed', { providerAttempts, transport: transport.traffic(), syntheticTextResponses: textCalls,
      syntheticManagedDeletes: deletedFiles.length });
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = phase === 'env.pg17_rls' ? 'not_run' : 'failed';
    record(phase, evidence.status, describeError(error));
  } finally {
    for (const tenant of tenants) {
      try {
        record(`cleanup.${tenant.code.split('-')[1]}`, 'passed', await cleanup(tenant));
      } catch (error) {
        evidence.status = 'failed';
        record('cleanup', 'failed', { enterpriseId: tenant.enterpriseId, error: describeError(error) });
      }
    }
    globalThis.fetch = originalFetch;
    await closePostgresPool();
    evidence.finishedAt = new Date().toISOString();
    save();
    process.exitCode = evidence.status === 'passed' ? 0 : evidence.status === 'not_run' ? 2 : 1;
    console.log(`${evidence.status}: ${path.join(output, 'result.json')}`);
  }
}

void main();
