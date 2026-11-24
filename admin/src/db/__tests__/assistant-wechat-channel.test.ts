import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { one, rows } from '../repositories/assistant-repository';
import { assistantCounts, deleteAssistantData } from '../repositories/assistant-cleanup';
import { withPlatformTransaction, withTenantTransaction } from '../transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { disconnectChannel, pollChannel, readChannel, startChannel } from '@/lib/assistant/wechat/channels';
import { weixinOrigin, type WeixinInbound, type WeixinAccount } from '@/lib/assistant/wechat/ilink';
import { tickWechatChannel } from '@/lib/assistant/wechat/worker';
import { sourceScope } from '@/lib/assistant/knowledge/sources';
import { claimJob, completeRun } from '@/lib/assistant/infrastructure/job-queue';
import { currentConversationStageScope } from '@/lib/xiaok-v1/stage-dialogue-workflow';
import { readStageAgent, saveStageAgent } from '@/lib/xiaok-v1/stage-workflow-settings';
import { xiaokTestDatabase } from './xiaok-test-database';

// Use a fresh migrated xiaok_embedding_eval on its own loopback port, with a native binding for 1454.
test('ClawBot binding, native stage runs, replies, reset, isolation and disconnect', { skip: !process.env.XIAOK_WECHAT_FIXTURE }, async t => {
  xiaokTestDatabase();
  t.after(closePostgresPool);
  const enterpriseId = '1454', stage = 'utilities';
  const managers = await withPlatformTransaction(async tx => {
    assert.equal(await one(tx, sql`select id from app.enterprises where id in (1454,1455) limit 1`), undefined, 'requires a fresh isolated database');
    for (const id of ['1454','1455']) {
      await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value values
        (${id},${'合成微信渠道测试' + id},${'wechat-fixture-' + id},'active')`);
    }
    const config = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.8-flash', probeVersion: 'wechat-channel-fixture',
      tools: true, imageInput: false, enterpriseKnowledgeEnabled: false };
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(1454,true,100,5000000,1000000000,30,${JSON.stringify(config)}::jsonb)`);
    await tx.execute(sql`insert into app.assistant_worker_settings(version,enabled,enterprise_id,pilot_id,updated_by) values(1,true,1454,'wechat-fixture',1)`);
    return rows<{ id: string; role: string; username: string }>(tx, sql`insert into app.admin_users
      (enterprise_id,username,password_hash,role,status,must_change_password,menu_permissions) values
      (1454,'fixture-owner','fixture','enterprise_admin','active',false,array['assistant-knowledge']),
      (1455,'fixture-other','fixture','enterprise_admin','active',false,array['assistant-knowledge']),
      (null,'fixture-admin','fixture','admin','active',false,array['assistant-knowledge']),
      (null,'fixture-super','fixture','super_admin','active',false,array['assistant-knowledge'])
      returning id,role,username`);
  });
  const scope = { enterpriseId, stage, adminId: managers[0].id } as const;
  let page: WeixinInbound[] = [], replyUnknown = false, cursor = 0;
  const replies: { text: string; id: string; context: string }[] = [];
  const client = {
    async login() { return { code: 'fixture-qr-id', display: 'https://example.test/synthetic-qr' }; },
    async status() { return { state: 'confirmed' as const, origin: weixinOrigin, token: 'fixture-secret', bot: 'test-bot', peer: 'scanner' }; },
    async updates(a: WeixinAccount, previous: string) {
      assert.equal(a.token, 'fixture-secret'); assert.equal(previous, cursor ? String(cursor) : '');
      return { cursor: String(++cursor), messages: page.splice(0) };
    },
    async reply(a: WeixinAccount, context: string, id: string, text: string) {
      assert.equal(a.peer, 'scanner'); replies.push({ text, id, context });
      if (replyUnknown) throw new Error('fixture response lost');
    },
  };
  const input = (key: string, text: string | null) => ({ key, text, context: 'ctx-' + key });
  async function tick() {
    await withTenantTransaction(enterpriseId, tx => tx.execute(sql`update app.assistant_wechat_channels
      set poll_after=now() where enterprise_id=1454 and lease_id is null`));
    return tickWechatChannel(enterpriseId, client);
  }
  const pending = await startChannel(scope, client);
  assert.equal(pending?.status, 'pending');
  assert.equal((await startChannel(scope, client))?.id, pending!.id);
  for (const m of managers.filter(v => v.username !== 'fixture-other'))
    assert.deepEqual(await readChannel({ ...scope, adminId: m.id }), pending);
  await assert.rejects(readChannel({ ...scope, adminId: managers[1].id }), /assistant_capability_forbidden/);
  const other = { ...scope, adminId: managers[1].id, enterpriseId: '1455' };
  assert.equal(await readChannel(other), null);
  await assert.rejects(pollChannel(other, pending!.id, undefined, client), /version_conflict/);
  const linked = await pollChannel(scope, pending!.id, undefined, client);
  assert.equal(linked?.status, 'connected'); assert.equal(linked.qr, null);
  assert.ok(!JSON.stringify(linked).includes('fixture-secret'));
  const stored = await withTenantTransaction(enterpriseId, tx => one(tx, sql`select bot_secret from app.assistant_wechat_channels where id=${linked.id}`));
  assert.ok(stored?.bot_secret && stored.bot_secret !== 'fixture-secret');

  page = [input('first','水电阶段进场看什么？'),input('first','水电阶段进场看什么？')];
  assert.equal(await tick(), 'queued');
  const run = await claimJob({ enterpriseId });
  assert.ok(run); assert.equal(run.actor.principal.kind, 'user');
  const savedRun = await withTenantTransaction(enterpriseId, tx => one(tx, sql`select policy_snapshot->>'replyStream' as preview from app.assistant_runs where id=${run.runId}`));
  assert.equal(savedRun?.preview, null);
  const conversation = await withTenantTransaction(enterpriseId, async tx => {
    const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=1454`))!;
    const binding = await currentConversationStageScope(tx, run.actor, c);
    assert.equal(binding?.agent.stageId, stage); assert.equal(binding.projectId, 'channel:' + linked.id);
    const candidates = await rows(tx, sql`select d.name from (values
      ('public','enterprise','active','customer_public',1),('staff','enterprise','active','staff_internal',1),
      ('project','project','active','customer_public',1),('withdrawn','enterprise','retired','customer_public',1),
      ('draft','enterprise','active','customer_public',null)
      ) d(name,scope,status,audience,published_version_id) cross join (select 1 as id,now() as published_at) v
      where ${sourceScope(run.actor, c, false, '1234')}`);
    assert.deepEqual(candidates.map(row => row.name), ['public']);
    return String(c.id);
  });
  await completeRun(run, { content: { version: 1, blocks: [{ type: 'text', text: '先对照点位图核对插座位置。' }] }, usage: null });
  await tick(); assert.equal(replies[0]?.text, '先对照点位图核对插座位置。'); assert.equal(replies[0]?.context, 'ctx-first');
  page = [input('first','水电阶段进场看什么？'),input('reset','/reset'),input('media',null)];
  await tick();
  assert.equal(replies[1]?.text, '已开启新对话。');
  const channel = await withTenantTransaction(enterpriseId, tx => one(tx, sql`select conversation_id from app.assistant_wechat_channels where id=${linked.id}`));
  assert.equal(channel?.conversation_id, null);
  replyUnknown = true; await tick(); replyUnknown = false;
  assert.equal((await readChannel(scope))?.error, 'wechat_delivery_unknown');
  page = [input('media',null),input('second','那油漆阶段怎么选颜色？')];
  assert.equal(await tick(), 'queued');
  const next = await claimJob({ enterpriseId }); assert.ok(next);
  const changed = await withTenantTransaction(enterpriseId, tx => one(tx, sql`select conversation_id from app.assistant_wechat_channels where id=${linked.id}`));
  assert.notEqual(String(changed?.conversation_id), conversation);
  await disconnectChannel(scope, linked.id);
  const cancelled = await withTenantTransaction(enterpriseId, tx => one(tx, sql`select status from app.assistant_jobs where run_id=${next.runId}`));
  assert.equal(cancelled?.status, 'cancelled');
  await assert.rejects(completeRun(next, { content: { version: 1, blocks: [{ type: 'text', text: '撤权后的回复' }] }, usage: null }));
  assert.equal(await tick(), false); assert.equal(replies.length, 3);
  const events = await withTenantTransaction(enterpriseId, tx => rows(tx, sql`select status,context_secret,text_value
    from app.assistant_wechat_events where channel_id=${linked.id} order by id`));
  assert.deepEqual(events.map(e => e.status), ['sent','sent','unknown','failed']);
  assert.ok(events.every(e => e.context_secret === null && e.text_value === null));
  const reconnect = await startChannel(scope, client);
  assert.notEqual(reconnect?.id, linked.id);
  await assert.rejects(disconnectChannel(scope, linked.id), /version_conflict/);
  await pollChannel(scope, reconnect!.id, undefined, client);
  cursor = 0; page = [input('after-reconnect','现场去之前还需要准备些什么？')];
  assert.equal(await tick(), 'queued');
  const beforeDisable = await claimJob({ enterpriseId }); assert.ok(beforeDisable);
  const original = (await withTenantTransaction(enterpriseId, tx => readStageAgent(tx, enterpriseId, stage)))!;
  const draft = { expectedEnterpriseId: enterpriseId, stageId: stage, expectedVersion: 0, name: original.name,
    description: original.description, enabled: false, defaultWorkflowId: original.defaultWorkflowId,
    workflows: original.workflows.map(({ definitionId, revision, digest }) => ({ definitionId, revision, digest })) };
  await saveStageAgent(enterpriseId, scope.adminId, draft, true);
  assert.equal((await readChannel(scope))?.loginState, 'disabled');
  const disabledJob = await withTenantTransaction(enterpriseId, tx => one(tx, sql`select status from app.assistant_jobs where run_id=${beforeDisable.runId}`));
  assert.equal(disabledJob?.status, 'cancelled');
  await assert.rejects(startChannel(scope, client), /wechat_stage_disabled/);
  await saveStageAgent(enterpriseId, scope.adminId, { ...draft, enabled: true, expectedVersion: 1 }, false);
  assert.equal(await tick(), false);
  // Exercise normal platform cleanup on the disposable fixture, then keep it available for subsequent checks.
  const rollback = new Error('rollback isolated reset');
  await assert.rejects(withPlatformTransaction(async tx => {
    const preview = await assistantCounts(tx, BigInt(enterpriseId));
    assert.equal(preview.find(item => item.table === 'assistant_wechat_channels')?.count, 2);
    await deleteAssistantData(tx, BigInt(enterpriseId));
    const after = await assistantCounts(tx, BigInt(enterpriseId));
    assert.ok(after.filter(item => item.table.startsWith('assistant_wechat_')).every(item => item.count === 0));
    throw rollback;
  }), error => error === rollback);
});
