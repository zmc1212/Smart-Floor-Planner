import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deletePortfolioData } from '@/db/repositories/portfolio-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { PortfolioService } from '@/lib/portfolio/service';
import { PortfolioCopyService, type CopyPorts } from '@/lib/portfolio/copy-service';
import { workContent } from '@/lib/portfolio/contracts';
import { portfolioCopyBudget } from '@/lib/assistant/core/model-task-budget';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';

const prefix = 'SYNTHETIC-D3-COPY-' + randomUUID(), tenants: string[] = [], designers: string[][] = [], managers: string[] = [], platform: string[] = [];
const initialDailyLimits = process.env.ASSISTANT_DAILY_LIMITS_ENABLED;
before(() => { process.env.ASSISTANT_DAILY_LIMITS_ENABLED = '1'; });
after(() => {
  if (initialDailyLimits === undefined) delete process.env.ASSISTANT_DAILY_LIMITS_ENABLED;
  else process.env.ASSISTANT_DAILY_LIMITS_ENABLED = initialDailyLimits;
});
let runtime: AiProviderRuntimeConfig, generated = 0;
const output: ModelTurnOutput = { text: JSON.stringify({ title: '原木客餐厅收纳参考', description: 'AI生成效果图展示客餐厅收纳思路。', shareText: '分享一份原木客餐厅收纳参考，欢迎聊聊家里的使用习惯。', checks: ['实施与材料待核对'] }), toolCalls: [], finishReason: 'stop', providerRequestId: 'synthetic-only', usage: { inputTokens: 50, outputTokens: 60 } };
const ports: CopyPorts = { runtime: async () => runtime, generate: async () => { generated++; return structuredClone(output); } };
const actor = (tenant = 0, index = 0) => ({ enterpriseId: tenants[tenant], adminId: designers[tenant][index] });
const service = (tenant = 0, index = 0) => new PortfolioService(actor(tenant, index));
const copy = (custom = ports, tenant = 0, index = 0) => new PortfolioCopyService(actor(tenant, index), custom);
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  const configured = await getPlatformLlmOverrideRuntime('chat'); assert.ok(configured);
  runtime = { ...configured, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', adapterType: 'openai_compatible', modelMappings: { ...configured.modelMappings, 'chat.general': 'qwen3.8-flash' }, apiKey: 'SYNTHETIC-NO-NETWORK' };
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + n},${prefix + n},'active') returning id`))!; const eid = String(enterprise.id); tenants.push(eid); designers.push([]);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,100,4000000,100000000,30)`);
      for (let i = 0; i < 3; i++) {
        const role = i === 2 ? 'enterprise_admin' : 'designer';
        const staff = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(${eid},${prefix + n + i},'SYNTHETIC-ONLY',${role},'active',false,'合成文案员工') returning id`))!;
        if (i === 2) managers.push(String(staff.id)); else designers[n].push(String(staff.id));
      }
    }
    for (const role of ['admin', 'super_admin']) platform.push(String((await one(tx, sql`insert into app.admin_users(username,password_hash,role,status,must_change_password) values(${prefix + role},'SYNTHETIC-ONLY',${role},'active',false) returning id`))!.id));
  });
});
after(async () => { try { await withPlatformTransaction(async tx => { for (const eid of tenants) { await deletePortfolioData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid)); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`); } for (const aid of platform) await tx.execute(sql`delete from app.admin_users where id=${aid}`); }); } finally { await closePostgresPool(); } });
async function make() {
  const w = await service().execute('create', { content: workContent({ title: '原木草稿', description: '客餐厅收纳', primaryStyle: '原木风', source: '合成作者/测试素材', authorization: '仅本隔离测试使用' }) }, randomUUID());
  return String(w.id);
}
const request = { expectedVersion: 1, instruction: '介绍客餐厅收纳，分享时语气自然一些。' };
test('durable generation is concurrent-idempotent, recoverable with the original key, and does not modify the work', async () => {
  const wid = await make(), key = randomUUID(), count = generated;
  const [a, b] = await Promise.all([copy().create(wid, request, key), copy().create(wid, request, key)]); assert.deepEqual(a, b);
  await assert.rejects(copy().create(wid, { ...request, instruction: 'changed' }, key), /idempotency_conflict/);
  const processed = await Promise.all([copy().process(a.id), copy().process(a.id)]); assert.equal(processed.filter(Boolean).length, 1); assert.equal(generated, count + 1);
  assert.equal((await copy().latest(wid)).task?.state, 'completed');
  assert.equal((await copy({ ...ports, runtime: async () => null }).create(wid, request, key)).id, a.id);
  const detail = await service().execute('detail', { workId: wid }); assert.equal((detail.head as Row).content && ((detail.head as Row).content as Row).title, '原木草稿');
});
test('explicit adoption preserves provenance and other fields; original-key recovery writes once and survives reentry', async () => {
  const wid = await make(), t = await copy().create(wid, request, randomUUID()); await copy().process(t.id);
  const before = await service().execute('detail', { workId: wid }), key = randomUUID(), body = { workId: wid, taskId: t.id, expectedVersion: 1 };
  const saved = await service().execute('adoptCopy', body, key); assert.equal(saved.version, 2); assert.deepEqual(await service().execute('adoptCopy', body, key), saved);
  const after = await service().execute('detail', { workId: wid }), previous = (before.head as Row).content as Row, current = (after.head as Row).content as Row;
  assert.equal(current.title, '原木客餐厅收纳参考'); assert.equal((after.head as Row).status, 'draft');
  for (const field of Object.keys(previous).filter(k => !['title','description'].includes(k))) assert.deepEqual(current[field], previous[field]);
  assert.equal((await copy().latest(wid)).task?.adopted, true);
  assert.equal((after.audits as Row[]).filter(a => a.action === 'adoptCopy').length, 1);
});
test('other authors and tenants cannot read, create or adopt; owner, admin and super_admin inherit management in the selected tenant', async () => {
  const wid = await make(); await assert.rejects(copy(ports, 0, 1).create(wid, request, randomUUID()), /not_found/); await assert.rejects(copy(ports, 1).latest(wid), /not_found/);
  const task = await copy().create(wid, request, randomUUID()); await copy().process(task.id); assert.equal((await copy(ports, 0, 1).latest(wid).catch(() => null)), null);
  for (const aid of [managers[0], ...platform]) {
    const manager = { enterpriseId: tenants[0], adminId: aid }, own = new PortfolioCopyService(manager, ports), work = await new PortfolioService(manager).execute('create', { authorId: designers[0][0], content: { source: '合成来源', authorization: '合成许可' } }, randomUUID());
    const created = await own.create(String(work.id), request, randomUUID()); await own.process(created.id);
    assert.equal((await new PortfolioService(manager).execute('adoptCopy', { workId: String(work.id), taskId: created.id, expectedVersion: 1 }, randomUUID())).version, 2);
  }
  const isolated = await withTenantTransaction(tenants[1], tx => rows(tx, sql`select id from app.assistant_model_tasks where id=${task.id}`)); assert.deepEqual(isolated, []);
});
test('source edits before dispatch cancel without calling a model; edits after generation hide stale copy and reject adoption', async () => {
  const wid = await make(), t = await copy().create(wid, request, randomUUID()), count = generated;
  const d = await service().execute('detail', { workId: wid }); await service().execute('save', { workId: wid, expectedVersion: 1, content: { ...(d.head as Row).content as Row, title: '新资料' } }, randomUUID());
  assert.equal(await copy().process(t.id), false); assert.equal(generated, count); assert.equal((await copy().latest(wid)).task?.result, null);
  const next = await copy().create(wid, { ...request, expectedVersion: 2 }, randomUUID()); await copy().process(next.id);
  const d2 = await service().execute('detail', { workId: wid }); await service().execute('save', { workId: wid, expectedVersion: 2, content: { ...(d2.head as Row).content as Row, source: '更正的许可来源' } }, randomUUID());
  assert.equal((await copy().latest(wid)).task?.state, 'stale'); await assert.rejects(service().execute('adoptCopy', { workId: wid, taskId: next.id, expectedVersion: 3 }, randomUUID()), /stale/);
});
test('provider failure is indeterminate, retains its reservation and cannot be automatically retried', async () => {
  const wid = await make(), count = generated, broken: CopyPorts = { ...ports, generate: async () => { generated++; throw Error('synthetic lost provider response'); } };
  const t = await copy(broken).create(wid, request, randomUUID()); await copy(broken).process(t.id); assert.equal((await copy().latest(wid)).task?.state, 'indeterminate');
  assert.equal(await copy(broken).process(t.id), false); assert.equal(generated, count + 1); await assert.rejects(copy().create(wid, request, randomUUID()), /pending/);
  const held = await withTenantTransaction(tenants[0], tx => portfolioCopyBudget(tx, tenants[0])); assert.ok(Number(held.cost) >= 1000000);
});
test('malformed first output and original usage are retained without a repair call', async () => {
  const wid = await make(), broken: CopyPorts = { ...ports, generate: async () => ({ ...output, text: '[]' }) };
  const t = await copy(broken).create(wid, request, randomUUID()); await copy(broken).process(t.id); assert.equal((await copy().latest(wid)).task?.state, 'failed');
  const item = await withTenantTransaction(tenants[0], tx => one(tx, sql`select result,response_hash from app.assistant_model_task_items where enterprise_id=${tenants[0]} and task_id=${t.id}`));
  assert.equal((item!.result as Row).text, '[]'); assert.deepEqual((item!.result as Row).usage, output.usage); assert.ok(item!.response_hash);
});
test('permission revoked while a provider is running suppresses copy but retains the original response/accounting', async () => {
  const wid = await make(), revoke: CopyPorts = { ...ports, generate: async () => { await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${designers[0][0]}`)); return structuredClone(output); } };
  const t = await copy(revoke).create(wid, request, randomUUID());
  try {
    await copy(revoke).process(t.id); await assert.rejects(copy().latest(wid), /forbidden/);
    const row = await withTenantTransaction(tenants[0], tx => one(tx, sql`select t.state,t.result,i.response_hash from app.assistant_model_tasks t join app.assistant_model_task_items i on i.enterprise_id=t.enterprise_id and i.task_id=t.id where t.enterprise_id=${tenants[0]} and t.id=${t.id}`));
    assert.equal(row!.state, 'failed'); assert.equal(row!.result, null); assert.ok(row!.response_hash);
  } finally { await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${designers[0][0]}`)); }
});
test('expired rights and shared daily budget refuse allocation before provider I/O', async () => {
  const wid = await make(), detail = await service().execute('detail', { workId: wid });
  await service().execute('save', { workId: wid, expectedVersion: 1, content: { ...(detail.head as Row).content as Row, rightsUntil: '2020-01-01T00:00:00.000Z' } }, randomUUID());
  await assert.rejects(copy().create(wid, { ...request, expectedVersion: 2 }, randomUUID()), /expired/);
  const next = await make(); await withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.assistant_enterprise_settings set daily_requests=1 where enterprise_id=${tenants[0]}`));
  try {
    await assert.rejects(copy().create(next, request, randomUUID()), /quota/);
    delete process.env.ASSISTANT_DAILY_LIMITS_ENABLED;
    const key = randomUUID(), count = generated;
    const task = await copy().create(next, request, key);
    assert.equal((await copy().create(next, request, key)).id, task.id);
    assert.equal((await copy().latest(next)).task?.state, 'prepared');
    assert.equal(generated, count, 'allocation never dispatches the provider');
  } finally {
    process.env.ASSISTANT_DAILY_LIMITS_ENABLED = '1';
    await withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.assistant_enterprise_settings set daily_requests=100 where enterprise_id=${tenants[0]}`));
  }
});
test('unreconciled dispatched holds survive UTC rollover, including completed/failed/cancelled tasks', async () => {
  const before = await withTenantTransaction(tenants[0], tx => portfolioCopyBudget(tx, tenants[0]));
  await withTenantTransaction(tenants[0], async tx => {
    for (const state of ['completed', 'failed', 'cancelled', 'cancelled']) {
      const dispatched = state !== 'cancelled' || !await one(tx, sql`select id from app.assistant_model_tasks where enterprise_id=${tenants[0]} and request->>'syntheticAccounting'='cancelled'`);
      await tx.execute(sql`insert into app.assistant_model_tasks(enterprise_id,created_by,operation_key,kind,state,binding,request,request_hash,authorization_id,reserved_tokens,reserved_cost_micros,created_at)
        values(${tenants[0]},${designers[0][0]},${randomUUID()},'portfolio_copy',${state},'{}'::jsonb,${JSON.stringify({ syntheticAccounting: state })}::jsonb,${'0'.repeat(64)},${dispatched ? 'synthetic-accounting-only' : null},16000,1000000,now()-interval '2 days')`);
    }
  });
  const after = await withTenantTransaction(tenants[0], tx => portfolioCopyBudget(tx, tenants[0]));
  assert.equal(Number(after.requests) - Number(before.requests), 3);
  assert.equal(BigInt(String(after.cost)) - BigInt(String(before.cost)), 3000000n);
  assert.equal(BigInt(String(after.tokens)) - BigInt(String(before.tokens)), 48000n);
});
