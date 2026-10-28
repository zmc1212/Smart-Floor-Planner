import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { deletePortfolioData } from '@/db/repositories/portfolio-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { agentChatBody, parseAgentChat } from '@/lib/ai/providers/agent-chat';
import { PortfolioService } from '@/lib/portfolio/service';
import { PortfolioCopyService, type CopyPorts } from '@/lib/portfolio/copy-service';
import { copyFacts } from '@/lib/portfolio/copy-contract';
import { fingerprint } from '@/lib/assistant/contracts';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

// Optional saved-I/O regression, explicitly separate from first-draft results.
// Run with PORTFOLIO_COPY_TRACE_DIR pointing to the immutable live batch.
const traces = process.env.PORTFOLIO_COPY_TRACE_DIR;
let eid = '', aid = '', designer = '', runtime: AiProviderRuntimeConfig;
const originalFetch = globalThis.fetch;
before(async () => {
  if (!traces) return;
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  globalThis.fetch = async () => { throw Error('Saved-trace regression forbids provider/network calls'); };
  const configured = await getPlatformLlmOverrideRuntime('chat'); assert.ok(configured);
  runtime = { ...configured, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', adapterType: 'openai_compatible', apiKey: 'SYNTHETIC-REPLAY-ONLY', modelMappings: { ...configured.modelMappings, 'chat.general': 'qwen3.8-flash' } };
  await withPlatformTransaction(async tx => {
    const name = 'SYNTHETIC-D3-SAVED-REPLAY-' + randomUUID();
    eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${name},${name},'active') returning id`))!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,100,4000000,100000000,30)`);
    for (const role of ['enterprise_admin', 'designer']) {
      const id = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${eid},${name+role},'SYNTHETIC-NO-LOGIN',${role},'active',false) returning id`))!.id);
      if (role === 'enterprise_admin') aid = id; else designer = id;
    }
  });
});
after(async () => { try { if (eid) await withPlatformTransaction(async tx => { await deletePortfolioData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid)); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`); }); } finally { globalThis.fetch = originalFetch; await closePostgresPool(); } });
for (let index = 1; index <= 4; index++) test(`saved first response ${index}: identical wire input, real durable completion/adoption; zero model calls`, { skip: !traces }, async () => {
  const trace = JSON.parse(fs.readFileSync(path.join(traces!, `wire-${index}.json`), 'utf8'));
  assert.equal(trace.status, 200);
  const { facts, instruction } = JSON.parse(trace.body.messages[1].content[0].text);
  const { kind, images, ...publicContent } = facts;
  const owner = { enterpriseId: eid, adminId: aid }, work = new PortfolioService(owner);
  const created = await work.execute('create', { kind, ...(kind === 'designer_work' ? { authorId: designer } : {}), content: { showOnProfile: kind === 'designer_work' } }, randomUUID());
  const wid = String(created.id), bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c8baa5' } }).jpeg().toBuffer();
  const uploaded = await work.execute('upload', { workId: wid, expectedVersion: 1, imageBase64: bytes.toString('base64') }, randomUUID());
  await work.execute('save', { workId: wid, expectedVersion: 1, content: { ...publicContent, authorRole: '合成测试角色', cityCode: '330100', cityName: '杭州市', source: '合成原稿重放来源', authorization: '仅本隔离重放测试许可', showOnProfile: kind === 'designer_work',
    images: images.map((image: Row) => ({ ...image, assetId: String(uploaded.assetId) })), coverAssetId: String(uploaded.assetId) } }, randomUUID());
  const ports: CopyPorts = { runtime: async () => runtime, generate: async (_runtime, input) => {
    assert.deepEqual(agentChatBody(input, runtime.baseUrl), trace.body, 'No prompt, schema, facts or request change');
    return parseAgentChat(JSON.parse(trace.rawResponse));
  } };
  const service = new PortfolioCopyService(owner, ports), task = await service.create(wid, { expectedVersion: 2, instruction }, randomUUID());
  await service.process(task.id); assert.equal((await service.latest(wid)).task?.state, 'completed');
  const adopted = await work.execute('adoptCopy', { workId: wid, expectedVersion: 2, taskId: task.id }, randomUUID()); assert.equal(adopted.version, 3);
  const detail = await work.execute('detail', { workId: wid }); assert.equal((detail.head as Row).status, 'draft');
  const request = await withTenantTransaction(eid, tx => one(tx, sql`select request from app.assistant_model_tasks where enterprise_id=${eid} and id=${task.id}`));
  assert.equal(fingerprint((request!.request as Row).facts), fingerprint(facts));
  const content = (detail.head as Row).content; assert.equal(copyFacts(content as Parameters<typeof copyFacts>[0], kind).kind, kind);
  assert.equal((content as Row).source, '合成原稿重放来源'); assert.equal((content as Row).authorization, '仅本隔离重放测试许可');
});
