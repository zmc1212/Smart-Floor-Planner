
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { bailianResponsesBinding } from '@/lib/ai/providers/bailian-responses-capabilities';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { AssistantError, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { claimJob, completeRun } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { minimalDialogueProtocol } from '@/lib/assistant/agent/minimal-dialogue';
import { executeLongTermTool } from '@/lib/assistant/memory/agent';
import { MemoryService } from '@/lib/assistant/memory/long-term';
import { privateMemoryScope } from '@/lib/assistant/memory/scope';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { runDelegationTick } from '@/lib/native-workflow/live/delegation-worker';
import { appendDelegationEvent, DelegationService } from '@/lib/native-workflow/live/delegation-store';
import { delegationConsumer, delegationNotice, delegationRefresh } from '@/lib/native-workflow/live/delegation-state';

const eid = '1454', controlEid = '1455', model = 'qwen3.7-flash';
const live = process.argv.includes('--live');
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) || randomUUID();
assert.match(label, /^[a-z0-9-]{1,80}$/);
const target = new URL(process.env.XIAOK_R5_DATABASE_URL ?? 'http://missing');
assert.ok(target.protocol === 'postgresql:' && target.hostname === '127.0.0.1' && Number(target.port) >= 49152
  && target.pathname === '/xiaok_r5_acceptance' && target.username === 'sfp_app' && !target.search && !target.hash,
  'Use the dedicated R5 loopback database as the app role');
const output = 'tmp/r5/' + label;
mkdirSync(output, { recursive: false });
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const save = (name: string, value: unknown) => writeFileSync(output + '/' + name + '.json', json(value), { flag: 'wx' });
const text = (value: string): MessageContent => ({ version: 1, blocks: [{ type: 'text', text: value }] });
const modelOutput = (...calls: Array<[string, unknown]>): ModelTurnOutput => ({
  text: '', toolCalls: calls.map(([name, input]) => ({ id: randomUUID(), name, arguments: JSON.stringify(input) })),
  usage: { inputTokens: 40, outputTokens: 16 }, providerRequestId: null, finishReason: 'tool_calls',
});
const reply = (message: string) => modelOutput(['final_response', { kind: 'general', text: message }]);

function binding() {
  const paths = execFileSync('git', ['ls-files','-c','-o','--exclude-standard','-z','--','src','drizzle','scripts','package-lock.json'])
    .toString('utf8').split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of paths) hash.update(file).update('\0').update(readFileSync(file)).update('\0');
  return { files: paths.length, sha256: hash.digest('hex') };
}

async function setup() {
  const upstream = live ? await getPlatformLlmRuntimeConfig() : null;
  if (upstream) assert.ok(upstream.providerKey === 'dashscope' && upstream.apiKey && bailianResponsesBinding(upstream.baseUrl, model));
  await closePostgresPool();
  process.env.DATABASE_URL = target.href;
  process.env.NATIVE_WORKFLOW_DELEGATION_ENABLED = '1';
  process.env.NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS = [eid, controlEid].join(',');
  process.env.ASSISTANT_RESPONSES_API = '1';
  process.env.ASSISTANT_NATIVE_TOOLS = '';
  process.env.ASSISTANT_RESPONSES_MAX_RETRIES = '0';
  process.env.ASSISTANT_REQUESTS_PER_MINUTE = '120';
  process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
  delete process.env.ASSISTANT_TEXT_MODEL;
  delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  delete process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
  await withPlatformTransaction(async tx => {
    const identity = await one(tx, sql`select current_database() as db,current_user as role,rolsuper,rolbypassrls
      from pg_roles where rolname=current_user`);
    assert.deepEqual(identity, { db: 'xiaok_r5_acceptance', role: 'sfp_app', rolsuper: false, rolbypassrls: false });
    assert.equal((await one(tx, sql`select count(*)::int as n from app.assistant_jobs where status in ('queued','running')`))?.n, 0);
    await tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys) values('designer','R5 合成设计师',ARRAY['construction-projects'])
      on conflict(role_key) do nothing`);
    for (const tenant of [eid, controlEid]) {
      const name = tenant === eid ? '微云 R5 合成验收' : 'R5 合成隔离对照';
      await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value
        values(${tenant},${name},${'synthetic-r5-' + tenant},'active') on conflict(id) do nothing`);
      assert.equal((await one(tx, sql`select name from app.enterprises where id=${tenant}`))?.name, name);
      await tx.execute(sql`insert into app.assistant_enterprise_settings
        (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${tenant},true,200,3000000,1000000000,30,${JSON.stringify({
          runtime: 'langgraph-v1', providerKey: 'dashscope', model, tools: true, imageInput: false,
          probeVersion: minimalDialogueProtocol, enterpriseKnowledgeEnabled: false,
        })}::jsonb) on conflict(enterprise_id) do nothing`);
    }
  });
  if (upstream) await savePlatformLlmConfig({ enabled: true, providerKey: upstream.providerKey, baseUrl: upstream.baseUrl, model, apiKey: upstream.apiKey });
}

async function fixture(name: string, tenant = eid, existingOwner?: string) {
  const prefix = '合成 R5 ' + label + ' ' + name + ' ' + randomUUID().slice(0, 6);
  const ids = await withPlatformTransaction(async tx => {
    const uid = existingOwner ?? String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    if (!existingOwner) await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${'r5-' + uid + '-' + randomUUID()} )`);
    const lead = await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${tenant},${uid},${prefix},'13800000000','natural') returning id`);
    const staff = [];
    for (const role of ['enterprise_admin','designer','construction_staff','construction_staff']) {
      const account = await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${tenant},${'r5-' + randomUUID()},'synthetic-only',${role},'active',false,${role + ' R5'}) returning id`);
      staff.push(String(account!.id));
    }
    return { uid, leadId: String(lead!.id), staff };
  });
  const [managerId, designerId, workerId, outsiderId] = ids.staff;
  const management = new ConstructionService({ enterpriseId: tenant, adminId: managerId });
  const project = await management.execute('create', { leadId: ids.leadId, name: prefix, managerId, rooms: ['主卧','书房','厨房'] }, randomUUID());
  const pid = String(project.id);
  for (const [adminId, role] of [[designerId,'designer'],[workerId,'worker']]) {
    const current = (await management.execute('detail', { projectId: pid })).project as Row;
    await management.execute('member', { projectId: pid, expectedVersion: Number(current.version), adminId, role, active: true, workLabel: '' }, randomUUID());
  }
  const manager = new SiteChatService(management.actor), designer = new SiteChatService({ enterpriseId: tenant, adminId: designerId });
  const worker = new SiteChatService({ enterpriseId: tenant, adminId: workerId }), outsider = new SiteChatService({ enterpriseId: tenant, adminId: outsiderId });
  const room = Object.fromEntries(((await manager.read(pid)).rooms as Row[]).map(row => [String(row.name),String(row.id)]));
  const actor: ActorContext = { enterpriseId: tenant, principal: { kind: 'user', userId: ids.uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: ids.leadId } };
  const owner = new ConversationService(actor), cid = String((await owner.create(randomUUID())).id);
  const token = await signMiniProgramToken({ sub: ids.uid, id: ids.uid, mode: 'customer', role: 'user',
    contextVersion: 1, source: 'wechat' });
  return { tenant, pid, room, owner, cid, actor, token, ids, manager, designer, worker, outsider, management };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const send = (f: Fixture, value: string, cid = f.cid, key = randomUUID()) => f.owner.send(cid, key, text(value), siteWatchInterceptor);
const transcript = async (f: Fixture, cid = f.cid) => (await f.owner.messages(cid)).items.map(m => safeText(m.content as MessageContent)).join('\n');
const read = async (f: Fixture, cid = f.cid) => withTenantTransaction(f.tenant, async tx => {
  const c = await new AssistantRepository(tx, f.actor).conversation(cid);
  const scope = await privateMemoryScope(tx, f.actor, c);
  assert.ok(scope);
  return { memories: await new MemoryService(tx, scope).retrieve('记过的书房需求和沟通偏好', 20),
    tasks: await new DelegationService(tx, scope).list() };
});

async function turn(f: Fixture, value: string, outputs: ModelTurnOutput[], cid = f.cid) {
  const sent = await send(f, value, cid);
  assert.ok(sent.runId, json(sent));
  const lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  let calls = 0;
  const offered: string[][] = [];
  if (live) await processAnswer(lease!);
  else await processAgentAnswer(lease!, { model: async (_messages, tools, _turn, actualTools) => {
    const selected = (actualTools ?? tools).map(tool => tool.name);
    offered.push(selected);
    const output = outputs[calls++];
    assert.ok(output, 'unexpected model call: ' + selected.join(','));
    for (const call of output.toolCalls) assert.ok(selected.includes(call.name), 'tool was not offered: ' + call.name + ' / ' + selected.join(','));
    return output;
  } });
  const result = await withTenantTransaction(f.tenant, async tx => ({
    run: await one(tx, sql`select id::text,status,error_code,output_message_id::text from app.assistant_runs
      where enterprise_id=${f.tenant} and id=${String(sent.runId)}`),
    messages: await rows(tx, sql`select id::text,author_kind,content from app.assistant_messages where enterprise_id=${f.tenant}
      and conversation_id=${cid} order by seq`),
    steps: await rows(tx, sql`select kind,status,capability_name,input_summary,private_checkpoint from app.assistant_run_steps
      where enterprise_id=${f.tenant} and run_id=${String(sent.runId)}
      and kind in ('agent_model','agent_long_term_write','agent_need_write','agent_validation') order by step_seq`),
    usage: await rows(tx, sql`select category,quantity,cost_micros,measurement_kind from app.assistant_usage_records
      where enterprise_id=${f.tenant} and run_id=${String(sent.runId)} order by id`),
    attempts: await rows(tx, sql`select status,error_code,remote_model,metadata from app.ai_provider_attempts
      where enterprise_id=${f.tenant} and assistant_run_id=${String(sent.runId)} order by id`),
  }));
  save('turn-' + String(sent.runId), { cid, question: value, offered, ...result });
  assert.equal(result.run?.status, 'succeeded', json({ run: result.run, offered }));
  return sent;
}

async function tick(now?: Date) {
  const result = await runDelegationTick({ now });
  assert.deepEqual({ errors: result.errors, retry: result.retry_wait, dead: result.dead }, { errors: 0, retry: 0, dead: 0 }, json(result));
  return result;
}

async function publish(f: Fixture, recordId: string, audience = 'customer') {
  const page = await f.manager.read(f.pid);
  return f.manager.mutate(f.pid, recordId, 'publish', { expectedVersion: ((page.versions as Row).records as Row)[recordId], audience }, randomUUID());
}

async function capture(f: Fixture, room: string, note: string, completed: string, pending: string, photo = false) {
  const ids = photo ? [String((await f.worker.upload(f.pid, randomUUID(),
    await sharp({ create: { width: 96, height: 64, channels: 3, background: '#b8cbd8' } }).png().toBuffer())).id)] : [];
  const key = randomUUID(), input = { text: note, mediaIds: ids, capture: { kind: 'free' } };
  const result = await f.worker.send(f.pid, input, key);
  assert.deepEqual(await f.worker.send(f.pid, input, key), result);
  const lease = await claimJob();
  assert.equal(lease?.runId, result.runId);
  await processSiteRecord(lease!, async () => ({
    ...modelOutput(), finishReason: 'stop', text: JSON.stringify({ title: room + '底盒进展', roomId: f.room[room],
      completed, pending, coordination: '', note }),
  }));
  return String(result.recordId);
}

async function siteSay(f: Fixture, staff: SiteChatService, message: string) {
  return staff.send(f.pid, { text: message, mediaIds: [], versions: (await staff.read(f.pid)).versions }, randomUUID());
}

async function selectedTask(f: Fixture, room: string, kind?: string) {
  const task = (await read(f)).tasks.find(d => d.scope.roomName === room && (!kind || d.scope.kind === kind));
  assert.ok(task, 'missing task ' + room + ' ' + kind);
  return task;
}

async function ownerOnlyTurn(f: Fixture, original: string) {
  const sent = await send(f, original);
  const lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  await completeRun(lease!, { content: text('收到这条咨询。'), usage: { inputTokens: 24, outputTokens: 8 } });
  return String(sent.messageId);
}

async function writePrivate(f: Fixture, original: string, input: Row) {
  const mid = await ownerOnlyTurn(f, original);
  return withTenantTransaction(f.tenant, async tx => {
    const c = await new AssistantRepository(tx, f.actor).conversation(f.cid);
    const source = (await one(tx, sql`select * from app.assistant_messages where enterprise_id=${f.tenant} and id=${mid}`))!;
    const result = await executeLongTermTool(tx, f.actor, c, source,
      { id: randomUUID(), name: 'manage_long_term_memory', arguments: JSON.stringify(input) });
    assert.equal(result.ok, true, result.content);
    return JSON.parse(result.content).result.memory as Row;
  });
}

const checks: string[] = [];
const pass = (name: string) => { checks.push(name); console.log('PASS', name); };

async function business() {
  const f = await fixture('业务六场景');
  save('fixture', { cid: f.cid, projectId: f.pid, leadId: f.ids.leadId, ownerId: f.ids.uid, room: f.room });
  const requirement = '书房的书桌靠窗，主要用电脑和台灯。请帮我跟进书房插座点位，让设计师核一下。';
  await turn(f, requirement, [modelOutput(['record_need', {
    room: '书房', field: 'desk', value: '靠窗', quote: '书房的书桌靠窗',
    additionalNeeds: [{ room: '书房', field: 'devices', value: '电脑和台灯', quote: '主要用电脑和台灯' }],
  }], ['start_delegation', { kind: 'design_review', room: '书房', subject: '插座', quote: '请帮我跟进书房插座点位，让设计师核一下' }]),
  reply('书房书桌靠窗，主要用电脑和台灯。我已登记书房插座跟进，请先确认要共享给项目组的资料。')]);
  await tick();
  assert.equal((await selectedTask(f,'书房','design_review')).status, 'waiting_for_authorization');
  const newCid = String((await f.owner.create(randomUUID())).id);
  const memory = await read(f, newCid);
  assert.equal(memory.memories.find(item => item.topic === 'need/desk')?.value, '靠窗');
  assert.equal(memory.memories.find(item => item.topic === 'need/devices')?.value, '电脑和台灯');
  assert.ok(memory.memories.every(item => item.sourceConversationId === f.cid));
  assert.ok(memory.tasks.some(d => d.conversationId === f.cid));
  assert.doesNotMatch(json(await f.designer.read(f.pid)), /电脑和台灯|书桌靠窗/);
  pass('需求写入、私聊隔离及同项目新会话恢复');

  assert.equal((await send(f, '共享书房需求：书桌靠窗，主要用电脑和台灯，请核对插座点位。')).runId, null);
  await tick();
  const design = await selectedTask(f,'书房','design_review');
  assert.equal(design.status,'waiting_for_designer');
  assert.equal(design.assignedTo,f.ids.staff[1]);
  assert.match(json(await f.designer.read(f.pid)), /等待设计核对/);
  assert.doesNotMatch(json(await f.worker.read(f.pid)), /等待设计核对/);
  await assert.rejects(() => f.outsider.read(f.pid), (error: unknown) => error instanceof AssistantError && error.status === 404);
  pass('授权共享后关联设计师与获权工地通知');

  const record = await capture(f,'书房','书房插座底盒暂缓，等核对桌边点位。','','插座底盒尚未施工');
  const open = await siteSay(f,f.manager,'跟进记录' + record + '：核对书房插座底盒点位');
  assert.ok(open.issueId, json(open));
  const issue = String(open.issueId);
  await siteSay(f,f.designer,'接手事项' + issue);
  await siteSay(f,f.designer,'回复事项' + issue + '：建议桌边电脑插座和台灯插座分开，等现场尺寸确认。');
  await tick(new Date(Date.now() + 24 * 3600_000));
  assert.equal((await selectedTask(f,'书房','design_review')).status, 'waiting_for_designer');
  await siteSay(f,f.manager,'回传事项' + issue + '：设计师建议桌边电脑与台灯插座分开，具体尺寸待核。');
  await deliverSiteResults();
  await tick(new Date(Date.now() + 24 * 3600_000));
  const finished = await selectedTask(f,'书房','design_review');
  assert.equal(finished.status, 'completed');
  assert.equal(finished.evidence?.type, 'designer_reply');
  assert.match(await transcript(f), /设计师的核对回复已由团队回传原咨询/);
  assert.doesNotMatch(await transcript(f,newCid), /设计师的核对回复已由团队回传原咨询/);
  pass('次日事件从设计师核对到负责人回传原会话');

  const progress = '帮我跟进主卧和书房的底盒施工，我想分别知道做到哪一步。';
  await turn(f, progress, [modelOutput(
    ['start_delegation', { kind: 'room_progress', room: '主卧', subject: '底盒', quote: '帮我跟进主卧和书房的底盒施工' }],
    ['start_delegation', { kind: 'room_progress', room: '书房', subject: '底盒', quote: '帮我跟进主卧和书房的底盒施工' }],
  ), reply('主卧和书房的底盒已分别登记跟进，等项目组发布现场记录。')]);
  await tick();
  const mainRecord = await capture(f,'主卧','主卧底盒已经安装好。','底盒已安装','',true);
  await tick();
  assert.equal((await selectedTask(f,'主卧','room_progress')).status,'waiting_for_worker');
  await publish(f,mainRecord);
  await tick();
  const mainTask = await selectedTask(f,'主卧','room_progress');
  assert.equal(mainTask.status,'completed');
  assert.equal(mainTask.evidence?.id,mainRecord);
  assert.equal((await selectedTask(f,'书房','room_progress')).status,'waiting_for_worker');
  pass('主卧完成与书房待施工按房间隔离，内部照片先不可见');

  const repair = '麻烦帮我跟进书房的底盒整改，照片出来后请等复核。';
  await turn(f, repair, [modelOutput(['start_delegation', { kind: 'rectification_review', room: '书房', subject: '底盒',
    quote: '麻烦帮我跟进书房的底盒整改，照片出来后请等复核' }]), reply('已登记书房底盒整改跟进，等待项目团队的整改材料和复核。')]);
  await tick();
  const repairRecord = await capture(f,'书房','书房事项' + issue + '的底盒已经整改，照片附上。','底盒已整改','',true);
  await publish(f,repairRecord);
  await tick();
  const pendingReview = await selectedTask(f,'书房','rectification_review');
  assert.equal(pendingReview.status,'waiting_for_authorization');
  assert.equal(pendingReview.waitingFor,'reviewer');
  assert.equal(pendingReview.evidence?.issueId,issue);
  assert.equal(pendingReview.evidence?.id,repairRecord);
  assert.match(await transcript(f),/已关联发布的整改照片，等待有权人员复核/);
  pass('关联原事项整改照片，等待复核');

  await send(f,'暂停委托：书房 · 底盒');
  assert.match(await transcript(f), /请说明要操作哪一项委托/);
  const control = await fixture('控制与恢复');
  const quote = '帮我跟进厨房底盒施工。';
  await turn(control,quote,[modelOutput(['start_delegation',{ kind:'room_progress',room:'厨房',subject:'底盒',quote }]),reply('厨房底盒跟进已登记。')]);
  await tick();
  await send(control,'暂停当前委托');
  assert.equal((await selectedTask(control,'厨房')).status,'paused');
  const pausedPhoto = await capture(control,'厨房','厨房底盒安装好了。','底盒已安装','',true);
  await publish(control,pausedPhoto);
  await tick(new Date(Date.now() + 72 * 3600_000));
  assert.equal((await selectedTask(control,'厨房')).status,'paused');
  assert.doesNotMatch(await transcript(control),/团队已发布本项完成记录|跟进提醒/);
  await send(control,'取消当前委托');
  assert.equal((await selectedTask(control,'厨房')).status,'cancelled');
  pass('暂停阻止后台动作与到期通知，取消终止原委托');

  const snapshot = () => withTenantTransaction(f.tenant, async tx => one(tx, sql`select
    (select count(*) from app.native_workflow_delegations where enterprise_id=${f.tenant} and project_id=${f.pid}) as tasks,
    (select count(*) from app.domain_event_outbox where enterprise_id=${f.tenant} and type=${delegationNotice}
      and payload->>'projectId'=${f.pid}) as notices,
    (select count(*) from app.native_workflow_delegation_events where enterprise_id=${f.tenant} and delegation_id=${mainTask.id}) as executions`));
  const before = await snapshot();
  const duplicate = await withTenantTransaction(f.tenant, tx => appendDelegationEvent(tx, f.tenant, delegationRefresh, mainTask.id, 1,
    { delegationId: mainTask.id, projectId: f.pid }));
  assert.equal(duplicate,null);
  await tick();
  assert.deepEqual(await snapshot(),before);
  pass('同一事件重复不新建委托、不重放副作用或通知');

  const r5Get = async (fixture: Fixture, cid: string) => assistantHttp(new Request('http://localhost/long-term?q=书房需求', {
    headers: { Authorization: 'Bearer ' + fixture.token },
  }), ['conversations', cid, 'long-term']);
  assert.equal((await r5Get(f,newCid)).status,200);
  assert.equal((await r5Get(control,f.cid)).status,404);
  const second = await fixture('同业主另一项目',eid,f.ids.uid);
  assert.ok((await read(second)).memories.every(m => m.category === 'preference'));
  assert.equal((await read(second)).tasks.length,0);
  const other = await fixture('跨企业同业主',controlEid,f.ids.uid);
  assert.equal((await read(other)).memories.length,0);
  assert.equal((await read(other)).tasks.length,0);
  await withTenantTransaction(controlEid, async tx => {
    const leaked = await one(tx, sql`select id from app.native_workflow_delegations where enterprise_id=${f.tenant} and id=${mainTask.id}`);
    assert.equal(leaked,undefined);
  });
  pass('HTTP 身份、同租户跨项目与跨企业 RLS 隔离');
}

async function memoryLifecycle() {
  const f = await fixture('记忆生命周期');
  const initial = '以后跟我沟通直接说结论，背景可以后补。';
  await turn(f,initial,[modelOutput(['manage_long_term_memory',{ action:'remember',category:'preference',topic:'沟通/表达顺序',
    value:'直接说结论',quote:'以后跟我沟通直接说结论' }]),reply('我记住了，以后先说结论。')]);
  const memory = (await read(f)).memories.find(m => m.category === 'preference');
  assert.ok(memory);
  const conflict = await writePrivate(f,'以后请先交代背景，再说结论。',{ action:'remember',category:'preference',topic:memory.topic,
    value:'先交代背景',quote:'以后请先交代背景' });
  assert.equal(conflict.state,'conflict');
  assert.equal((await read(f)).memories.filter(m => m.key === memory.key).length,2);
  const corrected = await writePrivate(f,'更正一下，沟通偏好改成先交代背景。',{ action:'correct',category:'preference',topic:memory.topic,
    value:'先交代背景',quote:'更正一下，沟通偏好改成先交代背景',key:memory.key,revision:conflict.revision });
  assert.equal(corrected.state,'current');
  assert.equal((await read(f)).memories.filter(m => m.key === memory.key).length,1);
  const dups = await writePrivate(f,'以后跟我沟通先交代背景。',{ action:'remember',category:'preference',topic:memory.topic,
    value:'先交代背景',quote:'以后跟我沟通先交代背景' });
  assert.equal(dups.revision,corrected.revision);
  await writePrivate(f,'请删掉我的沟通偏好。',{ action:'delete',quote:'请删掉我的沟通偏好',key:memory.key,revision:corrected.revision });
  assert.ok(!(await read(f)).memories.some(m => m.key === memory.key));
  const archived = await withTenantTransaction(f.tenant, tx => rows(tx, sql`select revision,state,value from app.assistant_long_term_memories
    where enterprise_id=${f.tenant} and owner_id=${f.ids.uid} and memory_key=${memory.key} order by revision`));
  assert.equal(archived.length,3);
  assert.ok(archived.every(row => row.state === 'deleted' && row.value === null));
  const candidate = await writePrivate(f,'书房可能留一个阅读角。',{ action:'remember',category:'project_fact',topic:'阅读角',
    room:'书房',value:'阅读角',quote:'书房可能留一个阅读角' });
  assert.equal(candidate.state,'candidate');
  const invalidated = await writePrivate(f,'请作废书房的阅读角记录。',{ action:'invalidate',quote:'请作废书房的阅读角记录',
    key:candidate.key,revision:candidate.revision });
  assert.equal(invalidated.state,'invalidated');
  assert.ok(!(await read(f)).memories.some(m => m.key === candidate.key));
  pass('候选、去重、冲突、更正、失效、历史和删除');
}

async function recovery() {
  const f = await fixture('Worker 恢复');
  const quote = '帮我跟进厨房底盒，做完告诉我。';
  await turn(f,quote,[modelOutput(['start_delegation',{ kind:'room_progress',room:'厨房',subject:'底盒',quote }]),reply('已登记厨房底盒跟进。')]);
  const task = await selectedTask(f,'厨房'), base = Date.now();
  const failing = async () => { throw new Error('delegation_fixture_failure'); };
  const first = await runDelegationTick({ now: new Date(base + 1000), observe: failing });
  assert.equal(first.retry_wait,1,json(first));
  assert.equal((await selectedTask(f,'厨房')).status,'pending');
  for (let i = 1; i < 5; i++) await runDelegationTick({ now: new Date(base + i * 60000), observe: failing });
  const dead = await withTenantTransaction(f.tenant, tx => one(tx, sql`select status,attempts,last_error from app.domain_event_deliveries
    where enterprise_id=${f.tenant} and consumer_key=${delegationConsumer} and event_id=${task.activationEventId}`));
  assert.deepEqual(dead,{ status:'dead',attempts:5,last_error:'delegation_fixture_failure' });
  assert.equal((await selectedTask(f,'厨房')).status,'failed');
  await send(f,'继续当前委托');
  await tick();
  const resumed = await selectedTask(f,'厨房');
  assert.equal(resumed.status,'waiting_for_worker');
  await tick(new Date(resumed.dueAt.getTime() + 1000));
  assert.equal((await selectedTask(f,'厨房')).reminderStage,1);
  assert.match(await transcript(f),/跟进提醒/);
  await tick(new Date(resumed.dueAt.getTime() + 25 * 3600_000));
  assert.equal((await selectedTask(f,'厨房')).reminderStage,2);
  const count = (await transcript(f)).split('在提醒后仍待处理').length;
  await tick(new Date(resumed.dueAt.getTime() + 26 * 3600_000));
  assert.equal((await transcript(f)).split('在提醒后仍待处理').length,count);
  const app = await assistantHttp(new Request('http://localhost/long-term',{ headers:{ Authorization:'Bearer ' + f.token } }),
    ['conversations',f.cid,'long-term']);
  assert.equal(app.status,200);
  const payload = await app.json();
  const notice = payload.data.notices[0];
  assert.equal(notice.delivery,'persisted_in_app');
  assert.equal(notice.readAt,null);
  const acknowledge = await assistantHttp(new Request('http://localhost/long-term',{ method:'PATCH',
    headers:{ Authorization:'Bearer ' + f.token,'Content-Type':'application/json','Idempotency-Key':randomUUID() },
    body:JSON.stringify({ noticeMessageId:notice.messageId }) }),['conversations',f.cid,'long-term']);
  assert.equal(acknowledge.status,200);
  assert.ok((await acknowledge.json()).data.readAt);
  pass('失败退避、死信、手动恢复、到期催办及显式已读');
}

async function realTrials() {
  for (const [n, question] of [
    ['one','以后跟我沟通直接说结论，背景可以后补。'],
    ['two','我习惯先看两三条要点，细节等我问了再说。'],
  ]) {
    const f = await fixture(n);
    await turn(f,question,[]);
    const memories = (await read(f)).memories;
    assert.ok(memories.some(m => m.category === 'preference' && question.includes(m.value)));
    const next = String((await f.owner.create(randomUUID())).id);
    await turn(f,'我们换个话题。之前说过怎么和我沟通比较合适吗？',[],next);
    const answer = await transcript(f,next);
    assert.match(answer,n === 'one' ? /结论/ : /要点/);
    pass('真实百炼私有偏好跨会话 ' + n);
  }
}

async function main() {
  const before = binding();
  try {
    await setup();
    if (live) await realTrials();
    else {
      await business();
      await memoryLifecycle();
      await recovery();
    }
  } finally {
    const after = binding();
    save('verification', { mode: live ? 'bailian' : 'mock', before, after, checks });
    assert.deepEqual(before, after, 'Source changed during the acceptance run');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => closePostgresPool());
