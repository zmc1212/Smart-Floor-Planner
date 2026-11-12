import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { GET as construction, POST as constructionWrite } from '@/app/api/miniprogram/construction/[[...path]]/route';
import { GET as assistant, POST as assistantWrite } from '@/app/api/miniprogram/assistant/[...path]/route';
import { cancelRuns, ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob, completeRun, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { persistNeedWrites } from '@/lib/assistant/agent/memory-store';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { speechConfigurationHash } from '@/lib/assistant/speech/local';
import { ConstructionService } from '@/lib/construction/service';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { queryNeedIssues } from '@/lib/construction/need-issues';
import { constructionRead } from '@/lib/construction/customer';
import { delegationConsumer } from '../live/delegation-state';
import { runNativeDelegationTick } from '../live/delegation-worker';
import { b510Process } from './support/b510-controller';
import type { ActorContext, MessageContent } from '@/lib/assistant/contracts';

const live = process.env.B59_LIVE_DEVELOPMENT === '1';
const eid = '1454', control = '1455', label = '[B5.9] 合成 ' + randomUUID();
const image = (background = '#92acbc') => sharp({ create: { width: 96, height: 64, channels: 3, background } }).png().toBuffer();
const content = (text: string): MessageContent => ({ version: 1, blocks: [{ type: 'text', text }] });
const exec = promisify(execFile);
let speechModel: string | undefined;

before(async () => {
  if (!live) return;
  assert.notEqual(process.env.NODE_ENV, 'production');
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.deepEqual([url.protocol, url.hostname, url.port, url.pathname, url.username, url.search, url.hash],
    ['postgresql:', '127.0.0.1', process.env.XIAOK_ISOLATED_POSTGRES_PORT || '55433', '/xiaok_b59_test', 'sfp_app', '', '']);
  process.env.NATIVE_WORKFLOW_COLLABORATION_ENTERPRISE_IDS = [eid, control].join(',');
  process.env.NATIVE_WORKFLOW_DELEGATION_ENABLED = '1';
  process.env.NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS = eid;
  await withPlatformTransaction(async tx => {
    assert.deepEqual(await one(tx, sql`select current_database() as db, current_user as role, rolsuper,rolbypassrls
      from pg_roles where rolname=current_user`), { db: 'xiaok_b59_test', role: 'sfp_app', rolsuper: false, rolbypassrls: false });
    await tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys) values('designer','隔离设计师',ARRAY['construction-projects'])
      on conflict(role_key) do nothing`);
    for (const id of [eid, control]) {
      await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value
        values(${id},${id === eid ? '[B5.9] 微云隔离验收' : '[B5.9] 隔离对照企业'},${'xiaok-b59-' + id},'active') on conflict(id) do nothing`);
      assert.equal((await one(tx, sql`select code from app.enterprises where id=${id}`))?.code, 'xiaok-b59-' + id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${id},true,200,10000000,1000000000,30) on conflict(enterprise_id) do nothing`);
    }
    assert.equal((await one(tx, sql`select count(*)::int as pending from app.assistant_jobs where status in ('queued','running')`))?.pending, 0);
  });
});

after(async () => {
  if (!live) return;
  if (speechModel) {
    for (const name of ['model.bin', 'tokenizer.json', 'config.json']) unlinkSync(join(speechModel, name));
    rmdirSync(speechModel);
  }
  await closePostgresPool();
});

async function user(enterpriseId = eid) {
  const phone = '139' + String(randomInt(10000000, 99999999));
  const uid = await withPlatformTransaction(async tx => {
    const account = (await one(tx, sql`insert into app.users(enterprise_id,nickname,phone) values(${enterpriseId},${label},${phone}) returning id::text`))!;
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(account.id)},${'b59-' + randomUUID()})`);
    return String(account.id);
  });
  const token = await signMiniProgramToken({ sub: uid, id: uid, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
  return { uid, token, enterpriseId, phone };
}
async function employee(name: string, role: 'construction_staff' | 'designer' | 'enterprise_admin', enterpriseId = eid) {
  const account = await user(enterpriseId), displayName = label + ' ' + name;
  const staffId = await withPlatformTransaction(async tx => String((await one(tx, sql`insert into app.admin_users
    (enterprise_id,user_id,username,password_hash,role,display_name,phone,status,must_change_password)
    values(${enterpriseId},${account.uid},${'b59-' + randomUUID()},'synthetic-only',${role},${displayName},${account.phone},'active',false)
    returning id::text`))!.id));
  const token = await signMiniProgramToken({ sub: account.uid, id: account.uid, mode: 'staff', role, staffRole: role, staffId,
    enterpriseId, contextVersion: 1, source: 'phone' });
  return { ...account, token, staffId, role, displayName };
}
async function fixture() {
  const owner = await user(), family = await user(), outsider = await user(control);
  const boss = await employee('老板', 'enterprise_admin'), manager = await employee('项目经理', 'construction_staff');
  const designer = await employee('设计师', 'designer'), worker = await employee('施工师傅', 'construction_staff');
  const foreignBoss = await employee('对照老板', 'enterprise_admin', control);
  const lead = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eid},${owner.uid},${label},'13900000000','natural') returning id::text`))!.id));
  const service = new ConstructionService({ enterpriseId: eid, adminId: boss.staffId });
  const pid = String((await service.execute('create', { leadId: lead, name: label, managerId: manager.staffId, rooms: ['主卧', '书房', '厨房'] }, randomUUID())).id);
  const detail = () => service.execute('detail', { projectId: pid });
  const version = async () => Number(((await detail()).project as Row).version);
  for (const [person, role] of [[designer, 'designer'], [worker, 'worker']] as const) {
    await service.execute('member', { projectId: pid, expectedVersion: await version(), adminId: person.staffId, role, active: true }, randomUUID());
  }
  await service.execute('progress', { projectId: pid, expectedVersion: await version(), stageKey: 'utilities', note: '基础水电施工', sendReminder: false }, randomUUID());
  const room = Object.fromEntries(((await detail()).rooms as Row[]).map(r => [String(r.name), String(r.id)]));
  const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: owner.uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: lead } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  return { owner, family, outsider, boss, manager, designer, worker, foreignBoss, lead, pid, cid, room, actor, chat, service, version };
}

async function http(namespace: 'construction' | 'assistant', target: string, token: string, body?: Row | FormData, key: string = randomUUID()) {
  const request = new NextRequest('http://localhost:3039/api/miniprogram/' + namespace + '/' + target, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': key },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const path = target.split('?')[0].split('/');
  const handle = namespace === 'construction' ? body ? constructionWrite : construction : body ? assistantWrite : assistant;
  return handle(request, { params: Promise.resolve({ path }) });
}
async function value(response: Response, expected = 200) {
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result.data as Row;
}
function audio() {
  speechModel = mkdtempSync(join(tmpdir(), 'sfp-b59-asr-'));
  for (const name of ['model.bin', 'tokenizer.json', 'config.json']) writeFileSync(join(speechModel, name), 'synthetic fixture');
  Object.assign(process.env, { ASSISTANT_ASR_PROVIDER: 'local-faster-whisper', ASSISTANT_ASR_PYTHON: process.execPath,
    ASSISTANT_ASR_MODEL_PATH: speechModel, ASSISTANT_ASR_MODEL_SHA256: '0'.repeat(64) });
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  return bytes.toString('base64');
}

test('B5.9/B5.10 real Mini handlers and PostgreSQL share the electrical issue, approved plan, record versions and receipts', { skip: !live, timeout: 240000 }, async t => {
  const f = await fixture(), project = 'projects/' + f.pid, site = project + '/chat', consultation = 'conversations/' + f.cid;
  t.after(() => withTenantTransaction(eid, async tx => {
    const unfinished = await rows(tx, sql`select r.id::text,r.conversation_id::text,r.policy_snapshot
      from app.assistant_runs r where r.enterprise_id=${eid} and r.status in ('queued','running') and
      (r.conversation_id=${f.cid} or exists(select 1 from app.construction_chats c
        where c.enterprise_id=r.enterprise_id and c.conversation_id=r.conversation_id and c.project_id=${f.pid}))`);
    for (const r of unfinished) await cancelRuns(tx, (r.policy_snapshot as { actor: ActorContext }).actor, String(r.conversation_id), String(r.id));
    if (unfinished.length) console.log('B5.10 cleanup cancelled test captures', JSON.stringify(unfinished.map(r => r.id)));
  }));
  const staff = (path: string, person = f.worker, body?: Row | FormData, key?: string) => http('construction', path, person.token, body, key);
  const c01 = (path: string, person = f.owner, body?: Row, key?: string) => http('assistant', consultation + path, person.token, body, key);
  const say = async (text: string, key = randomUUID()) => value(await c01('/messages', f.owner, { clientMessageId: key, content: content(text) }, key), 202);
  const page = async (person = f.worker) => value(await staff(site + '?limit=100', person));
  const issuePage = async (id: string, person = f.worker) => value(await staff(site + '?limit=100&issueId=' + id, person));
  const versions = async (person = f.worker) => (await page(person)).versions as Row;
  const command = async (person: typeof f.worker, text: string, mediaIds: string[] = [], expected?: Row, key?: string) =>
    staff(site + '/messages', person, { text, mediaIds, versions: expected || await versions(person) }, key);
  const talk = async (person: typeof f.worker, text: string, mediaIds: string[] = []) => value(await command(person, text, mediaIds));
  const upload = async (person = f.worker, color?: string) => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(await image(color))], { type: 'image/png' }), 'b59-photo.png');
    return String((await value(await staff(site + '/media', person, form))).id);
  };
  const publishRecord = async (recordId: string, audience: string, scheduleCompletion?: Row) => value(await staff(site + '/records/' + recordId + '/publish', f.manager,
    { expectedVersion: ((await versions(f.manager)).records as Row)[recordId], audience, ...(scheduleCompletion ? { scheduleCompletion } : {}) }));
  async function recoverCapture(runId: string) {
    // Only the test-owned Worker loses its database transport.
    const unavailable = createServer(socket => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      unavailable.once('error', reject);
      unavailable.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = unavailable.address();
      assert.ok(address && typeof address === 'object');
      const url = new URL(process.env.DATABASE_URL!);
      url.port = String(address.port);
      const worker = await b510Process<{ status: number; code: string }>(t, ['worker'], {
        DATABASE_URL: url.toString(), B510_DB_OUTAGE: '1', CRON_SECRET: randomUUID(), POSTGRES_CONNECTION_TIMEOUT_MS: '1000',
      }).result();
      assert.deepEqual(worker, { status: 503, code: 'assistant_unavailable' });
      assert.equal((await withTenantTransaction(eid, tx => one(tx, sql`select status from app.assistant_jobs
        where enterprise_id=${eid} and run_id=${runId}`)))?.status, 'queued');
    } finally { await new Promise<void>(resolve => unavailable.close(() => resolve())); }

    const workers = [0, 1].map(() => b510Process<Lease | null>(t, ['claim'], { B510_HOLD_LEASE: '1' }));
    const claims = await Promise.all(workers.map(worker => worker.result()));
    const owned = claims.filter(lease => lease !== null);
    assert.equal(owned.length, 1, 'two independent Worker processes share one lease');
    const previous = owned[0];
    assert.equal(previous.runId, runId);
    await Promise.all(workers.map(worker => worker.kill()));
    assert.equal(await b510Process<Lease | null>(t, ['claim']).result(), null);
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_jobs
      set lease_expires_at=now()-interval '1 second' where enterprise_id=${eid} and id=${previous.jobId} and lease_token=${previous.token}`));
    const recovered = await b510Process<Lease>(t, ['claim']).result();
    assert.equal(recovered.runId, runId);
    assert.notEqual(recovered.token, previous.token);
    await assert.rejects(() => completeRun(previous, { content: content('过期进程不能回写'), usage: null }), { code: 'context_changed' });
    console.log('B5.10 recovered capture', JSON.stringify({ runId, jobId: recovered.jobId, claimCount: 2, staleWrite: 'context_changed' }));
    return recovered;
  }
  const report = async (room: string, text: string, photo: string, recording?: string, restartWorker = false) => {
    const body = { text: recording ? '' : text, mediaIds: [photo], capture: { kind: 'free' }, ...(recording ? { recording } : {}) };
    const key = randomUUID();
    const result = await value(await staff(site + '/messages', f.worker, body, key));
    assert.deepEqual(await value(await staff(site + '/messages', f.worker, body, key)), result);
    return organize(result, room, text, restartWorker);
  };
  const organize = async (result: Row, room: string, text: string, restartWorker = false) => {
    const lease = restartWorker ? await recoverCapture(String(result.runId)) : await claimJob();
    assert.equal(lease?.runId, result.runId);
    await processSiteRecord(lease!, async messages => {
      assert.match(JSON.stringify(messages), new RegExp(text));
      return { text: JSON.stringify({ title: room + '底盒进展', roomId: f.room[room], completed: text,
        pending: '', coordination: '', note: '' }), toolCalls: [], finishReason: 'stop', providerRequestId: null,
      usage: { inputTokens: 45, outputTokens: 25 } };
    }, async () => ({ text, durationMs: 500, modelHash: '0'.repeat(64), configurationHash: speechConfigurationHash()! }));
    return String(result.recordId);
  };
  const snapshot = () => withTenantTransaction(eid, tx => queryNeedIssues(tx, f.actor, f.cid));
  const delegated = () => withTenantTransaction(eid, tx => one(tx, sql`select id::text,state,tasks,latest_event_id::text from app.native_workflow_delegations
    where enterprise_id=${eid} and conversation_id=${f.cid}`));
  const tick = async () => {
    const result = await runNativeDelegationTick();
    assert.ok(result.enterprises.every(item => !('error' in item) && item.dead === 0 && item.retried === 0), JSON.stringify(result));
  };
  const restart = () => exec(process.execPath, ['--import', 'tsx', '-e', `
    (async () => { const a = require('./src/lib/native-workflow/live/delegation-worker.ts');
      const b = require('./src/lib/construction/site-results.ts');
      const p = require('./src/lib/postgresql.ts');
      try { const tick = await a.runNativeDelegationTick(); const notices = await b.deliverSiteResults();
        process.stdout.write(JSON.stringify({tick, notices})); } finally { await p.closePostgresPool(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { windowsHide: true, timeout: 30000 });
  const planPath = (id: string) => '/plans/' + id;
  const approve = async (id: string) => {
    const p = await value(await c01(planPath(id)));
    const preview = await value(await c01(planPath(id) + '/preview', f.owner, { expectedRevision: p.revision }));
    return value(await c01(planPath(id) + '/approve', f.owner, { expectedRevision: preview.revision }));
  };
  const publishPlan = async (issueId: string, difference: string) => {
    const photo = await upload(f.designer);
    const p = await talk(f.designer, `发布方案事项${issueId}\n标题：书房插座点位\n差异：${difference}\n费用变化：0元\n工期变化：0天`, [photo]);
    return { id: String(p.planId), photo };
  };
  const managerReview = (issueId: string) => `解决事项${issueId}\n结论：已复核本次施工原件\n回传：书房插座已按确认版安装，经理已复核。\n回传原件：是`;
  const day = (offset: number) => new Date(Date.now() + (8 + 24 * offset) * 3600_000).toISOString().slice(0, 10);
  const nodes = [
    { key: 'master', roomId: f.room['主卧'], stageKey: 'utilities', plannedStart: day(-2), plannedEnd: day(1) },
    { key: 'study', roomId: f.room['书房'], stageKey: 'utilities', plannedStart: day(-1), plannedEnd: day(2) },
    { key: 'kitchen', roomId: f.room['厨房'], stageKey: 'utilities', plannedStart: day(-2), plannedEnd: day(-1) },
  ];
  let masterRecord = '', issueId = '', resultId = '', lifecycleRevision = 0, designPlan = '', qualityId = '';
  let firstPlan: { id: string; photo: string }, currentPlan: { id: string; photo: string };
  let oldOpinionVersions: Row, needGrantId: string;

  await t.test('capture and publication update authorized roles and preserve independent room progress', async () => {
    const missing = await value(await staff(project + '/schedule', f.boss));
    assert.deepEqual(missing.overall, { color: 'gray', label: '未排期' });
    assert.equal((await staff(project + '/schedule', f.boss, { expectedVersion: 0, nodes })).status, 403);
    await value(await staff(project + '/schedule', f.manager, { expectedVersion: 0, nodes, note: '内部计划备忘' }));
    const opened = await say('请持续跟进主卧的水电进展和书房的插座点位。');
    assert.equal((await delegated())?.state, 'active');
    const tickWith = (env: Record<string, string>) => b510Process<{ enabled: boolean; enterprises: Row[] }>(t, ['delegation'], env).result();
    const configured = { NATIVE_WORKFLOW_DELEGATION_ENABLED: '1', NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS: eid };
    const started = await delegated();
    const scope = () => withTenantTransaction(eid, tx => rows(tx, sql`select d.id::text,d.status,d.attempts from app.domain_event_deliveries d
      join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
      where d.enterprise_id=${eid} and d.consumer_key=${delegationConsumer} and e.payload->>'delegationId'=${String(started?.id)} order by d.id`));
    const pending = await scope();
    assert.ok(pending.some(row => row.status === 'pending'));
    assert.equal((await tickWith({ ...configured, NATIVE_WORKFLOW_DELEGATION_ENABLED: '0' })).enabled, false);
    assert.deepEqual((await tickWith({ ...configured, NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS: control })).enterprises.map(item => item.enterpriseId), [control]);
    assert.deepEqual(await scope(), pending);
    await Promise.all([tickWith(configured), tickWith(configured)]);
    for (let attempt = 0; attempt < 8 && (await delegated())?.state === 'active'; attempt++) {
      const drained = JSON.parse((await restart()).stdout);
      assert.ok(drained.tick.enterprises[0].delivered > 0, JSON.stringify(drained));
    }
    assert.equal((await delegated())?.state, 'waiting');
    const consumed = await scope();
    assert.ok(pending.every(row => consumed.some(result => result.id === row.id && result.status === 'delivered' && result.attempts === 1)));
    const origin = await withTenantTransaction(eid, tx => one(tx, sql`select origin_message_id::text from app.native_workflow_delegations
      where enterprise_id=${eid} and conversation_id=${f.cid}`));
    assert.equal(origin?.origin_message_id, opened.messageId);
    await say('主卧有新照片了告诉我。');
    const brokenPhoto = new FormData();
    brokenPhoto.set('file', new Blob(['not a PNG'], { type: 'image/png' }), 'b510-broken.png');
    const mediaCount = async () => (await withTenantTransaction(eid, tx => one(tx, sql`select count(*)::int as n
      from app.construction_site_media where enterprise_id=${eid} and project_id=${f.pid}`)))?.n;
    const count = await mediaCount();
    assert.equal((await staff(site + '/media', f.worker, brokenPhoto)).status, 422);
    assert.equal(await mediaCount(), count);
    const photo = await upload();
    masterRecord = await report('主卧', '主卧底盒已经装好', photo, audio(), true);
    const captured = ((await page()).items as { record: Row }[]).find(item => String(item.record?.id) === masterRecord)?.record;
    assert.ok(captured?.speech && captured.captured);
    await tick();
    const observed = (await delegated())?.tasks as Row[];
    assert.equal((observed[0].evidence as Row).recordId, masterRecord);
    assert.deepEqual((observed[0].evidence as Row).photoIds, [photo]);
    assert.equal(observed[0].next, 'review_report');
    const published = await publishRecord(masterRecord, 'customer', { nodeKey: 'master', expectedVersion: 1 });
    const customer = await withTenantTransaction(eid, tx => constructionRead(tx, eid, f.owner.uid, f.lead));
    assert.equal(((customer.data[0].records as Row[])[0]).id, masterRecord);
    const history = await value(await c01('/messages?limit=100'));
    const feedback = (history.items as Row[]).find(item => (item.siteRecord as Row | null)?.id === masterRecord)?.siteRecord as Row;
    assert.deepEqual([feedback.version, feedback.assets], [published.version, [photo]]);
    const reads = await Promise.all([f.boss, f.designer, f.worker].map(async person => value(await staff(project + '/schedule', person))));
    const ownerProgress = await value(await http('construction', project + '/progress', f.owner.token));
    for (const read of [...reads, ownerProgress.progress as Row]) {
      assert.equal(read.version, 1);
      assert.deepEqual((read.nodes as Row[]).map(node => [node.constructionStatus, node.color]),
        [['completed', 'green'], ['unknown', 'gray'], ['unknown', 'red']]);
      assert.equal(((read.nodes as Row[])[0].evidence as Row).version, published.version);
    }
    assert.equal(((await value(await staff('brief', f.boss))).items as Row[]).find(item => item.projectId === f.pid)?.progress !== undefined, true);
    const changed = [{ ...nodes[0], plannedEnd: day(-1) }, ...nodes.slice(1)];
    const competing = await Promise.all([0, 1].map(n => staff(project + '/schedule', f.manager, { expectedVersion: 1, nodes: changed, note: '版本' + n })));
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409]);
    const revised = await value(await staff(project + '/schedule', f.designer));
    assert.equal(revised.version, 2);
    assert.equal((revised.nodes as Row[])[0].color, 'red');
    assert.equal(((revised.nodes as Row[])[0].evidence as Row).scheduleVersion, 1);
    await tick();
  });

  await t.test('private clarification stays private, one consent opens one review, and parallel opinions conflict', async () => {
    const raw = '书房插座挪到窗边吧，我的桌子靠窗，主要给电脑和台灯用。私聊标记B59。';
    const privateMessage = await say(raw);
    const lease = await claimJob();
    assert.equal(lease?.runId, privateMessage.runId);
    await completeRun(lease!, { content: content('收到，我记下这次书房补充。'), usage: null }, async tx => {
      const conversation = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${f.cid}`))!;
      await persistNeedWrites(tx, f.actor, conversation, { runId: String(privateMessage.runId), turn: 1, index: 0, sourceMessageId: String(privateMessage.messageId) },
        { room: '书房', field: 'desk', value: '靠窗', quote: '我的桌子靠窗' });
    });
    assert.doesNotMatch(JSON.stringify(await page(f.designer)), /私聊标记B59/);
    await new AssistantMediaService(f.actor).upload(f.cid, randomUUID(), await image(), 'floorplan', '书房');
    await say('共享书房点位图：窗边书桌右侧标注。');
    const consent = randomUUID();
    assert.deepEqual(await say('共享书房需求：窗边书桌要供电脑和台灯用。', consent),
      await say('共享书房需求：窗边书桌要供电脑和台灯用。', consent));
    const matters = (await snapshot()).data.filter(item => item.kind === 'design_review');
    assert.equal(matters.length, 1);
    needGrantId = String((await withTenantTransaction(eid, tx => one(tx, sql`select id::text from app.domain_event_outbox
      where enterprise_id=${eid} and type='construction.material.shared.v1' and payload->>'projectId'=${f.pid}
      and payload->>'kind'='need'`)))?.id);
    assert.match(needGrantId, /^[1-9]\d*$/);
    issueId = matters[0].issueId;
    await tick();
    assert.equal(((await delegated())?.tasks as Row[])[1].issueId, issueId);
    const drawing = await withTenantTransaction(eid, tx => one(tx, sql`select id::text from app.domain_event_outbox
      where enterprise_id=${eid} and type='construction.material.shared.v1' and payload->>'projectId'=${f.pid} and payload->>'kind'='drawing'`));
    const setDesigner = async (active: boolean) => f.service.execute('member', { projectId: f.pid,
      expectedVersion: await f.version(), adminId: f.designer.staffId, role: 'designer', active }, randomUUID());
    const knownVersions = await versions(f.designer);
    await setDesigner(false);
    try {
      for (const result of [await staff(site, f.designer), await command(f.designer, '回复事项' + issueId + '：已撤权的设计意见', [], knownVersions)]) {
        assert.equal(result.status, 404);
        assert.equal((await result.json()).error, 'assistant_resource_not_found');
      }
    } finally { await setDesigner(true); }
    await talk(f.designer, '核对事项' + issueId + '图纸' + drawing!.id);
    const v = await versions(f.designer);
    oldOpinionVersions = v;
    const opinions = await Promise.all(['窗边右侧保留插座', '窗边右侧预留两用插座'].map(text => command(f.designer, '回复事项' + issueId + '：' + text, [], v)));
    assert.deepEqual(opinions.map(result => result.status).sort(), [200, 409]);
    const privateDraftPhoto = await upload(f.designer);
    const config = { runtime: 'langgraph-v1', providerKey: 'deepseek', model: 'deepseek-flash', tools: true, imageInput: false, probeVersion: 'b59-fixture' };
    const priorConfig = await withTenantTransaction(eid, async tx => {
      const prior = (await one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${eid} for update`))!;
      await tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(config)}::jsonb where enterprise_id=${eid}`);
      return prior.agent_config;
    });
    try {
      const draft = await talk(f.designer, '请发布书房的正式方案，名称书房插座调整。设计预览标记B59。', [privateDraftPhoto]);
      assert.ok(draft.runId);
      assert.match(JSON.stringify(await page(f.designer)), /设计预览标记B59/);
      assert.doesNotMatch(JSON.stringify(await page(f.worker)), /设计预览标记B59/);
      assert.equal((await staff(site + '/media/' + privateDraftPhoto)).status, 404);
    } finally {
      try { await talk(f.designer, '取消这次操作'); }
      finally {
        await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings
          set agent_config=${JSON.stringify(priorConfig)}::jsonb where enterprise_id=${eid}`));
      }
    }
    firstPlan = await publishPlan(issueId, '书桌右侧插座');
    assert.equal(((await page()).plans as Row[]).length, 0);
    assert.equal((await staff(site + '/media/' + firstPlan.photo)).status, 404);
    assert.equal((await c01(planPath(firstPlan.id) + '/approve', f.owner, { expectedRevision: 1 })).status, 422);
    assert.equal((await approve(firstPlan.id)).status, 'approved');
    assert.equal(((await page()).plans as Row[])[0].id, firstPlan.id);
    assert.equal((await staff(site + '/media/' + firstPlan.photo)).status, 200);
    // Hold the V1 delivery while newer project work reaches the Worker.
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.domain_event_deliveries set status='delivered'
      where enterprise_id=${eid} and event_id=${firstPlan.id} and consumer_key=${delegationConsumer}`));
    await tick();
  });

  await t.test('a newer opinion and exact plan replace V1, including a late outbox delivery', async () => {
    await talk(f.designer, '回复事项' + issueId + '：更新点位到书桌右前侧。');
    assert.equal((await staff(site + '/media/' + firstPlan.photo)).status, 404);
    assert.equal((await c01(planPath(firstPlan.id))).status, 404);
    currentPlan = await publishPlan(issueId, '书桌右前侧插座');
    assert.equal(((await page()).plans as Row[]).length, 0);
    assert.equal((await approve(currentPlan.id)).status, 'approved');
    assert.equal((await command(f.designer, '回复事项' + issueId + '：晚到的旧图纸意见', [], oldOpinionVersions)).status, 409);
    assert.equal((await c01(planPath(firstPlan.id) + '/approve', f.owner, { expectedRevision: 3 })).status, 404);
    await tick();
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.domain_event_deliveries set status='pending',available_at=now()
      where enterprise_id=${eid} and event_id=${firstPlan.id} and consumer_key=${delegationConsumer}`));
    await tick();
    const current = await delegated();
    const task = (current?.tasks as Row[])[1];
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.domain_event_deliveries set status='pending',available_at=now()
      where enterprise_id=${eid} and event_id=${firstPlan.id} and consumer_key=${delegationConsumer}`));
    await tick();
    assert.deepEqual(await delegated(), current);
    const linked = await withTenantTransaction(eid, tx => rows(tx, sql`select outcome from app.native_workflow_delegation_events
      where enterprise_id=${eid} and event_id=${firstPlan.id}`));
    assert.equal(linked.length, 1);
    assert.equal(task.issueId, issueId);
    assert.equal((task.plan as Row).id, currentPlan.id);
    const plans = (await page()).plans as Row[];
    assert.deepEqual(plans.map(p => [p.id, p.number, p.status]), [[currentPlan.id, 2, 'approved']]);
    assert.equal(plans[0].costDeltaCents, undefined);
    const history = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text,aggregate_version from app.domain_event_outbox
      where enterprise_id=${eid} and type='construction.plan.published.v1' and aggregate_id=${issueId} order by aggregate_version`));
    assert.deepEqual(history.map(p => p.id), [firstPlan.id, currentPlan.id]);
    designPlan = currentPlan.id;
  });

  async function completeDesign(label: string) {
    const installed = await report('书房', label, await upload());
    const reviewed = await publishRecord(installed, 'internal');
    const sent = await talk(f.worker, `落实事项${issueId}方案${currentPlan.id}记录${installed}：按确认图纸施工并提交照片。`);
    const views = await Promise.all([f.worker, f.designer, f.boss].map(async person => ((await issuePage(issueId, person)).issues as Row[]).find(item => item.issueId === issueId)));
    for (const view of views) {
      assert.equal(view?.classification, 'awaiting_review');
      assert.equal(view?.lifecycleId, sent.lifecycleId);
      assert.equal(view?.executionRecordId, installed);
      assert.equal(view?.executionRecordVersion, reviewed.version);
      assert.equal((view?.sync as Row).status, 'pending');
    }
    const owner = (await snapshot()).data.find(item => item.kind === 'design_review');
    assert.equal(owner?.classification, 'awaiting_review');
    assert.equal(owner?.lifecycleId, sent.lifecycleId);
    assert.equal((await command(f.boss, managerReview(issueId))).status, 403);
    assert.equal((await command(f.worker, managerReview(issueId))).status, 403);
    assert.equal((await command(f.designer, managerReview(issueId))).status, 403);
    const resolved = await talk(f.manager, managerReview(issueId));
    const drain = JSON.parse((await restart()).stdout);
    assert.ok(drain.notices >= 1);
    const history = (await value(await c01('/messages?limit=100'))).items as Row[];
    const result = history.find(item => item.available !== false && /经理已复核/.test(JSON.stringify(item.content)));
    assert.ok(result);
    assert.equal((result.siteRecords as Row[])[0].id, installed);
    for (const person of [f.worker, f.designer, f.boss]) {
      const view = ((await page(person)).issues as Row[]).find(item => item.issueId === issueId);
      assert.equal(view?.status, 'resolved');
      assert.equal(view?.planId, currentPlan.id);
      assert.equal(view?.lifecycleId, resolved.lifecycleId);
      assert.equal((view?.sync as Row).status, 'succeeded');
    }
    assert.equal((await snapshot()).data.find(item => item.kind === 'design_review')?.lifecycleId, resolved.lifecycleId);
    assert.equal(((await delegated())?.tasks as Row[])[1].resultEventId,
      (((await page(f.worker)).issues as Row[]).find(item => item.issueId === issueId)?.sync as Row).eventId);
    resultId = String(result.id);
    lifecycleRevision = Number(resolved.lifecycleRevision);
    return result;
  }

  await t.test('worker submission waits for the manager; restart delivers the same result and re-open revokes the prior result', async () => {
    const original = await completeDesign('书房右前侧插座已安装');
    await talk(f.manager, '重新处理事项' + issueId + '：补核插座底盒固定情况。');
    const owner = (await snapshot()).data.find(item => item.kind === 'design_review');
    assert.equal(owner?.status, 'awaiting_review');
    assert.equal(owner?.lifecycleRevision, lifecycleRevision + 1);
    const prior = ((await value(await c01('/messages?limit=100'))).items as Row[]).find(item => item.id === original.id);
    assert.equal(prior?.available, false);
    await completeDesign('书房底盒加固并重新拍照');
  });

  await t.test('quality confirmation, remediation and exclusion use the same list as boss statistics', async () => {
    qualityId = String((await talk(f.manager, '跟进记录' + masterRecord + '：现场复核发现底盒固定螺钉松动。')).issueId);
    const mark = (text: string) => talk(f.manager, text);
    assert.equal((await command(f.worker, '确认事项' + qualityId + '：待核实')).status, 403);
    await mark('确认事项' + qualityId + '：现场核实底盒螺钉松动。');
    await mark('转交事项' + qualityId + '给' + f.worker.displayName);
    await talk(f.worker, '开始整改事项' + qualityId);
    await talk(f.worker, '回复事项' + qualityId + '：材料准备好了。');
    let status = ((await page()).issues as Row[]).find(item => item.issueId === qualityId);
    assert.equal(status?.classification, 'rectifying');
    const firstFix = await report('主卧', '主卧底盒重新加固并核对', await upload());
    const reply = (recordId: string) => `整改回传事项${qualityId}记录${recordId}：螺钉重新固定。`;
    assert.equal((await command(f.worker, reply(firstFix))).status, 422);
    assert.equal(((await page()).issues as Row[]).find(item => item.issueId === qualityId)?.classification, 'rectifying');
    const recordPath = site + '/records/' + firstFix;
    const draftVersion = ((await versions(f.manager)).records as Row)[firstFix];
    const returned = await value(await staff(recordPath + '/request_changes', f.manager,
      { expectedVersion: draftVersion, requirements: '补拍底盒固定螺钉近照。' }));
    assert.equal(returned.status, 'changes_requested');
    const resubmitted = await value(await staff(recordPath + '/resubmit', f.worker, {
      expectedVersion: returned.version, text: '已补拍主卧底盒固定螺钉近照，重新核对固定。',
      mediaIds: [await upload(f.worker, '#829fbc')],
    }));
    assert.equal(resubmitted.resubmissionOfId, firstFix);
    const fixed = await organize(resubmitted, '主卧', '已补拍主卧底盒固定螺钉近照，重新核对固定。');
    await publishRecord(fixed, 'internal');
    const idempotencyKey = randomUUID(), beforeFeedback = await versions();
    const delivered = await Promise.all([0, 1].map(() => command(f.worker, reply(fixed), [], beforeFeedback, idempotencyKey)));
    const feedback = await Promise.all(delivered.map(item => value(item)));
    assert.deepEqual(feedback[0], feedback[1]);
    const awaiting = (await value(await staff(project, f.boss))).issueGroups as Row;
    assert.ok((awaiting.awaitingReview as Row[]).some(item => item.issueId === qualityId));
    assert.ok(!(awaiting.fixed as Row[]).some(item => item.issueId === qualityId));
    const ownerBefore = await value(await http('construction', project + '/progress', f.owner.token));
    assert.equal((ownerBefore.issues as Row[]).find(item => item.issueId === qualityId)?.classification, 'awaiting_review');
    await mark(`解决事项${qualityId}\n结论：底盒固定复核通过\n回传：底盒已固定。\n回传原件：否`);
    const falseRecord = await report('厨房', '厨房原记录的照片已补齐', await upload());
    const excludedId = String((await mark('跟进记录' + falseRecord + '：照片说明原归类有误。')).issueId);
    await mark('排除事项' + excludedId + '：照片关联错误，现场没有该问题。');
    const boss = await value(await staff(project, f.boss)), groups = boss.issueGroups as Row;
    assert.deepEqual(groups.quality, { open: 0, fixed: 1, excluded: 1 });
    assert.deepEqual((groups.fixed as Row[]).map(item => item.issueId), [qualityId]);
    assert.ok((groups.designReviews as Row[]).some(item => item.issueId === issueId));
    assert.ok((groups.excluded as Row[]).some(item => item.issueId === excludedId));
    assert.ok(!(groups.fixed as Row[]).some(item => item.issueId === excludedId));
    const brief = ((await value(await staff('brief', f.boss))).items as Row[]).find(item => item.projectId === f.pid);
    assert.deepEqual((brief?.issueGroups as Row).counts, groups.counts);
    const sibling = await withTenantTransaction(eid, tx => one(tx, sql`select id::text from app.construction_projects
      where enterprise_id=${eid} and id<>${f.pid} and name like '[B5.9] %' and status='active' order by id desc limit 1`));
    assert.ok(sibling, 'The retained B5.9 multi-project fixture is required');
    const other = await value(await staff('projects/' + sibling.id, f.boss));
    const otherBrief = ((await value(await staff('brief', f.boss))).items as Row[]).find(item => item.projectId === sibling.id);
    assert.deepEqual((otherBrief?.issueGroups as Row).counts, (other.issueGroups as Row).counts);
    assert.ok(!JSON.stringify(other.issueGroups).includes('"issueId":"' + qualityId + '"'));
    const ownerAfter = await value(await http('construction', project + '/progress', f.owner.token));
    status = (ownerAfter.issues as Row[]).find(item => item.issueId === qualityId);
    assert.equal(status?.classification, 'resolved');
  });

  await t.test('tenant, identity, private consultation, and read-only family access stay separate', async () => {
    assert.equal((await staff(project, f.foreignBoss)).status, 404);
    assert.equal((await http('construction', project + '/progress', f.outsider.token)).status, 404);
    assert.equal(await withTenantTransaction(control, tx => one(tx, sql`select id from app.domain_event_outbox where id=${currentPlan.id}`)), undefined);
    const viewer = project + '/family-viewers/' + f.family.uid;
    assert.equal((await http('construction', project + '/progress', f.family.token)).status, 404);
    await value(await http('construction', viewer, f.owner.token, { expectedVersion: 0, allowed: true }));
    const family = await value(await http('construction', project + '/progress', f.family.token));
    assert.equal(family.access, 'family_view');
    assert.equal(family.issues, undefined);
    assert.ok(((family.progress as Row).nodes as Row[]).every(node => node.evidence === null));
    assert.equal((await c01('/messages', f.family)).status, 404);
    assert.equal((await c01(planPath(currentPlan.id) + '/approve', f.family, { expectedRevision: 3 })).status, 404);
    assert.equal((await http('construction', viewer, f.family.token, { expectedVersion: 1, allowed: false })).status, 403);
    await value(await http('construction', viewer, f.owner.token, { expectedVersion: 1, allowed: false }));
    assert.equal((await http('construction', project + '/progress', f.family.token)).status, 404);
    assert.doesNotMatch(JSON.stringify(await page(f.designer)), /私聊标记B59/);
    const workerAsCustomer = await signMiniProgramToken({ sub: f.worker.uid, id: f.worker.uid,
      mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
    const noRole = await http('construction', site, workerAsCustomer);
    assert.ok([403, 404].includes(noRole.status));
  });

  await t.test('two independent HTTP Admin route hosts read the same persisted versions and enforce the same scope', async () => {
    const processes = [0, 1].map(() => b510Process<{ port: number; pid: number }>(t, ['admin-http']));
    try {
      const hosts = await Promise.all(processes.map(process => process.result()));
      assert.notEqual(hosts[0].pid, hosts[1].pid);
      const read = (path: string, token: string) => Promise.all(hosts.map(host => fetch(
        'http://127.0.0.1:' + host.port + '/api/miniprogram/' + path, {
          headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000),
        },
      )));
      const [first, second] = await Promise.all((await read('construction/' + project + '/schedule', f.worker.token))
        .map(response => value(response)));
      assert.deepEqual(first, second);
      assert.equal(first.version, 2);
      const originals = await Promise.all((await read('assistant/' + consultation + '/messages?limit=100', f.owner.token))
        .map(response => value(response)));
      for (const original of originals) assert.ok((original.items as Row[]).some(item => item.id === resultId && item.available !== false));
      assert.deepEqual((await read('construction/' + project + '/schedule', f.foreignBoss.token)).map(response => response.status), [404, 404]);
      assert.deepEqual((await read('assistant/' + consultation + '/messages', f.family.token)).map(response => response.status), [404, 404]);
      console.log('B5.10 HTTP hosts', JSON.stringify({ processes: hosts.map(host => host.pid), scheduleVersion: first.version, resultId }));
    } finally { await Promise.all(processes.map(process => process.kill())); }
  });

  await t.test('withdrawing the owner grant invalidates the effective plan and customer result', async () => {
    assert.equal((await c01(planPath(currentPlan.id))).status, 200);
    assert.equal((await staff(site + '/media/' + currentPlan.photo)).status, 200);
    const previousAllowlist = process.env.NATIVE_WORKFLOW_COLLABORATION_ENTERPRISE_IDS!;
    try {
      process.env.NATIVE_WORKFLOW_COLLABORATION_ENTERPRISE_IDS = '';
      const bossPhoto = await upload(f.boss, '#cfdce2');
      const attempt = await command(f.boss, `发布方案事项${issueId}\n标题：底盒位置\n差异：管理端变更\n费用变化：0元\n工期变化：0天`, [bossPhoto]);
      assert.equal(attempt.status, 403);
      assert.equal((await attempt.json()).error, 'construction_forbidden');
      assert.equal((await c01(planPath(currentPlan.id))).status, 200);
    } finally { process.env.NATIVE_WORKFLOW_COLLABORATION_ENTERPRISE_IDS = previousAllowlist; }
    await say('撤回共享资料' + needGrantId);
    await tick();
    assert.equal((await c01(planPath(currentPlan.id))).status, 404);
    assert.equal((await staff(site + '/media/' + currentPlan.photo)).status, 404);
    assert.ok(!((await page()).plans as Row[]).some(plan => plan.id === currentPlan.id));
    const history = (await value(await c01('/messages?limit=100'))).items as Row[];
    assert.equal(history.find(item => item.id === resultId)?.available, false);
    const progress = await value(await http('construction', project + '/progress', f.owner.token));
    const master = ((progress.progress as Row).nodes as Row[]).find(node => node.key === 'master');
    assert.equal((master?.evidence as Row).recordId, masterRecord);
  });

  assert.ok(masterRecord && issueId && designPlan && resultId && qualityId);
  console.log('B5.9 business anchors', JSON.stringify({ projectId: f.pid, conversationId: f.cid, delegationId: (await delegated())?.id,
    issueId, designPlan, resultId, qualityId, masterRecord, lifecycleRevision, owner: f.owner.uid, lead: f.lead,
    worker: { uid: f.worker.uid, staffId: f.worker.staffId }, designer: { uid: f.designer.uid, staffId: f.designer.staffId },
    manager: { uid: f.manager.uid, staffId: f.manager.staffId }, boss: { uid: f.boss.uid, staffId: f.boss.staffId } }));
});
