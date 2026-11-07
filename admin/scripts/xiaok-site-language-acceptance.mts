/* eslint-disable @typescript-eslint/no-explicit-any -- This driver preserves raw configured-model service evidence. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(process.cwd() + '/package.json');
require('@next/env').loadEnvConfig(process.cwd(), true);
const sourceDatabase = process.env.DATABASE_URL;
const root = path.resolve('..');
const out = path.resolve(process.argv.find(v => v.startsWith('--out='))?.slice(6) || '../tmp/xiaok-site-language-20261107/live01');
const casesPath = path.resolve(process.argv.find(v => v.startsWith('--cases='))?.slice(8) || '../tmp/xiaok-site-language-20261107/cases.json');
const corpus = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const onlyCase = process.argv.find(v => v.startsWith('--only-case='))?.slice(12);
const replayActionPath = process.argv.find(v => v.startsWith('--replay-first-action='))?.slice(22);
const replayAction = replayActionPath ? JSON.parse(fs.readFileSync(path.resolve(replayActionPath), 'utf8')) : null;
assert.equal(corpus.trialsPerCase, 2);
assert.equal(corpus.cases.length, 9);
assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Never overwrite an earlier batch');
fs.mkdirSync(out, { recursive: true });
process.env.DATABASE_URL = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8')).DATABASE_URL;
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = await imp('src/db/transaction.ts');
const { one, rows } = await imp('src/db/repositories/assistant-repository.ts');
const { ConstructionService } = await imp('src/lib/construction/service.ts');
const { SiteChatService } = await imp('src/lib/construction/site-chat.ts');
const { processSiteAction } = await imp('src/lib/construction/site-action-worker.ts');
const { cancelRuns } = await imp('src/lib/assistant/core/conversation.ts');
const { processAssistantRun } = await imp('src/lib/assistant/application/worker.ts');
const { claimJob } = await imp('src/lib/assistant/infrastructure/job-queue.ts');
const { closePostgresPool, resolvePostgresRuntimeConfig } = await imp('src/lib/postgresql.ts');
const { lockAssistantAcceptance } = await imp('scripts/assistant-acceptance-safety.mjs');
const eid = '1454', prefix = 'synthetic-worker-language-' + randomUUID();
const read = (fn: any) => withTenantTransaction(eid, fn);
const platform = (fn: any) => withPlatformTransaction(fn);
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const report: any = { target: 'isolated55432/xiaok_embedding_eval', enterpriseId: eid, prefix,
  startedAt: new Date().toISOString(), mode: 'unchanged product, real services, current configured model, no publication or automatic repair',
  corpusHash: hash(fs.readFileSync(casesPath)), scenarios: [], sourceDrift: [], completed: false, passed: false };
report.selectedCase = onlyCase || null;
report.replayedAdmission = replayActionPath ? { source: replayActionPath, sourceRun: replayAction.run.id,
  reason: 'Original admission succeeded; its unstarted child and the unstarted second admission were cancelled after a driver queue error. Reuse the original successful admission; do not resample it.' } : null;
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const files = new Set<string>();
const ts = require('typescript');
const cfg = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(cfg.config, ts.sys, process.cwd()).options;
function visit(f: string) {
  if (files.has(f) || f.includes('node_modules') || !fs.existsSync(f)) return;
  files.add(f);
  for (const i of ts.preProcessFile(fs.readFileSync(f, 'utf8'), true, true).importedFiles) {
    const resolved = ts.resolveModuleName(i.fileName, f, options, ts.sys).resolvedModule?.resolvedFileName;
    if (resolved) visit(path.resolve(resolved));
  }
}
for (const f of ['src/lib/construction/site-chat.ts', 'src/lib/construction/service.ts', 'src/lib/assistant/application/worker.ts']) visit(path.resolve(f));
for (const f of [fileURLToPath(import.meta.url), casesPath, path.resolve('package.json'), path.resolve('package-lock.json'),
  path.resolve('tsconfig.json'), path.resolve('.env.local'), path.resolve('../tmp/xiaok-vector/connection.private.json')]) files.add(f);
if (replayActionPath) files.add(path.resolve(replayActionPath));
for (const c of corpus.cases) for (const turn of c.turns) for (const photo of turn.photos || []) files.add(path.join(root, 'tmp/xiaok-vector/renovation-photos', photo));
const binding = () => Object.fromEntries([...files].sort().map(f => [path.relative(root, f).replaceAll('\\', '/'), hash(fs.readFileSync(f))]));
const counts = () => platform(async (tx: any) => ({
  attempts: Number((await one(tx, sql`select count(*)::int n from app.ai_provider_attempts`)).n),
  queue: Number((await one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)).n),
  pending: Number((await one(tx, sql`select count(*)::int n from app.construction_report_deliveries where state in ('pending','held')`)).n),
}));
let release: any, assistantBefore: any, platformBefore: any, owner: any, ownerId = '', workerId = '', uid = '';
const projects: string[] = [];
try {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432' && url.pathname === '/xiaok_embedding_eval');
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  report.before = await counts(); assert.equal(report.before.queue, 0); assert.equal(report.before.pending, 0);
  const main = new URL(sourceDatabase!);
  assert.ok(['127.0.0.1', 'localhost'].includes(main.hostname) && main.port === '5432' && main.pathname === '/smart_floor_planner');
  const client = new (require('pg').Client)({ connectionString: sourceDatabase, connectionTimeoutMillis: 5000 });
  let source: any, sourceAssistant: any;
  try {
    await client.connect(); await client.query('begin read only');
    await client.query("select set_config('app.is_platform_admin','true',true)");
    source = (await client.query("select llm_config from app.platform_configs where key='default'")).rows[0]?.llm_config;
    sourceAssistant = (await client.query('select agent_config from app.assistant_enterprise_settings where enterprise_id=1454')).rows[0]?.agent_config;
    await client.query('rollback');
  } finally { await client.end(); }
  assert.equal(source.providerKey, sourceAssistant.providerKey);
  assert.equal(source.model, sourceAssistant.model);
  assert.equal(sourceAssistant.imageInput, true);
  report.configuration = { providerKey: source.providerKey, model: sourceAssistant.model, imageInput: true,
    platformHash: hash(JSON.stringify(source)), sourceAgentHash: hash(JSON.stringify(sourceAssistant)), enterpriseKnowledgeEnabled: false };
  assistantBefore = await read((tx: any) => one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=1454`));
  platformBefore = await platform((tx: any) => one(tx, sql`select llm_config from app.platform_configs where key='default' for update`));
  assert.equal(assistantBefore.enabled, false, 'Do not take over another enabled evaluation');
  await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(source)}::jsonb where key='default'`));
  await read((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,
    agent_config=${JSON.stringify({ ...sourceAssistant, enterpriseKnowledgeEnabled: false })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  report.bindingBefore = binding(); save();
  await platform(async (tx: any) => {
    uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + ':customer'},1) returning id`)).id);
    for (const a of [{ tag: 'owner', role: 'enterprise_admin' }, { tag: 'worker', role: 'construction_staff' }]) {
      const id = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password)
        values(1454,${prefix + ':' + a.tag},${'合成测试·口语上报·' + a.tag},'unusable-local-fixture',${a.role},'active',false) returning id`)).id);
      if (a.tag === 'owner') ownerId = id; else workerId = id;
    }
  });
  owner = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
  report.fixture = { uid, ownerId, workerId, projects };
  for (const test of corpus.cases.filter((c: any) => !onlyCase || c.id === onlyCase)) {
    const scenario: any = { id: test.id, category: test.category, expectations: test.expectations, trials: [] };
    report.scenarios.push(scenario); save();
    for (let trial = 1; trial <= corpus.trialsPerCase; trial++) {
      await release.assertHeld();
      const current = binding(); assert.deepEqual(current, report.bindingBefore, 'Source drift stops dispatch');
      const lead = await read((tx: any) => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(1454,${uid},${prefix + ':' + test.id + ':' + trial},${'138' + String(Date.now()).slice(-8)},'natural') returning id`));
      const pid = String((await owner.execute('create', { leadId: String(lead.id), name: '合成测试·口语上报·' + test.id + '·' + trial,
        managerId: ownerId, rooms: ['客厅','厨房','卧室','卫生间'] }, randomUUID())).id);
      projects.push(pid);
      let d = await owner.execute('detail', { projectId: pid });
      await owner.execute('update', { projectId: pid, expectedVersion: Number(d.project.version), name: d.project.name, status: 'active', customerAccess: false }, randomUUID());
      d = await owner.execute('detail', { projectId: pid });
      await owner.execute('member', { projectId: pid, expectedVersion: Number(d.project.version), adminId: workerId, role: 'worker', active: true, workLabel: '合成测试' }, randomUUID());
      const staff = new SiteChatService({ enterpriseId: eid, adminId: workerId });
      const t: any = { trial, projectId: pid, turns: [] }; scenario.trials.push(t); save();
      for (const turn of test.turns) {
        const mediaIds: string[] = [], photos: any[] = [];
        for (const photo of turn.photos || []) {
          const bytes = fs.readFileSync(path.join(root, 'tmp/xiaok-vector/renovation-photos', photo));
          const media = await staff.upload(pid, randomUUID(), bytes); mediaIds.push(media.id); photos.push({ file: photo, sourceHash: hash(bytes), id: media.id });
        }
        const requestKey = randomUUID(), startedAt = new Date().toISOString();
        const receipt = await staff.send(pid, { text: turn.text, mediaIds }, requestKey);
        assert.deepEqual(await staff.send(pid, { text: turn.text, mediaIds }, requestKey), receipt, 'Same-operation receipt is idempotent');
        const result: any = { input: turn.text, photos, receipt, startedAt, attemptsBefore: (await counts()).attempts };
        t.turns.push(result); save();
        async function executeRun(expectedRunId: string, admission = false) {
          const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, expectedRunId);
          if (admission && trial === 1 && replayAction) {
            assert.equal(replayAction.run.purpose, 'site.action');
            const output = replayAction.steps.find((s: any) => Number(s.step_seq) === 1110)?.private_checkpoint;
            assert.ok(output); result.reusedAdmission = String(replayAction.run.id);
            await processSiteAction(lease, async () => output);
          } else await processAssistantRun(lease);
          const run = await read((tx: any) => one(tx, sql`select id::text,purpose,status,error_code,policy_snapshot,output_message_id::text from app.assistant_runs where enterprise_id=1454 and id=${expectedRunId}`));
          const steps = await read((tx: any) => rows(tx, sql`select * from app.assistant_run_steps where enterprise_id=1454 and run_id=${expectedRunId} order by step_seq`));
          fs.writeFileSync(path.join(out, 'run-' + expectedRunId + '.json'), JSON.stringify({ run, steps }, null, 2));
          const runSummary = { id: run.id, purpose: run.purpose, status: run.status, error: run.error_code };
          if (expectedRunId === receipt.runId) result.run = runSummary;
          else (result.descendantRuns ||= []).push(runSummary);
          (result.modelOutputs ||= []).push(...steps.filter((s: any) => s.private_checkpoint && s.kind === 'agent_model').map((s: any) => ({ runId: expectedRunId, step: s.step_seq, output: s.private_checkpoint })));
          (result.usage ||= []).push(...await read((tx: any) => rows(tx, sql`select ${expectedRunId}::text run_id,provider_attempt_id::text,input_tokens,output_tokens,quantity,measurement_kind from app.assistant_usage_records where enterprise_id=1454 and run_id=${expectedRunId} order by id`)));
          save();
          assert.equal(run.status, 'succeeded', 'A failed or unknown provider/service run stops this batch: ' + run.error_code);
        }
        if (receipt.runId) {
          await executeRun(receipt.runId, true);
          // Natural action interpretation can enqueue the original site.record processor.
          // Complete only descendants in this exact project conversation, with a bounded scan.
          for (let depth = 0; depth < 2; depth++) {
            const pending = await read((tx: any) => rows(tx, sql`select r.id::text from app.assistant_runs r join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id
              where r.enterprise_id=1454 and r.conversation_id=${receipt.conversationId} and j.status in ('queued','running') order by j.id`));
            if (!pending.length) break;
            assert.equal(pending.length, 1, 'Only one bounded report continuation is expected');
            await executeRun(pending[0].id);
          }
          assert.equal((await counts()).queue, 0, 'No child task is left between trials');
        }
        const reentry: any = await staff.read(pid);
        result.records = reentry.items.filter((i: any) => i.record).map((i: any) => ({ messageId: String(i.message.id), recordId: String(i.record.id),
          status: i.record.status, data: i.record.data, roomId: i.record.room_id, sourceText: i.message.content, canPublishCustomer: i.record.canPublishCustomer }));
        result.responses = reentry.items.filter((i: any) => i.response).map((i: any) => ({ messageId: String(i.message.id), response: i.response }));
        result.finishedAt = new Date().toISOString();
        result.attemptsAfter = (await counts()).attempts;
        assert.ok(result.records.every((r: any) => r.status !== 'published'), 'Evaluation does not publish model output');
        save(); console.log(JSON.stringify({ scenario: test.id, trial, turn: t.turns.length, intent: receipt.intent || result.run?.purpose, runId: receipt.runId || null, recordId: receipt.recordId || null, status: result.run?.status || receipt.status }));
      }
    }
  }
  report.completed = true;
  report.passed = null; // Semantic quality is assessed from original inputs and outputs, never from run.status alone.
} catch (e) { report.error = (e as Error).stack || String(e); process.exitCode = 1; }
finally {
  try {
    for (const pid of projects) {
      await read(async (tx: any) => {
        const chat = await one(tx, sql`select conversation_id::text from app.construction_chats where enterprise_id=1454 and project_id=${pid}`);
        if (chat) await cancelRuns(tx, { enterpriseId: eid, principal: { kind: 'admin', adminId: workerId }, contextVersion: 1, capabilities: ['assistant.project.shared'] }, chat.conversation_id);
      });
      const d = await owner.execute('detail', { projectId: pid });
      await owner.execute('update', { projectId: pid, expectedVersion: Number(d.project.version), name: d.project.name, status: 'archived', customerAccess: false }, randomUUID());
      await read((tx: any) => tx.execute(sql`update app.construction_site_media set data=null,deleted_at=coalesce(deleted_at,now()) where enterprise_id=1454 and project_id=${pid}`));
    }
    if (ownerId || workerId) await platform((tx: any) => tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=1454 and username like ${prefix + '%'}`));
    if (uid) await platform((tx: any) => tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`));
    if (platformBefore) await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`));
    if (assistantBefore) await read((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${assistantBefore.enabled},
      agent_config=${JSON.stringify(assistantBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
    report.after = await counts(); assert.equal(report.after.queue, 0); assert.equal(report.after.pending, 0);
    report.cleanup = { restored: true, projectsArchived: projects.length, mediaCleared: true, actorsDisabled: true };
  } catch (e) { report.cleanupError = String(e); process.exitCode = 1; }
  if (report.bindingBefore) {
    report.bindingAfter = binding(); report.sourceDrift = Object.keys(report.bindingBefore).filter(f => report.bindingBefore[f] !== report.bindingAfter[f]);
    if (report.sourceDrift.length) { report.completed = false; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); save();
  if (release) await release(); await closePostgresPool();
  console.log(JSON.stringify({ completed: report.completed, scenarios: report.scenarios.length, error: report.error,
    cleanup: report.cleanup, cleanupError: report.cleanupError, sourceDrift: report.sourceDrift }));
}
