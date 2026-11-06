/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled original-client acceptance with retained isolated receipts. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('package.json'));
require('@next/env').loadEnvConfig(process.cwd(), true);
const primary = process.env.DATABASE_URL, root = path.resolve('..'), eid = '1454';
const out = path.join(root, 'tmp/xiaok-mineru-fastgpt-preview-20261107');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
const fixture = read('preparation.json'), contextV2 = process.argv.includes('--source-v2');
const selected = contextV2 ? read('table-context-v2.json').source : fixture.parts.find((p: any) => p.page === 27);
const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'client-service';
assert.match(label, /^[a-zA-Z0-9-]+$/);
const reportFile = path.join(out, label + '.json');
assert.ok(!fs.existsSync(reportFile), 'Keep the first client batch intact');
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
process.env.XIAOK_FASTGPT_RETRIEVAL_FILE = path.join(out, 'retrieval.private.json');
const url = new URL(process.env.DATABASE_URL!); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { claimKnowledgeJob, runKnowledgeJob } = require(path.resolve('src/lib/assistant/knowledge/index-worker.ts'));
const { ConversationService, cancelRuns } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { claimJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { closePostgresPool } = require(path.resolve('src/lib/postgresql.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');
const tenant = (fn: any) => withTenantTransaction(eid, fn), platform = (fn: any) => withPlatformTransaction(fn);
const actor = { enterpriseId: eid, principal: { kind: 'admin', adminId: fixture.adminIds[0] }, contextVersion: 1, capabilities: ['assistant.preview.self'] };
const service = new ConversationService(actor), knowledge = new KnowledgeService({ enterpriseId: eid, adminId: fixture.adminIds[0] });
const report: any = { status: 'preparing', source: selected, fixedQuestion: '123平米那份主材预算里，瓷砖类的小计是多少？',
  fixedModel: 'qwen3.7-flash', maxNormalRuns: contextV2 ? 2 : 1, runs: [], commands: [], unknownCost: true };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const files = ['src/lib/assistant/knowledge/mineru.ts', 'src/lib/assistant/knowledge/fastgpt-retrieval.ts', 'src/lib/assistant/knowledge/retrieval.ts',
  'src/lib/assistant/knowledge/sources.ts', 'src/lib/assistant/agent/worker.ts', 'src/lib/assistant/core/conversation.ts', 'src/lib/assistant/infrastructure/answer-worker.ts',
  'src/components/assistant/preview-panel.tsx', 'src/components/assistant/retrieval-diagnostics.tsx', 'scripts/fastgpt/mineru-preview-client.mts'];
const binding = () => {
  const ts = require('typescript'), cfg = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(cfg.config, ts.sys, process.cwd()).options, inputs = new Set<string>();
  const visit = (f: string) => {
    if (inputs.has(f) || f.includes('node_modules') || !fs.existsSync(f)) return;
    inputs.add(f);
    for (const i of ts.preProcessFile(fs.readFileSync(f, 'utf8'), true, true).importedFiles) {
      const resolved = ts.resolveModuleName(i.fileName, f, options, ts.sys).resolvedModule?.resolvedFileName;
      if (resolved) visit(path.resolve(resolved));
    }
  };
  for (const f of files) visit(path.resolve(f));
  for (const f of ['package-lock.json', 'package.json', '.env.local']) inputs.add(path.resolve(f));
  inputs.add(process.env.XIAOK_FASTGPT_RETRIEVAL_FILE!);
  return Object.fromEntries([...inputs].sort().map(f => [path.relative(root, f).replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
};
let release: any, before: any, platformBefore: any, retired = false, stop = false, seenCommands = 0;
const cids = new Set<string>();
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  before = await tenant((tx: any) => one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`));
  assert.equal(before.enabled, false);
  platformBefore = await platform((tx: any) => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
  const client = new (require('pg').Client)({ connectionString: primary }); let source: any;
  try { await client.connect(); await client.query('begin read only'); source = (await client.query("select llm_config from app.platform_configs where key='default'")).rows[0].llm_config; await client.query('rollback'); } finally { await client.end(); }
  if (source.providerKey !== 'dashscope') { assert.ok(source.profiles?.dashscope?.apiKeyEncrypted); source = { ...source, ...source.profiles.dashscope, providerKey: 'dashscope' }; }
  await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify({ ...source, model: report.fixedModel })}::jsonb where key='default'`));
  const config = { ...before.agent_config, runtime: 'langgraph-v1', providerKey: 'dashscope', model: report.fixedModel, imageInput: false, tools: true,
    enterpriseKnowledgeEnabled: false, knowledgeExplanation: 'natural-knowledge-answer-v1', knowledgeAnswerValidation: 'server-source-boundary-v1' };
  await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify(config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`));
  const detail = await knowledge.execute('detail', { documentId: selected.documentId });
  const draft = detail.versions.find((v: any) => String(v.id) === selected.versionId);
  if (draft.index_status !== 'ready') {
    const index = await knowledge.execute('index', { documentId: selected.documentId, versionId: selected.versionId, expectedEditVersion: Number(draft.edit_version) }, randomUUID());
    const lease = await claimKnowledgeJob(); assert.ok(lease); assert.equal(lease.jobId, index.jobId); await runKnowledgeJob(lease);
    assert.equal((await knowledge.execute('job', { jobId: index.jobId })).status, 'succeeded');
  }
  report.bindingBefore = binding(); report.status = 'ready'; save(); console.log(JSON.stringify({ ready: true, documentId: selected.documentId, versionId: selected.versionId, fixedQuestion: report.fixedQuestion }));
  const deadline = Date.now() + 15 * 60 * 1000;
  while (!stop && Date.now() < deadline) {
    await release.assertHeld();
    const commandsPath = path.join(out, label + '-commands.jsonl');
    const commands = fs.existsSync(commandsPath) ? fs.readFileSync(commandsPath, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : [];
    for (const command of commands.slice(seenCommands)) {
      if (command.action === 'revoke_admin') await platform((tx: any) => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY[]::text[] where id=${fixture.adminIds[0]}`));
      else if (command.action === 'restore_admin') await platform((tx: any) => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-knowledge'] where id=${fixture.adminIds[0]}`));
      else if (command.action === 'retire_source') {
        const current = await knowledge.execute('detail', { documentId: selected.documentId });
        await knowledge.execute('retire', { documentId: selected.documentId, expectedVersion: Number(current.document.version) }, randomUUID()); retired = true;
      } else if (command.action === 'stop') stop = true;
      else throw Error('Unexpected client command');
      report.commands.push({ action: command.action, doneAt: new Date().toISOString() }); seenCommands++; save();
    }
    const job = await claimJob();
    if (job) {
      assert.equal(job.actor.principal.kind, 'admin'); assert.equal(job.actor.principal.adminId, actor.principal.adminId);
      const context = await tenant((tx: any) => one(tx, sql`select c.*,m.content from app.assistant_runs r join app.assistant_conversations c
        on c.enterprise_id=r.enterprise_id and c.id=r.conversation_id join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.trigger_message_id
        where r.enterprise_id=${eid} and r.id=${job.runId}`));
      assert.equal(context.purpose, 'knowledge_preview');
      assert.deepEqual(context.entry_snapshot.preview.drafts.map((d: any) => d.id), [selected.versionId]);
      const question = context.content.blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      if (!retired) { assert.ok(report.runs.filter((r: any) => !r.revoked).length < report.maxNormalRuns); assert.equal(question, report.fixedQuestion); }
      cids.add(String(context.id));
      assert.deepEqual(binding(), report.bindingBefore);
      const beforeCount = await platform((tx: any) => one(tx, sql`select count(*)::int n from app.ai_provider_attempts`));
      await processAssistantRun(job);
      const trace = await tenant(async (tx: any) => ({ run: await one(tx, sql`select * from app.assistant_runs where enterprise_id=${eid} and id=${job.runId}`),
        steps: await rows(tx, sql`select * from app.assistant_run_steps where enterprise_id=${eid} and run_id=${job.runId} order by step_seq`),
        usage: await rows(tx, sql`select * from app.assistant_usage_records where enterprise_id=${eid} and run_id=${job.runId}`) }));
      const afterCount = await platform((tx: any) => one(tx, sql`select count(*)::int n from app.ai_provider_attempts`));
      fs.writeFileSync(path.join(out, 'client-run-' + job.runId + '.json'), JSON.stringify(trace, null, 2));
      report.runs.push({ runId: job.runId, conversationId: String(context.id), question, status: trace.run.status, error: trace.run.error_code,
        providerAttempts: afterCount.n - beforeCount.n, revoked: retired, messageId: trace.run.output_message_id }); save();
      if (retired) { assert.equal(afterCount.n, beforeCount.n); assert.equal(trace.run.error_code, 'context_changed'); assert.equal(trace.run.output_message_id, null); }
      else assert.equal(trace.run.status, 'succeeded', String(trace.run.error_code));
      assert.deepEqual(binding(), report.bindingBefore);
      console.log(JSON.stringify(report.runs.at(-1)));
    } else await new Promise(resolve => setTimeout(resolve, 500));
  }
  // Authorization may finish a revoked job inside claimJob, before any lease
  // reaches this controller. Inspect its real durable receipt rather than
  // requiring a provider dispatch or mistaking that rejection for no run.
  if (retired) {
    const denied = await tenant((tx: any) => rows(tx, sql`select r.*,j.provider_started_at,
      (select count(*)::int from app.assistant_run_steps s where s.enterprise_id=r.enterprise_id and s.run_id=r.id and s.provider_attempt_id is not null) provider_steps
      from app.assistant_runs r join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id
      where r.enterprise_id=${eid} and r.conversation_id in (${sql.join([...cids].map(cid => sql`${cid}`), sql`,`)})
      and r.error_code='context_changed' order by r.id`));
    for (const r of denied.filter((r: any) => !report.runs.some((done: any) => done.runId === String(r.id)))) {
      assert.equal(r.status, 'failed'); assert.equal(r.output_message_id, null); assert.equal(r.provider_started_at, null); assert.equal(r.provider_steps, 0);
      report.runs.push({ runId: String(r.id), conversationId: String(r.conversation_id), status: r.status, error: r.error_code,
        providerAttempts: 0, revoked: true, messageId: null, rejection: 'claim_authorization' });
    }
  }
  assert.ok(stop, 'Client controller timed out');
  assert.equal(report.runs.filter((r: any) => !r.revoked).length, report.maxNormalRuns);
  assert.equal(report.runs.filter((r: any) => r.revoked).length, 1);
  report.status = 'passed'; report.bindingAfter = binding();
} catch (error) { report.status = 'failed'; report.error = (error as Error).stack; process.exitCode = 1; }
finally {
  const errors: string[] = [], clean = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { errors.push(String(error)); } };
  await clean(() => platform((tx: any) => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-knowledge'] where id=${fixture.adminIds[0]}`)));
  for (const cid of cids) await clean(async () => { await tenant((tx: any) => cancelRuns(tx, actor, cid)); const c = await service.detail(cid); if (c.status === 'open') await service.archive(cid, c.version, randomUUID()); });
  if (before) await clean(() => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${before.enabled},agent_config=${JSON.stringify(before.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`)));
  if (platformBefore) await clean(() => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  report.cleanup = { restored: !errors.length, errors }; save(); await release?.(); await closePostgresPool(); console.log(JSON.stringify({ status: report.status, error: report.error, cleanup: report.cleanup }));
}
