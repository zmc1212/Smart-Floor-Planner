import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { asObject } from '@/lib/ai/providers/http';
import { LiveBailianAcceptance } from '../xiaok-i7515-bailian-live';
import { LiveLedger, liveModels, prepareLiveLedger, readLiveApproval, readLiveCommand, type LiveApproval } from '../xiaok-i7515-bailian-live-policy';

const workspace = 'ws-i7515-synthetic', secret = 'sk-unit-test-only', signature = 'synthetic-signed-query';
const origin = `https://${workspace}.cn-beijing.maas.aliyuncs.com`;
const name = (n: number) => `xk-${String(n).padStart(17, '0')}`;
const scope = (): LiveApproval => ({
  version: 1, batchId: 'synthetic-batch', workspace,
  validFrom: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
  allowModelPermissionChanges: false,
  limits: { requests: 100, indexCreates: 3, uploads: 5, retrievals: 2, modelCalls: 2, budgetMicrosCny: 200_000 },
  reserveMicrosCny: { list: 0, permissions_read: 0, applyFileUploadLease: 1, oss_put: 1, addFile: 1,
    create_v2: 1000, retrieve: 10, responses: 10, delete: 0, deleteFile: 0, delete_file: 0, files: 0 },
});

function mockTransport() {
  const calls: Array<{ op: string; method: string; body: Record<string, unknown> }> = [];
  const indices = new Map<string, { name: string; fileId: string }>();
  const inference = new Set<string>(liveModels), files = new Map<string, string>();
  const state = { create: 'ok' as 'ok' | 'reject' | 'lost' | 'conflict', before: () => {} };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET';
    const op = method === 'PUT' ? 'oss_put' : url.pathname.split('/').at(-1)!;
    const body = typeof init?.body === 'string' ? asObject(JSON.parse(init.body)) : {};
    assert.equal(init?.redirect, 'error');
    assert.ok(url.origin === origin || op === 'oss_put', 'No unmocked destination');
    calls.push({ op, method, body });
    state.before();
    const requestId = `mock-request-${calls.length}`;
    const ok = (data = {}) => Response.json({ code: 'Success', success: true, requestId, data });
    if (op === 'list') return ok({ rows: [...indices].map(([id, record]) => ({ id, name: record.name })) });
    if (op === 'permissions') {
      if (method === 'GET') {
        const model = url.searchParams.get('model')!;
        return Response.json({ success: true, requestId, output: { permissions: inference.has(model) ? [{ model_id: model }] : [] } });
      }
      for (const value of body.models as Array<{ model: string; inference: boolean }>) {
        if (value.inference) inference.add(value.model); else inference.delete(value.model);
      }
      return ok();
    }
    if (op === 'applyFileUploadLease') return ok({ type: 'OSS.PreSignedUrl', leaseId: `lease-${calls.length}`,
      param: { method: 'PUT', url: `https://synthetic.oss-cn-beijing.aliyuncs.com/${calls.length}?sig=${signature}`, headers: {} } });
    if (op === 'oss_put') return new Response(null, { status: 204 });
    if (op === 'addFile') {
      const fileId = `file-${calls.length}`;
      files.set(fileId, String((body.tags as string[])[0]));
      return ok({ fileId });
    }
    if (op === 'create_v2') {
      if (state.create === 'reject') return Response.json({ code: 'Rejected', requestId }, { status: 400 });
      const indexId = `index-${calls.length}`;
      indices.set(indexId, { name: String(body.name), fileId: (body.docIds as string[])[0] });
      if (state.create === 'lost') throw Error('Synthetic transport stopped after the write');
      return ok({ pipelineId: indexId, ...(state.create === 'conflict' ? { id: 'other-index' } : {}) });
    }
    if (op === 'delete') { indices.delete(String(body.index_id)); return ok(); }
    if (op === 'deleteFile') { files.delete(String(body.fileId)); return ok(); }
    if (op === 'files') {
      const fileId = indices.get(url.searchParams.get('index_id')!)!.fileId;
      return ok({ rows: [{ doc_id: fileId + '_doc', tags: [files.get(fileId)], status: 'FINISH' }], total_count: 1 });
    }
    if (op === 'delete_file') return ok({ deleted: body.doc_ids });
    if (op === 'retrieve') return ok({ nodes: [] });
    if (op === 'responses') return Response.json({ code: 'MockBusy', requestId }, { status: 503 });
    throw Error('Unexpected synthetic transport operation');
  };
  return { calls, indices, inference, state, fetcher };
}

function fixture(t: TestContext, approval = scope()) {
  const dir = mkdtempSync(join(tmpdir(), 'xiaok-i7515-offline-'));
  const runs: LiveBailianAcceptance[] = [];
  t.after(() => {
    for (const run of runs) run.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const cloud = mockTransport(), ledgerRoot = join(dir, 'ledgers'), authorization = join(dir, 'approval.json');
  const env = { XIAOK_I7515_LIVE_AUTHORIZATION_FILE: authorization, XIAOK_I7515_EXPECTED_WORKSPACE_ID: workspace,
    XIAOK_I7515_LIVE_API_KEY: secret, ASSISTANT_EMBEDDING_URL: 'http://127.0.0.1:50515' };
  const receiptFile = join(dir, 'run.json'), ledgerFile = join(ledgerRoot, workspace, 'ledger.json');
  const writeApproval = (value: unknown = approval) => writeFileSync(authorization, JSON.stringify(value));
  const open = (allowPermissions = false, now?: () => number) => {
    const run = LiveBailianAcceptance.open(receiptFile, allowPermissions, { env, ledgerRoot, fetcher: cloud.fetcher, now });
    runs.push(run);
    return run;
  };
  const prepare = () => prepareLiveLedger(readLiveApproval(env), ledgerRoot);
  writeApproval();
  return { approval, env, cloud, ledgerRoot, ledgerFile, receiptFile, open, prepare, writeApproval };
}

const upload = (run: LiveBailianAcceptance, n = 1) => run.client.upload({ name: 'PPT-excerpt-17.txt', data: Buffer.from('synthetic text'), tag: 'tag-' + n });
const model = (run: LiveBailianAcceptance) => run.model.generate({ enterpriseId: 'fixture', owner: { kind: 'assistant_run', runId: 1n },
  messages: [{ role: 'user', content: '水电施工先做什么？' }], maxTokens: 32 });

test('live CLI must opt in explicitly; missing, expired, incomplete or mismatched authorization has zero I/O', t => {
  const f = fixture(t);
  assert.throws(() => readLiveCommand(['run-one', '--lve']), /Invalid/);
  assert.throws(() => readLiveCommand(['--live-core']), /Invalid/);
  assert.equal(readLiveCommand(['run-one', '--live-core']).kind, 'live');
  assert.equal(readLiveCommand(['--prepare-live-ledger']).kind, 'prepare');
  assert.throws(() => LiveBailianAcceptance.open(f.receiptFile, false, { env: {}, fetcher: f.cloud.fetcher }), /XIAOK_I7515_LIVE_AUTHORIZATION_FILE/);
  for (const bad of [
    { ...f.approval, limits: undefined },
    { ...f.approval, allowModelPermissionChanges: undefined },
    { ...f.approval, reserveMicrosCny: { retrieve: 0 } },
    { ...f.approval, limits: { ...f.approval.limits, indexCreates: 4 } },
    { ...f.approval, token: secret },
  ]) {
    f.writeApproval(bad);
    assert.throws(() => f.open(), /invalid I7.5.15 authorization file|positive conservative reservation/);
  }
  f.writeApproval({ ...f.approval, expiresAt: new Date(Date.now() - 1).toISOString() });
  assert.throws(() => f.open(), /authorization is not active/);
  f.writeApproval({ ...f.approval, workspace: 'ws-other-synthetic' });
  assert.throws(() => f.open(), /Workspace does not match/);
  assert.deepEqual(f.cloud.calls, []);
  assert.deepEqual([...f.cloud.inference], [...liveModels]);
});

test('a missing or corrupt ledger, edited scope and competing writer block before transport', t => {
  const f = fixture(t);
  assert.throws(() => f.open());
  f.prepare();
  const run = f.open();
  assert.throws(() => f.open(), /ledger lock unavailable/);
  run.close();
  f.writeApproval({ ...f.approval, limits: { ...f.approval.limits, requests: 101 } });
  assert.throws(() => f.open(), /scope conflict/);
  f.writeApproval();
  const envelope = JSON.parse(readFileSync(f.ledgerFile, 'utf8'));
  writeFileSync(f.ledgerFile, JSON.stringify({ ...envelope, state: { ...envelope.state, approvalDigest: '0'.repeat(64) } }));
  assert.throws(() => f.open(), /Missing or corrupt/);
  unlinkSync(f.ledgerFile);
  assert.throws(() => f.open(), /Missing or corrupt/);
  assert.throws(() => f.prepare(), /EEXIST/);
  assert.equal(f.cloud.calls.length, 0);
});

test('preflight stays read only, and permission writes need both an approved scope and a separate switch', async t => {
  const denied = fixture(t);
  denied.prepare();
  assert.throws(() => denied.open(true), /independent batch authorization/);
  assert.deepEqual(denied.cloud.calls, []);

  const approved = scope();
  approved.allowModelPermissionChanges = true;
  Object.assign(approved.reserveMicrosCny, { permissions_grant: 0, permissions_restore: 0 });
  const f = fixture(t, approved);
  f.prepare();
  const [, missing] = liveModels;
  f.cloud.inference.delete(missing);
  let run = f.open();
  assert.deepEqual((await run.start()).missingModels, [missing]);
  await assert.rejects(run.enableMissingInference(), /require --allow-model-permission-changes/);
  assert.equal(f.cloud.calls.filter(call => call.method === 'POST').length, 0);
  run.close();

  run = f.open(true);
  assert.deepEqual((await run.start()).missingModels, [missing]);
  assert.equal(f.cloud.calls.filter(call => call.method === 'POST').length, 0);
  await run.enableMissingInference();
  assert.equal(f.cloud.inference.has(missing), true);
  await run.cleanup();
  assert.deepEqual([...f.cloud.inference], [liveModels[0]]);
  assert.deepEqual(f.cloud.calls.filter(call => call.method === 'POST').map(call => call.body.models), [
    [{ model: missing, inference: true }], [{ model: missing, inference: false }],
  ]);
});

test('three completed creations exhaust the batch across reopened runs even after every index was deleted', async t => {
  const f = fixture(t);
  f.prepare();
  for (let i = 1; i <= 4; i++) {
    const run = f.open();
    await run.start();
    const file = await upload(run, i);
    if (i < 4) await run.client.createIndex(name(i), file.value);
    else await assert.rejects(run.client.createIndex(name(i), file.value), { providerCode: 'transport_error' });
    await run.cleanup();
    assert.equal(f.cloud.indices.size, 0);
    run.close();
    assert.equal(run.budget().counts.create_v2, Math.min(3, i));
  }
  assert.equal(f.cloud.calls.filter(call => call.op === 'create_v2').length, 3);
  for (const file of [f.ledgerFile, f.receiptFile]) assert.doesNotMatch(readFileSync(file, 'utf8'), new RegExp(secret + '|' + signature));
});

test('failed/unknown and interrupted reservations still count, including model, retrieval and upload quotas', async t => {
  const f = fixture(t);
  f.prepare();
  const run = f.open();
  await run.start();
  const file = await upload(run);
  f.cloud.state.create = 'reject';
  await assert.rejects(run.client.createIndex(name(1), file.value), { providerCode: 'Rejected' });
  f.cloud.state.create = 'lost';
  await assert.rejects(run.client.createIndex(name(2), file.value), { providerCode: 'transport_error' });
  run.close();
  const ledger = LiveLedger.open(readLiveApproval(f.env), f.ledgerRoot);
  try {
    assert.deepEqual(ledger.attempts.filter(a => a.operation === 'create_v2').map(a => a.status), ['failed', 'unknown']);
    ledger.reserve('create_v2'); // interrupted after durable reservation, before any response
    ledger.reserve('responses');
    ledger.reserve('retrieve');
    for (let i = 0; i < 4; i++) ledger.reserve('applyFileUploadLease');
  } finally { ledger.close(); }
  const reopened = LiveLedger.open(readLiveApproval(f.env), f.ledgerRoot);
  try {
    assert.throws(() => reopened.reserve('create_v2'), /cumulative operation limit/);
    assert.throws(() => reopened.reserve('applyFileUploadLease'), /cumulative operation limit/);
    reopened.reserve('responses');
    reopened.reserve('retrieve');
    assert.throws(() => reopened.reserve('responses'), /cumulative operation limit/);
    assert.throws(() => reopened.reserve('retrieve'), /cumulative operation limit/);
    assert.equal(reopened.summary().reservedMicrosCny, 3047);
    assert.equal(reopened.summary().billingStatus, 'pending_invoice_reconciliation');
  } finally { reopened.close(); }
});

test('concurrent model dispatch reserves before transport and fees cannot be reused after failure or reopening', async t => {
  const approval = scope();
  approval.limits.budgetMicrosCny = 15;
  const f = fixture(t, approval);
  f.prepare();
  let run = f.open();
  await run.start();
  f.cloud.state.before = () => {
    const disk = JSON.parse(readFileSync(f.ledgerFile, 'utf8'));
    assert.equal(disk.state.attempts.at(-1).operation, 'responses');
    assert.equal(disk.state.attempts.at(-1).status, 'reserved');
  };
  const results = await Promise.allSettled([model(run), model(run)]);
  assert.ok(results.every(value => value.status === 'rejected'));
  assert.equal(f.cloud.calls.filter(call => call.op === 'responses').length, 1);
  run.close();

  f.cloud.state.before = () => {};
  run = f.open();
  await run.start();
  assert.equal(run.budget().reservedMicrosCny, 10);
  await assert.rejects(model(run), /conservative budget exceeded/);
  assert.equal(f.cloud.calls.filter(call => call.op === 'responses').length, 1);
});

test('a separate Node process is fenced by the same lock and reopens the same cumulative request quota', t => {
  const approval = scope();
  approval.limits.requests = 1;
  const f = fixture(t, approval);
  f.prepare();
  const policy = fileURLToPath(new URL('../xiaok-i7515-bailian-live-policy.ts', import.meta.url));
  const probe = () => spawnSync(process.execPath, ['--import', 'tsx', '-e', `
    const [policy, file, workspace, root] = process.argv.slice(1);
    const { LiveLedger, readLiveApproval } = require(policy);
    const approval = readLiveApproval({XIAOK_I7515_LIVE_AUTHORIZATION_FILE: file, XIAOK_I7515_EXPECTED_WORKSPACE_ID: workspace});
    const ledger = LiveLedger.open(approval, root);
    try { ledger.reserve('list'); } finally { ledger.close(); }
  `, policy, f.env.XIAOK_I7515_LIVE_AUTHORIZATION_FILE, workspace, f.ledgerRoot], { encoding: 'utf8', timeout: 15_000 });
  const ledger = LiveLedger.open(readLiveApproval(f.env), f.ledgerRoot);
  try {
    const competing = probe();
    assert.equal(competing.status, 1, competing.stderr);
    assert.match(competing.stderr, /ledger lock unavailable/);
  } finally { ledger.close(); }
  const first = probe();
  assert.equal(first.status, 0, first.stderr);
  const resumed = probe();
  assert.equal(resumed.status, 1, resumed.stderr);
  assert.match(resumed.stderr, /cumulative request limit exceeded/);
  assert.equal(f.cloud.calls.length, 0);
});

test('scope omissions, egress outside the dedicated Workspace and expiry while running deny dispatch', async t => {
  const approval = scope();
  delete approval.reserveMicrosCny.applyFileUploadLease;
  const f = fixture(t, approval);
  f.prepare();
  let now = Date.now();
  const run = f.open(false, () => now);
  await run.start();
  await assert.rejects(upload(run), { providerCode: 'transport_error' });
  await assert.rejects(globalThis.fetch('https://ws-other.invalid/api/v1/models/permissions', { method: 'POST' }), /not allowed/);
  await assert.rejects(globalThis.fetch('https://synthetic.oss-cn-beijing.aliyuncs.com/unbound', { method: 'PUT' }), /not allowed/);
  now = Date.parse(approval.expiresAt);
  await assert.rejects(run.client.listIndices(), { providerCode: 'transport_error' });
  assert.equal(f.cloud.calls.length, 3);
});

test('cleanup after restart deletes only IDs with verified receipts, including the document binding', async t => {
  const f = fixture(t);
  f.prepare();
  let run = f.open();
  await run.start();
  const file = (await upload(run)).value;
  const own = (await run.client.createIndex(name(1), file)).value;
  await assert.rejects(run.client.deleteFile('unrelated-file'), { providerCode: 'transport_error' });
  await assert.rejects(run.client.deleteDocument(own, file + '_doc'), { providerCode: 'transport_error' });
  await run.client.listDocuments(own, 1);
  await assert.rejects(run.client.deleteDocument(own, file + '_foreign'), { providerCode: 'transport_error' });
  assert.equal((await run.client.deleteDocument(own, file + '_doc')).value, true);
  f.cloud.state.create = 'conflict';
  await assert.rejects(run.client.createIndex(name(2), file), { providerCode: 'transport_error' });
  f.cloud.indices.set('unrelated-with-same-name', { name: name(1), fileId: 'unrelated-file' });
  run.close();

  run = f.open();
  await assert.rejects(run.start(), /empty dedicated/);
  await assert.rejects(run.cleanup(), /cleanup incomplete/);
  assert.deepEqual(f.cloud.calls.filter(call => call.op === 'delete').map(call => call.body.index_id), [own]);
  assert.deepEqual(f.cloud.calls.filter(call => call.op === 'deleteFile').map(call => call.body.fileId), [file]);
  assert.equal(f.cloud.indices.size, 2);
  assert.equal(run.budget().unresolvedAttempts.find(a => a.operation === 'create_v2')?.requestId?.startsWith('mock-request-'), true);
});
