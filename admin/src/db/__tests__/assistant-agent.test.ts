import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { HandoffService } from '@/lib/assistant/handoff/service';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { readMemory } from '@/lib/assistant/agent/memory';
import sharp from 'sharp';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';

const prefix = 'p2m-' + randomUUID(), tenants: string[] = [], users: string[] = [];
let actor: ActorContext, stranger: ActorContext;
const deepseekLive = process.env.ASSISTANT_P2M_DEEPSEEK_PROBE === '1' && process.env.ASSISTANT_P2M_LIVE === '1';
const config = { runtime: 'langgraph-v1', model: deepseekLive ? 'deepseek-flash' : 'Qwen/Qwen3.5-4B', providerKey: deepseekLive ? 'deepseek' : 'siliconflow', imageInput: true, tools: true, probeVersion: 'p2m0-synthetic-v1' };
let priorProvider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
const response = (text = '可以先考虑靠窗摆桌，并保留走道。'): ModelTurnOutput => ({ text: JSON.stringify({ kind: 'general', text }), toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 }, finishReason: 'stop', providerRequestId: null });
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  if (deepseekLive) {
    const primary = new URL(process.env.ASSISTANT_P2M_PRIMARY_DATABASE_URL || '');
    assert.ok(['localhost','127.0.0.1'].includes(primary.hostname)); assert.equal(primary.port, '5432'); assert.equal(primary.pathname, '/smart_floor_planner');
    const evaluationUrl = process.env.DATABASE_URL;
    await closePostgresPool();
    let provider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>;
    try { process.env.DATABASE_URL = primary.toString(); provider = await getPlatformLlmRuntimeConfig(); }
    finally { await closePostgresPool(); process.env.DATABASE_URL = evaluationUrl; }
    assert.equal(provider.providerKey, 'deepseek'); assert.equal(new URL(provider.baseUrl).origin, 'https://api.deepseek.com');
    priorProvider = await getPlatformLlmRuntimeConfig();
    await savePlatformLlmConfig({ enabled: true, providerKey: 'deepseek', baseUrl: provider.baseUrl, model: 'deepseek-flash', apiKey: provider.apiKey });
  }
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const e = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!; tenants.push(String(e.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${tenants[i]},true,1000,12000000,1000000000,30,${JSON.stringify(config)}::jsonb)`);
      const u = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!; users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix+i})`);
    }
  });
  actor = { enterpriseId: tenants[0], principal: { kind: 'user', userId: users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  stranger = { ...actor, enterpriseId: tenants[1], principal: { kind: 'user', userId: users[1] } };
});
after(async () => {
  try { await withPlatformTransaction(async tx => { for (const t of tenants) { await deleteAssistantData(tx, BigInt(t)); await tx.execute(sql`delete from app.enterprises where id=${t}`); }
    for (const u of users) await tx.execute(sql`delete from app.users where id=${u}`); });
  } finally { try { if (priorProvider) await savePlatformLlmConfig(priorProvider); } finally { await closePostgresPool(); } }
});
async function start(text = '小书房怎样摆桌？', conversationId?: string) {
  const chat = new ConversationService(actor), c = conversationId || String((await chat.create(randomUUID())).id);
  const sent = await chat.send(c, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  return { chat, c, sent, lease };
}
async function diagnostic(runId: string) {
  return withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,status,private_checkpoint->'text' as output,private_checkpoint->'toolCalls' as calls
    from app.assistant_run_steps where run_id=${runId} and kind='agent_model' order by step_seq`));
}
test('natural conversation persists/reenters without knowledge and includes both sides of history', async () => {
  const a = await start(); await processAgentAnswer(a.lease, { model: async () => response() });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded');
  const b = await start('那如果要两个人用呢？', a.c);
  await processAgentAnswer(b.lease, { model: async messages => { assert.ok(messages.some(m => m.role === 'assistant')); assert.match(JSON.stringify(messages), /小书房怎样摆桌/); return response('可以比较一张长桌和两张独立桌。'); } });
  const reentry = await new ConversationService(actor).messages(a.c); assert.equal(reentry.items.length, 4);
  await assert.rejects(new ConversationService(stranger).messages(a.c), /assistant_resource_not_found/);
});
test('source-linked semantic memory writes once, survives reentry and preserves room facts', async () => {
  let c: string | undefined;
  for (const [room, field, value] of [['书房','daylight','采光好'],['书房','desk','双人桌'],['次卧','use','客房']]) {
    const a = await start(room+'要'+value, c); c = a.c;
    await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => turn === 0 ? { ...response(), text: '', toolCalls: [{ id: 'need', name: 'record_need',
      arguments: JSON.stringify({ room, field, value, quote: room+'要'+value }) }] } : response('记下了，可以继续聊。') });
    assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded');
  }
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${c!}`));
  assert.equal(readMemory(stored?.entry_snapshot).facts.filter(f => f.status === 'current').length, 3);
});
test('takeover during provider call suppresses late AI and checkpoint; usage remains auditable', async () => {
  const a = await start();
  await processAgentAnswer(a.lease, { model: async () => { await new HandoffService(actor).customerWrite(a.c, randomUUID(), { action: 'request' }); return response(); } });
  assert.equal((await a.chat.detail(a.c)).mode, 'handoff_requested');
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
  assert.equal((await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_usage_records where run_id=${String(a.sent.runId)}`))).length, 1);
});
test('unknown provider outcome is indeterminate and cannot silently retry', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => { calls++; throw Error('network lost'); } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'indeterminate'); assert.equal(calls, 1);
  await assert.rejects(a.chat.run(String(a.sent.runId), 'retry', randomUUID()), /context_changed|run_not_retryable/);
});
test('first image schedules one recoverable run; withdrawal hides derived answers and excludes private image bytes from checkpoints', async () => {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id), media = new AssistantMediaService(actor);
  const bytes = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#cc1122' } }).png().toBuffer();
  const request = randomUUID(), uploaded = await media.upload(c, request, bytes, 'image', '');
  assert.deepEqual(await media.upload(c, request, bytes, 'image', ''), uploaded);
  const lease = await claimJob(); assert.ok(lease);
  await processAgentAnswer(lease, { model: async messages => {
    assert.match(JSON.stringify(messages), /image\/jpeg/);
    assert.ok(messages.some(m => m.role === 'user' && m.content.some(p => p.type === 'image' && p.data.length > 100)));
    return { ...response(), text: JSON.stringify({ kind: 'vision', text: '图中可见一片红色，暂时看不到房间细节。你想咨询哪部分？' }) };
  } });
  assert.equal((await chat.run(lease.runId)).status, 'succeeded');
  const saved = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps where run_id=${lease.runId} and kind='agent_checkpoint'`));
  assert.match(JSON.stringify(saved), /"data":""/);
  const handoff = new HandoffService(actor);
  await handoff.customerWrite(c, randomUUID(), { action: 'request' });
  await media.remove(c, String(uploaded.id));
  assert.doesNotMatch(JSON.stringify(await handoff.customerRead(c)), /一片红色/);
  await handoff.customerWrite(c, randomUUID(), { action: 'cancel' });
  const messages = await chat.messages(c);
  assert.equal(messages.items.find(m => m.authorKind === 'assistant')?.available, false);
  const a = await start('刚才图片有什么？', c);
  await processAgentAnswer(a.lease, { model: async messages => { assert.doesNotMatch(JSON.stringify(messages), /一片红色/); return response('图片已经不可用，请重新发送。'); } });
});

test('expired lease resumes a durable completed provider step without another model call', async () => {
  const a = await start();
  await withTenantTransaction(actor.enterpriseId, async tx => {
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint)
      values(${actor.enterpriseId},${a.lease.runId},1100,'agent_model','succeeded',${JSON.stringify(response())}::jsonb)`);
    await tx.execute(sql`update app.assistant_jobs set provider_started_at=now(),lease_expires_at=now()-interval '1 second'
      where enterprise_id=${actor.enterpriseId} and id=${a.lease.jobId}`);
  });
  const recovered = await claimJob(); assert.ok(recovered); assert.equal(recovered.runId, a.lease.runId);
  let calls = 0;
  await processAgentAnswer(recovered, { model: async () => { calls++; return response(); } });
  assert.equal(calls, 0);
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded');
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 1);
});

test('controlled business query renders the stored result and rejects foreign resource IDs', async () => {
  const a = await start('查询我的预约');
  await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => turn === 0
    ? { ...response(), text: '', toolCalls: [{ id: 'query', name: 'query_business', arguments: JSON.stringify({ domain: 'appointments', leadId: '' }) }] }
    : { ...response(), text: JSON.stringify({ kind: 'business', resultKey: `${a.lease.runId}:0:0` }) } });
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded');
  assert.match(JSON.stringify(await a.chat.messages(a.c)), /目前没有查到/);
  const b = await start('查询另外一个预约');
  await processAgentAnswer(b.lease, { model: async () => ({ ...response(), text: '', toolCalls: [{ id: 'query', name: 'query_business', arguments: JSON.stringify({ domain: 'appointments', leadId: '999999999999' }) }] }) });
  assert.notEqual((await b.chat.run(b.lease.runId)).status, 'succeeded');
  assert.equal((await b.chat.messages(b.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
});

test('model cannot rewrite business tool results as invented prose', async () => {
  const a = await start('我的预约确认了吗');
  await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => turn === 0
    ? { ...response(), text: '', toolCalls: [{ id: 'query', name: 'query_business', arguments: JSON.stringify({ domain: 'appointments', leadId: '' }) }] }
    : response('预约已经确认。') });
  assert.notEqual((await a.chat.run(a.lease.runId)).status, 'succeeded');
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
});

test('a claimed save without a successful memory write never becomes a customer answer', async () => {
  const a = await start('书房要双人桌');
  await processAgentAnswer(a.lease, { model: async () => response('已记录书房需求。') });
  assert.notEqual((await a.chat.run(a.lease.runId)).status, 'succeeded');
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
});

test('invalid memory extraction receives bounded feedback and writes only the corrected quote', async () => {
  const a = await start('书房要双人桌');
  await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => turn < 2 ? { ...response(), text: '', toolCalls: [{ id: 'need', name: 'record_need',
    arguments: JSON.stringify({ room: '书房', field: 'desk', value: turn === 0 ? '四人桌' : '双人桌', quote: '书房要双人桌' }) }] } : response('已记录书房的双人桌需求。') });
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded');
  const c = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.deepEqual(readMemory(c?.entry_snapshot).facts.map(f => f.value), ['双人桌']);
});

test('ambiguous room write is rejected without mutation and clarification is delivered', async () => {
  const a = await start('那间房改成三人书桌，请记录。');
  await processAgentAnswer(a.lease, { model: async (messages,_tools,turn) => {
    if (!turn) return { ...response(),text:'',toolCalls:[{id:'need',name:'record_need',arguments:JSON.stringify({room:'',field:'desk',value:'三人书桌',quote:'那间房改成三人书桌，请记录。'})}] };
    assert.match(JSON.stringify(messages),/need_room_ambiguous/);
    return response('请确认具体是哪间房间，我再记录。');
  } });
  assert.equal((await a.chat.run(a.lease.runId)).status,'succeeded');
  const row = await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.equal(readMemory(row?.entry_snapshot).facts.length,0);
});

test('opt-in extended live ambiguous room is clarified before persistence', { skip: !deepseekLive || process.env.ASSISTANT_P2M_EXTENDED !== '1' }, async () => {
  let c: string | undefined;
  for (const text of ['请记住，书房需要双人书桌。','请记住，次卧需要单人书桌。']) {
    const a=await start(text,c); c=a.c; await processAgentAnswer(a.lease);
    assert.equal((await a.chat.run(a.lease.runId)).status,'succeeded');
  }
  const read=async()=>readMemory((await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select entry_snapshot from app.assistant_conversations where id=${c!}`)))?.entry_snapshot);
  const before=await read();
  const a=await start('那间房改成三人书桌，请记录。',c); await processAgentAnswer(a.lease);
  assert.equal((await a.chat.run(a.lease.runId)).status,'succeeded',JSON.stringify(await diagnostic(a.lease.runId)));
  assert.deepEqual(await read(),before);
  const reply=(await a.chat.messages(a.c)).items.filter(m=>m.authorKind==='assistant').sort((a,b)=>Number(b.seq)-Number(a.seq))[0];
  assert.match(JSON.stringify(reply),/哪|书房.*还是.*次卧|次卧.*还是.*书房/);
  const b=await start('我说的是次卧，次卧改成三人书桌，请记录。',c);await processAgentAnswer(b.lease);
  assert.equal((await b.chat.run(b.lease.runId)).status,'succeeded');
  const current=(await read()).facts.filter(f=>f.status==='current');
  assert.ok(current.some(f=>f.room==='次卧'&&f.value.includes('三人')));
  assert.ok(current.some(f=>f.room==='书房'&&f.value.includes('双人')));
  assert.ok(current.every(f=>f.room));
});

test('opt-in live model completes a synthetic natural conversation through the durable worker', { skip: process.env.ASSISTANT_P2M_LIVE !== '1' }, async () => {
  const a = await start('只讨论通用思路：小书房两个人办公，怎样兼顾采光？暂时不用记录需求。');
  await processAgentAnswer(a.lease);
  const run = await a.chat.run(a.lease.runId);
  const steps = run.status === 'succeeded' ? [] : await diagnostic(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify({ run, steps }));
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 1);
  const usage = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select measurement_kind,input_tokens,output_tokens from app.assistant_usage_records where run_id=${a.lease.runId}`));
  assert.ok(usage.some(u => u.measurement_kind === 'observed' && Number(u.input_tokens) > 0));
});

test('opt-in live model sees a first synthetic picture', { skip: process.env.ASSISTANT_P2M_LIVE !== '1' }, async () => {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
  const bytes = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#dd2233' } }).png().toBuffer();
  await new AssistantMediaService(actor).upload(c, randomUUID(), bytes, 'image', '');
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select data from app.assistant_media where conversation_id=${c}`));
  const pixels = await sharp(stored!.data as Buffer).stats();
  assert.ok(pixels.channels[0].mean > 180 && pixels.channels[1].mean < 80 && pixels.channels[2].mean < 100, 'stored normalized image must remain red');
  const lease = await claimJob(); assert.ok(lease);
  await processAgentAnswer(lease);
  assert.equal((await chat.run(lease.runId)).status, 'succeeded', JSON.stringify({ run: await chat.run(lease.runId), steps: await diagnostic(lease.runId) }));
  assert.match(JSON.stringify(await chat.messages(c)), /红/);
  if (deepseekLive) {
    const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select step_seq,status,private_checkpoint from app.assistant_run_steps where run_id=${lease.runId} and kind='agent_model' order by step_seq`));
    assert.deepEqual(steps.map(s => Number(s.step_seq)), [1090,1100]);
    assert.ok(steps.every(s => s.status === 'succeeded'));
    assert.ok(!JSON.stringify(steps).includes('data:image'));
    const usage = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select operation_key from app.assistant_usage_records where run_id=${lease.runId} and category='tokens'`));
    assert.equal(usage.length, 2);
  }
});

test('withdrawal during perception prevents the subsequent Agent call and hides any reply', async () => {
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify({ ...config, providerKey: 'deepseek', model: 'deepseek-flash' })}::jsonb where enterprise_id=${actor.enterpriseId}`));
  try {
    const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
    const media = new AssistantMediaService(actor);
    const bytes = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#dd2233' } }).png().toBuffer();
    await media.upload(c, randomUUID(), bytes, 'image', '');
    const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select id from app.assistant_media where conversation_id=${c}`));
    const lease = await claimJob(); assert.ok(lease);
    let reasoningCalls = 0;
    await processAgentAnswer(lease, {
      vision: async () => { await media.remove(c, String(stored!.id)); return { ...response(), text: '来源图片是红色。' }; },
      model: async () => { reasoningCalls++; return response(); },
    });
    assert.equal(reasoningCalls, 0);
    assert.equal((await chat.messages(c)).items.filter(m => m.authorKind === 'assistant').length, 0);
  } finally {
    await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(config)}::jsonb where enterprise_id=${actor.enterpriseId}`));
  }
});

test('opt-in live model uses an authorized business tool', { skip: process.env.ASSISTANT_P2M_LIVE !== '1' }, async () => {
  const a = await start('请查询我目前在本企业的预约记录。');
  await processAgentAnswer(a.lease);
  const run = await a.chat.run(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const results = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_run_steps where run_id=${a.lease.runId} and kind='agent_business_result'`));
  assert.equal(results.length, 1, JSON.stringify(await diagnostic(a.lease.runId)));
});

test('opt-in live model writes explicitly requested synthetic memory', { skip: process.env.ASSISTANT_P2M_LIVE !== '1' }, async () => {
  const a = await start('请记住，书房要双人桌。');
  await processAgentAnswer(a.lease);
  const run = await a.chat.run(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const c = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.ok(readMemory(c?.entry_snapshot).facts.some(f => f.room === '书房' && f.value.includes('双人桌')), JSON.stringify(await diagnostic(a.lease.runId)));
});

test('opt-in extended live correction survives reentry without replacing another room', { skip: !deepseekLive || process.env.ASSISTANT_P2M_EXTENDED !== '1' }, async () => {
  let conversationId: string | undefined;
  for (const text of ['请记住，书房需要双人书桌。', '请记住，次卧用作客房。', '更正一下，书房改成单人书桌，请记录。']) {
    const a = await start(text, conversationId); conversationId = a.c;
    await processAgentAnswer(a.lease);
    assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded', JSON.stringify(await diagnostic(a.lease.runId)));
  }
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${conversationId!}`));
  const memory = readMemory(stored?.entry_snapshot);
  const current = memory.facts.filter(f => f.status === 'current');
  assert.ok(current.some(f => f.room === '书房' && f.field === 'desk' && f.value.includes('单人')));
  assert.ok(current.some(f => f.room === '次卧' && f.field === 'use' && f.value.includes('客房')));
  const prior = memory.facts.find(f => f.room === '书房' && f.value.includes('双人'));
  assert.equal(prior?.status, 'superseded');
  assert.equal(current.find(f => f.room === '书房' && f.field === 'desk')?.supersedes, prior?.id);
  const a = await start('回顾书房和次卧需求，不要新增记录。', conversationId);
  await processAgentAnswer(a.lease);
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded', JSON.stringify(await diagnostic(a.lease.runId)));
  const reentry = await new ConversationService(actor).messages(a.c);
  const last = reentry.items.filter(m => m.authorKind === 'assistant').sort((a,b) => Number(b.seq)-Number(a.seq))[0];
  assert.match(JSON.stringify(last), /单人/); assert.match(JSON.stringify(last), /客房/);
  const after = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.deepEqual(readMemory(after?.entry_snapshot), memory);
});

test('opt-in extended live public renovation photo survives upload and followup then revokes', { skip: !deepseekLive || process.env.ASSISTANT_P2M_EXTENDED !== '1' }, async () => {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
  const media = new AssistantMediaService(actor);
  const bytes = fs.readFileSync(path.resolve('../tmp/xiaok-vector/renovation-photos/demolition.jpg'));
  const uploaded = await media.upload(c, randomUUID(), bytes, 'image', '');
  const lease = await claimJob(); assert.ok(lease);
  await processAgentAnswer(lease);
  assert.equal((await chat.run(lease.runId)).status, 'succeeded', JSON.stringify(await diagnostic(lease.runId)));
  assert.match(JSON.stringify((await chat.messages(c)).items.filter(m => m.authorKind === 'assistant')), /梯/);
  const a = await start('仅凭刚才的照片能确定墙可以拆吗？', c);
  await processAgentAnswer(a.lease);
  assert.equal((await chat.run(a.lease.runId)).status, 'succeeded', JSON.stringify(await diagnostic(a.lease.runId)));
  const last = (await new ConversationService(actor).messages(c)).items.filter(m => m.authorKind === 'assistant').sort((a,b) => Number(b.seq)-Number(a.seq))[0];
  assert.match(JSON.stringify(last), /不能|无法|不足以|不可以/);
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${c}`));
  assert.equal(readMemory(stored?.entry_snapshot).facts.length, 0);
  await media.remove(c, String(uploaded.id));
  assert.ok((await chat.messages(c)).items.filter(m => m.authorKind === 'assistant').every(m => !m.available));
});
