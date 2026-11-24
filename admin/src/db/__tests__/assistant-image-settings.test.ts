import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { GET, PUT } from '@/app/api/assistant/settings/route';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { one } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { agentConfig } from '@/lib/assistant/agent/config';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import type { ActorContext } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { closePostgresPool } from '@/lib/postgresql';
import { lockAssistantAcceptance } from '../../../scripts/assistant-acceptance-safety.mjs';

const prefix = `xiaok-image-settings-${randomUUID()}`;
const tenants: string[] = [];
const admins: { id: string; role: string; enterpriseId: string | null }[] = [];
const baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const model = 'deepseek-v4.1-flash-1017';
let release: Awaited<ReturnType<typeof lockAssistantAcceptance>> | undefined;
let previousLlmConfig: unknown;
let userId: string;

before(async () => {
  loadEnvConfig(process.cwd());
  release = await lockAssistantAcceptance(process.env.DATABASE_URL);
  // Snapshot the raw JSON so an isolated clone carrying credentials encrypted
  // with another environment's key can still be restored verbatim.
  previousLlmConfig = (await withPlatformTransaction(tx => one(tx, sql`select llm_config as config from app.platform_configs where key='default'`)))?.config ?? null;
  await savePlatformLlmConfig({ enabled: true, providerKey: 'dashscope', baseUrl, model, apiKey: 'synthetic-test-only' });
  await withPlatformTransaction(async tx => {
    for (const index of [0, 1]) {
      const name = `${prefix}-${index}`;
      const row = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${name},${name},'active') returning id`))!;
      tenants.push(String(row.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${String(row.id)},true,100,1200000,100000000,30,'{"runtime":"extractive-v1","retainedTestFlag":true}'::jsonb)`);
    }
    for (const role of ['super_admin', 'admin', 'enterprise_admin', 'designer']) {
      const enterpriseId = role === 'enterprise_admin' || role === 'designer' ? tenants[0] : null;
      const row = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${enterpriseId},${`${prefix}-${role}`},'test-only',${role},'active',ARRAY['assistant-knowledge'],false) returning id`))!;
      admins.push({ id: String(row.id), role, enterpriseId });
    }
    userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix})`);
  });
});

after(async () => {
  if (!release) return;
  try {
    await withPlatformTransaction(async tx => {
      for (const admin of admins) await tx.execute(sql`delete from app.admin_users where id=${admin.id}`);
      for (const enterpriseId of tenants) {
        await deleteAssistantData(tx, BigInt(enterpriseId));
        await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`);
      }
      if (userId) await tx.execute(sql`delete from app.users where id=${userId}`);
    });
  } finally {
    try {
      await withPlatformTransaction(tx => tx.execute(sql`update app.platform_configs
        set llm_config=${previousLlmConfig === null ? null : JSON.stringify(previousLlmConfig)}::jsonb where key='default'`));
    }
    finally { await closePostgresPool(); await release(); }
  }
});

async function request(index: number, enterpriseId: string | null = tenants[0], body?: object) {
  const admin = admins[index];
  const token = await new SignJWT({ ...admin, permissions: ['assistant-knowledge'] }).setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  const req = new NextRequest('http://localhost:3006/api/assistant/settings', {
    method: body ? 'PUT' : 'GET',
    headers: { cookie: `auth_token=${token}${enterpriseId ? `; global_tenant_id=${enterpriseId}` : ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const response = await (body ? PUT(req) : GET(req));
  return { status: response.status, ...await response.json() };
}

test('image-only settings are scoped to the selected enterprise and reject stale writes', async () => {
  for (const index of [0, 1, 2]) {
    const result = await request(index);
    assert.equal(result.status, 200);
    assert.equal(result.data.enterpriseId, tenants[0]);
    assert.equal(result.data.imageInput, false);
    assert.equal(result.data.canEnableImageInput, true);
    assert.equal(result.data.initializesImageAgent, true);
  }
  assert.equal((await request(0, null)).status, 400);
  assert.equal((await request(3)).status, 403);

  const { data: initial } = await request(0);
  const enable = { expectedEnterpriseId: tenants[0], expectedVersion: initial.version, imageInput: true };
  assert.equal((await request(0, tenants[1], enable)).error, 'settings_enterprise_changed');
  const save = await request(2, tenants[0], enable);
  assert.equal(save.status, 200);
  assert.equal(save.data.imageInput, true);
  assert.equal(save.data.imageInputModel, model);
  assert.equal(save.data.version, initial.version + 1);
  assert.deepEqual((await request(1, tenants[0], enable)).data, save.data);
  assert.deepEqual((await request(0)).data, save.data);
  assert.equal((await request(0, tenants[1])).data.imageInput, false);
  assert.equal((await request(0, tenants[0], { ...enable, imageInput: false })).error, 'version_conflict');
  const persisted = await withTenantTransaction(tenants[0], tx => one(tx, sql`select agent_config from app.assistant_enterprise_settings`));
  assert.equal(agentConfig(persisted?.agent_config)?.providerKey, 'dashscope');
  assert.equal((persisted?.agent_config as { retainedTestFlag?: boolean }).retainedTestFlag, true);
});

test('saving from Admin runs existing image turns, and disabling restores upload-only receipts', async () => {
  const actor: ActorContext = { enterpriseId: tenants[0], principal: { kind: 'user', userId }, contextVersion: 1,
    capabilities: ['assistant.chat.self'] };
  const chat = new ConversationService(actor);
  const media = new AssistantMediaService(actor);
  const conversationId = String((await chat.create(randomUUID())).id);
  const image = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#f1cc24' } }).jpeg().toBuffer();
  await media.upload(conversationId, randomUUID(), image, 'image', '卫生间');
  const lease = await claimJob();
  assert.ok(lease);
  assert.equal(lease.enterpriseId, tenants[0]);
  let sawImage = false;
  await processAgentAnswer(lease, { model: async messages => {
    sawImage = messages.some(message => message.role === 'user' && message.content.some(part => part.type === 'image'));
    return { text: JSON.stringify({ kind: 'vision', text: '照片中可见黄色背景，暂时看不清其他细节。' }),
      toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 }, finishReason: 'stop', providerRequestId: null };
  } });
  assert.equal(sawImage, true);
  assert.equal((await chat.run(lease.runId)).status, 'succeeded');
  assert.match(JSON.stringify((await new ConversationService(actor).messages(conversationId)).items), /黄色背景/);

  const { data } = await request(0);
  assert.equal((await request(0, tenants[0], { expectedVersion: data.version, enterpriseKnowledgeEnabled: true })).status, 200);
  const { data: updated } = await request(0);
  assert.equal(updated.imageInput, true);
  const off = await request(1, tenants[0], { expectedVersion: updated.version, expectedEnterpriseId: tenants[0], imageInput: false });
  assert.equal(off.status, 200);
  assert.equal(off.data.enterpriseKnowledgeEnabled, true);
  assert.deepEqual((await request(0)).data, off.data);
  await media.upload(conversationId, randomUUID(), image, 'image', '卫生间');
  assert.equal(await claimJob(), null);
  assert.match(JSON.stringify((await chat.messages(conversationId)).items), /目前小K暂不能识别图片内容/);
});

test('enabling refuses unverified endpoints and permits neither a fake model nor a version bump', async () => {
  await savePlatformLlmConfig({ enabled: true, providerKey: 'dashscope', baseUrl: 'https://test-provider.invalid/v1', model,
    apiKey: 'synthetic-test-only' });
  const { data } = await request(0);
  assert.equal(data.canEnableImageInput, false);
  const blocked = await request(0, tenants[0], { expectedVersion: data.version, expectedEnterpriseId: tenants[0], imageInput: true });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.error, 'image_input_unavailable');
  assert.deepEqual((await request(0)).data, data);
});
