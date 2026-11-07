/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled original-client acceptance with retained isolated receipts. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('package.json'));
require('@next/env').loadEnvConfig(process.cwd(), true);
const primary = process.env.DATABASE_URL, root = path.resolve('..'), eid = '1454';
const baseOut = path.join(root, 'tmp/xiaok-mineru-fastgpt-preview-20261107');
const reviewed = process.argv.includes('--reviewed'), contextV2 = process.argv.includes('--source-v2');
assert.ok(!(reviewed && contextV2));
const fixtureArg = process.argv.find(x => x.startsWith('--fixture-dir='))?.slice('--fixture-dir='.length);
const out = fixtureArg ? path.resolve(fixtureArg) : reviewed ? path.join(baseOut, 'ocr-review') : baseOut;
assert.ok(out.startsWith(path.join(root, 'tmp') + path.sep));
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
const fixture = read('preparation.json');
assert.equal(fixture.status, 'ready'); assert.equal(fixture.enterpriseId, eid);
const pptCraft = fixture.protocol === 'xiaok-ppt-craft-preview-v1';
const craftManifest = pptCraft ? path.resolve('scripts/fixtures/xiaok-ppt-craft-preview.json') : undefined;
const craftInput = craftManifest ? JSON.parse(fs.readFileSync(craftManifest, 'utf8')) : undefined;
if (craftManifest) {
  assert.ok(fixtureArg && reviewed);
  assert.equal(createHash('sha256').update(fs.readFileSync(craftManifest)).digest('hex'), fixture.manifestSha256);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, craftInput.source.file))).digest('hex'), fixture.sourceSha256);
}
const reviewCase = craftInput ? {
  protocol: craftInput.protocol, trials: craftInput.acceptance.trials,
  pages: craftInput.drafts.map((draft: { slide: number }) => draft.slide),
  questions: craftInput.acceptance.questions.map((question: { text: string }) => question.text),
} : fixtureArg ? read('acceptance-case.json') : undefined;
if (reviewCase) {
  assert.ok(reviewed); assert.equal(reviewCase.protocol, pptCraft ? 'xiaok-ppt-craft-preview-v1' : 'mineru-native-ocr-bookpage-v1');
  assert.equal(reviewCase.trials, 2);
  assert.ok(Array.isArray(reviewCase.questions) && reviewCase.questions.length === (pptCraft ? 2 : 3)
    && reviewCase.questions.every((q: unknown) => typeof q === 'string' && q.length > 0 && q.length < 1000));
}
const selectedPage = pptCraft ? craftInput.acceptance.questions[0].slide : reviewed ? 14 : 27;
const selected = contextV2 ? read('table-context-v2.json').source : fixture.parts.find((p: any) => p.page === selectedPage);
const previewParts = reviewCase ? fixture.parts.filter((p: any) => reviewCase.pages.includes(p.page)) : [selected];
if (reviewCase) assert.equal(previewParts.length, reviewCase.pages.length);
const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || (reviewed ? 'client-reviewed' : 'client-service');
assert.match(label, /^[a-zA-Z0-9-]+$/);
const continueFrom = process.argv.find(x => x.startsWith('--continue-reviewed='))?.slice('--continue-reviewed='.length);
if (continueFrom) { assert.ok(reviewed && continueFrom !== label); assert.match(continueFrom, /^[a-zA-Z0-9-]+$/); }
const priorBatch = continueFrom ? read(continueFrom + '.json') : undefined;
const reportFile = path.join(out, label + '.json');
assert.ok(!fs.existsSync(reportFile), 'Keep the first client batch intact');
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
process.env.XIAOK_FASTGPT_RETRIEVAL_FILE = pptCraft ? '' : path.join(fixtureArg ? out : baseOut, 'retrieval.private.json');
const url = new URL(process.env.DATABASE_URL!); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { claimKnowledgeJob, runKnowledgeJob } = require(path.resolve('src/lib/assistant/knowledge/index-worker.ts'));
const { ConversationService, cancelRuns } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { claimJob } = require(path.resolve('src/lib/assistant/infrastructure/job-queue.ts'));
const { processAssistantRun } = require(path.resolve('src/lib/assistant/application/worker.ts'));
const { retrieveKnowledge } = require(path.resolve('src/lib/assistant/knowledge/retrieval.ts'));
const { resolveEvidence, validatePreviewSnapshot } = require(path.resolve('src/lib/assistant/knowledge/sources.ts'));
const { closePostgresPool } = require(path.resolve('src/lib/postgresql.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');
const tenant = (fn: any) => withTenantTransaction(eid, fn), platform = (fn: any) => withPlatformTransaction(fn);
const actor = { enterpriseId: eid, principal: { kind: 'admin', adminId: fixture.adminIds[0] }, contextVersion: 1, capabilities: ['assistant.preview.self'] };
const service = new ConversationService(actor), knowledge = new KnowledgeService({ enterpriseId: eid, adminId: fixture.adminIds[0] });
const questions: string[] = reviewCase?.questions ?? (reviewed ? ['我在看手册里97平米那页柜子预算，右边电器、家具也都是97平米的吗？能算进装修总价吗？',
  '那家具参考表里，沙发茶几和主卧室床各多少钱？'] : ['123平米那份主材预算里，瓷砖类的小计是多少？']);
const trials = continueFrom ? 1 : reviewed || contextV2 ? 2 : 1;
if (priorBatch) {
  assert.equal(priorBatch.status, 'failed'); assert.match(priorBatch.error, /Client controller timed out/);
  assert.equal(priorBatch.cleanup.restored, true); assert.deepEqual(priorBatch.fixedQuestions, questions);
  assert.equal(priorBatch.fixedTrials, 2); assert.equal(priorBatch.runs.length, questions.length);
  assert.equal(new Set(priorBatch.runs.map((r: any) => r.conversationId)).size, 1);
  for (const run of priorBatch.runs) assert.equal(read('review-' + run.runId + '.json').accepted, true);
}
const report: any = { status: 'preparing', source: selected, fixedQuestions: questions, fixedTrials: trials,
  fixedModel: 'qwen3.7-flash', maxNormalRuns: questions.length * trials, runs: [], commands: [], unknownCost: true, continueFrom };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const files = ['src/lib/assistant/knowledge/mineru.ts', 'src/lib/assistant/knowledge/fastgpt-retrieval.ts', 'src/lib/assistant/knowledge/retrieval.ts',
  'src/lib/assistant/knowledge/sources.ts', 'src/lib/assistant/agent/worker.ts', 'src/lib/assistant/core/conversation.ts', 'src/lib/assistant/infrastructure/answer-worker.ts',
  'src/components/assistant/preview-panel.tsx', 'src/components/assistant/retrieval-diagnostics.tsx', 'scripts/fastgpt/mineru-preview-client.mts',
  'src/app/api/assistant/preview/[...path]/route.ts', 'src/app/(admin)/(merchant)/assistant-knowledge/page.tsx'];
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
  if (process.env.XIAOK_FASTGPT_RETRIEVAL_FILE) inputs.add(process.env.XIAOK_FASTGPT_RETRIEVAL_FILE);
  if (reviewed) inputs.add(path.join(out, 'preparation.json'));
  if (craftManifest) {
    inputs.add(craftManifest);
    inputs.add(path.join(root, craftInput.source.file));
  } else {
    if (reviewed) inputs.add(path.join(out, 'reviewed-contexts.json'));
    if (reviewCase) for (const f of ['acceptance-case.json', 'corpus-chunks.json', 'corpus-provenance.json']) inputs.add(path.join(out, f));
  }
  return Object.fromEntries([...inputs].sort().map(f => [path.relative(root, f).replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
};
let release: any, before: any, platformBefore: any, accountBefore: any, retired = false, stop = false, seenCommands = 0;
const cids = new Set<string>();
const seenCids = new Set<string>();
const verifyPrevious = (runs: any[]) => {
  if (reviewed && runs.length) {
    const result = read('review-' + runs.at(-1).runId + '.json');
    assert.equal(result.accepted, true, result.reason);
  }
};
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  before = await tenant((tx: any) => one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`));
  assert.equal(before.enabled, false);
  if (reviewed) await platform(async (tx: any) => {
    const password = process.env.MINERU_REVIEW_SYNTHETIC_PASSWORD;
    assert.ok(password && password.length >= 20);
    accountBefore = await one(tx, sql`select password_hash,menu_permissions from app.admin_users where enterprise_id=${eid}
      and id=${fixture.adminIds[0]} and username=${fixture.prefix + ':0'} and status='active' for update`);
    assert.ok(accountBefore?.menu_permissions.includes('assistant-knowledge'));
    await tx.execute(sql`update app.admin_users set password_hash=${await require('bcryptjs').hash(password, 10)}
      where enterprise_id=${eid} and id=${fixture.adminIds[0]}`);
  });
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
  if (pptCraft) assert.equal(draft.index_status, 'ready');
  if (draft.index_status !== 'ready') {
    const index = await knowledge.execute('index', { documentId: selected.documentId, versionId: selected.versionId, expectedEditVersion: Number(draft.edit_version) }, randomUUID());
    const lease = await claimKnowledgeJob(); assert.ok(lease); assert.equal(lease.jobId, index.jobId); await runKnowledgeJob(lease);
    assert.equal((await knowledge.execute('job', { jobId: index.jobId })).status, 'succeeded');
  }
  if (reviewed) {
    if (!pptCraft) assert.equal(draft.source_file.parsed.parser, reviewCase?.parser ?? 'mineru-reviewed-page-v3');
    assert.equal(draft.published_at, null); assert.equal(detail.document.audience, 'staff_internal');
    report.sourceBinding = { editVersion: draft.edit_version, contentHash: draft.content_hash, assetHash: draft.source_file?.hash ?? null, reviewHash: fixture.reviewHash };
  }
  if (reviewCase) {
    report.sourceBindings = [];
    for (const part of previewParts) {
      const detail = await knowledge.execute('detail', { documentId: part.documentId });
      const v = detail.versions.find((v: any) => String(v.id) === part.versionId);
      assert.equal(v.published_at, null); assert.equal(v.index_status, 'ready'); assert.equal(v.indexed_hash, v.content_hash);
      assert.equal(detail.document.audience, 'staff_internal');
      if (pptCraft) {
        const source = craftInput.drafts.find((entry: { slide: number }) => entry.slide === part.page);
        assert.equal(detail.document.category, fixture.category);
        assert.equal(detail.document.status, 'draft');
        assert.equal(detail.document.source_type, 'manual_text');
        assert.equal(detail.document.title, source.title);
        assert.equal(v.body, source.body);
        assert.equal(v.content_hash, part.contentHash);
      } else assert.equal(v.source_file.parsed.parser, reviewCase.parser);
      report.sourceBindings.push({ page: part.page, documentId: part.documentId, versionId: part.versionId, editVersion: v.edit_version,
        contentHash: v.content_hash, assetHash: v.source_file?.hash ?? null });
    }
    if (pptCraft) {
      const activeStaff = await tenant((tx: any) => rows(tx, sql`select id from app.assistant_knowledge_documents
        where enterprise_id=${eid} and audience='staff_internal' and status='active' and published_version_id is not null`));
      assert.equal(activeStaff.length, 0);
    }
    report.seedConversations = [];
    for (let trial = 0; trial < trials; trial++) {
      const c = await service.create(randomUUID(), { audience: 'staff_internal', draftVersionIds: previewParts.map((p: any) => p.versionId) });
      cids.add(String(c.id)); report.seedConversations.push(String(c.id));
    }
  }
  report.bindingBefore = binding();
  if (priorBatch) {
    assert.deepEqual(report.sourceBinding, priorBatch.sourceBinding); assert.equal(report.fixedModel, priorBatch.fixedModel);
    const runtime = (b: Record<string, string>) => Object.fromEntries(Object.entries(b)
      .filter(([file]) => file !== 'admin/scripts/fastgpt/mineru-preview-client.mts'));
    assert.deepEqual(runtime(report.bindingBefore), runtime(priorBatch.bindingBefore));
    report.continuation = { previousDriverBindingPreservedIn: continueFrom + '.json',
      matchingRuntimeAndConfiguration: true, completedPreviousRuns: priorBatch.runs.map((r: any) => r.runId) };
  }
  report.status = 'ready'; save();
  console.log(JSON.stringify({ ready: true, documentId: selected.documentId, versionId: selected.versionId, questions }));
  const deadline = Date.now() + (reviewed ? 30 : 15) * 60 * 1000;
  while (!stop && Date.now() < deadline) {
    await release.assertHeld();
    const commandsPath = path.join(out, label + '-commands.jsonl');
    const commands = fs.existsSync(commandsPath) ? fs.readFileSync(commandsPath, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : [];
    for (const command of commands.slice(seenCommands)) {
      if (command.action === 'revoke_admin') await platform((tx: any) => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY[]::text[] where id=${fixture.adminIds[0]}`));
      else if (command.action === 'restore_admin') await platform((tx: any) => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-knowledge'] where id=${fixture.adminIds[0]}`));
      else if (command.action === 'retire_source') {
        assert.ok(!reviewed, 'Keep the reviewed draft available');
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
      assert.deepEqual(context.entry_snapshot.preview.drafts.map((d: any) => d.id).sort(), previewParts.map((p: any) => p.versionId).sort());
      const question = context.content.blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      const cid = String(context.id), alreadySeen = seenCids.has(cid);
      cids.add(cid); seenCids.add(cid);
      if (!retired) {
        const runs = report.runs.filter((r: any) => !r.revoked), turn = runs.length % questions.length;
        assert.ok(runs.length < report.maxNormalRuns); assert.equal(question, questions[turn]);
        if (reviewed) {
          if (turn) assert.equal(cid, runs.at(-1).conversationId); else assert.equal(alreadySeen, false);
          verifyPrevious(runs);
        }
      }
      assert.deepEqual(binding(), report.bindingBefore);
      if (reviewed && !report.runs.length) {
        const retrieved = await retrieveKnowledge(cid, actor, questions[0], Number(before.knowledge_epoch));
        const followup = await retrieveKnowledge(cid, actor, questions[1], Number(before.knowledge_epoch));
        fs.writeFileSync(path.join(out, label + '-retrieval-preflight.json'), JSON.stringify({ opening: retrieved, followup }, null, 2), { flag: 'wx' });
        if (pptCraft) {
          assert.equal(retrieved.diagnostic.externalIndex, undefined);
          assert.ok(retrieved.evidence.some((e: any) => e.ref.version === selected.versionId));
          const followupPage = craftInput.acceptance.questions[1].slide;
          assert.ok(followup.evidence.some((e: any) => previewParts.some((p: any) => p.page === followupPage && p.versionId === e.ref.version)));
          assert.ok([...retrieved.evidence, ...followup.evidence].every((e: any) => previewParts.some((p: any) => p.versionId === e.ref.version)));
        } else if (!reviewCase) {
        assert.ok(retrieved.diagnostic.externalIndex);
        assert.ok(retrieved.evidence.every((e: any) => e.ref.version === selected.versionId));
        assert.ok(retrieved.evidence.some((e: any) => [38, 39].includes(e.file?.extraction?.chunkIndex) && e.text.includes('97m²')));
        const right = retrieved.evidence.filter((e: any) => [40, 42].includes(e.file?.extraction?.chunkIndex));
        assert.deepEqual(new Set(right.map((e: any) => e.file.extraction.chunkIndex)), new Set([40, 42]));
        assert.ok(right.every((e: any) => e.file.extraction.review?.bookPage === '26'
          && e.text.includes('83.98') && e.text.includes('不包含在装修总价内')));
        for (const [name, value] of [['沙发茶几', '3000.00'], ['主卧室床', '2000.00']]) {
          assert.ok(followup.evidence.some((e: any) => e.ref.version === selected.versionId && e.file?.extraction?.chunkIndex === 42
            && e.text.includes(name) && e.text.includes(value)), name);
        }
        } else {
          assert.ok(retrieved.diagnostic.externalIndex);
          assert.ok(retrieved.evidence.length && followup.evidence.length);
          assert.ok([...retrieved.evidence, ...followup.evidence].every((e: any) => previewParts.some((p: any) => p.versionId === e.ref.version)
            && e.file?.extraction?.review?.bookPage));
        }
        const probe = retrieved.evidence.find((e: any) => e.ref.version === selected.versionId);
        assert.ok(probe);
        await assert.rejects(() => new ConversationService({ ...actor, principal: { kind: 'admin', adminId: fixture.adminIds[1] } }).detail(cid), /assistant_resource_not_found/);
        await assert.rejects(() => new ConversationService({ ...actor, enterpriseId: '2385' }).detail(cid));
        await assert.rejects(() => new ConversationService({ ...actor, principal: { kind: 'user', userId: '1' }, capabilities: ['assistant.chat.self'] }).detail(cid));
        // Probe the actual source guards against the reviewed version in a
        // rolled-back isolated transaction. Keep the retained draft indexed.
        const rollback = new Error('rollback source-revision probe');
        await assert.rejects(() => tenant(async (tx: any) => {
          const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`);
          assert.ok(await resolveEvidence(tx, actor, c, probe));
          await tx.execute(sql`update app.assistant_knowledge_versions set edit_version=edit_version+1
            where enterprise_id=${eid} and id=${selected.versionId} and published_at is null`);
          await assert.rejects(() => validatePreviewSnapshot(tx, actor, c), /context_changed/);
          assert.equal(await resolveEvidence(tx, actor, c, probe), undefined);
          throw rollback;
        }), error => error === rollback);
        report.guards = { otherOwnerDenied: true, crossTenantDenied: true, customerPrincipalDenied: true, reviewedRevisionRollbackDenial: true };
        save();
      }
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
      else {
        assert.equal(trace.run.status, 'succeeded', String(trace.run.error_code));
        if (pptCraft) {
          const modelSteps = trace.steps.filter((step: any) => step.kind === 'model');
          const answer = trace.steps.find((step: any) => step.kind === 'answer');
          assert.equal(modelSteps.length, 1);
          assert.equal(afterCount.n - beforeCount.n, 1);
          assert.ok(modelSteps[0].provider_attempt_id);
          assert.equal(answer?.provider_attempt_id, modelSteps[0].provider_attempt_id);
        } else if (reviewed) {
          assert.equal(trace.steps.find((s: any) => s.kind === 'agent_checkpoint')?.private_checkpoint?.validationRepairs, 0,
            'Keep first-draft outcomes separate from repairs');
        }
      }
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
  verifyPrevious(report.runs);
  assert.equal(report.runs.filter((r: any) => !r.revoked).length, report.maxNormalRuns);
  assert.equal(report.runs.filter((r: any) => r.revoked).length, reviewed ? 0 : 1);
  report.status = 'passed'; report.bindingAfter = binding();
  assert.deepEqual(report.bindingAfter, report.bindingBefore);
} catch (error) { report.status = 'failed'; report.error = (error as Error).stack; process.exitCode = 1; }
finally {
  const errors: string[] = [], clean = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { errors.push(String(error)); } };
  if (accountBefore) await clean(() => platform((tx: any) => tx.execute(sql`update app.admin_users
    set password_hash=${accountBefore.password_hash},menu_permissions=array(select jsonb_array_elements_text(${JSON.stringify(accountBefore.menu_permissions)}::jsonb))
    where enterprise_id=${eid} and id=${fixture.adminIds[0]}`)));
  else if (!reviewed) await clean(() => platform((tx: any) => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-knowledge'] where id=${fixture.adminIds[0]}`)));
  for (const cid of cids) await clean(async () => { await tenant((tx: any) => cancelRuns(tx, actor, cid)); const c = await service.detail(cid); if (c.status === 'open') await service.archive(cid, c.version, randomUUID()); });
  if (before) await clean(() => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${before.enabled},agent_config=${JSON.stringify(before.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`)));
  if (platformBefore) await clean(() => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  report.cleanup = { restored: !errors.length, errors }; save(); await release?.(); await closePostgresPool(); console.log(JSON.stringify({ status: report.status, error: report.error, cleanup: report.cleanup }));
}
