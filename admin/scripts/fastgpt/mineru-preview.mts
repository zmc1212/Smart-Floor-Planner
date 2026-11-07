/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated development receipts and original persisted traces. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(path.resolve('package.json'));
require('@next/env').loadEnvConfig(process.cwd(), true);
const primary = process.env.DATABASE_URL;
const root = path.resolve('..'), eid = '1454';
const baseOut = path.join(root, 'tmp/xiaok-mineru-fastgpt-preview-20261107');
const reviewed = process.argv.includes('--reviewed'), checkOnly = process.argv.includes('--check-only');
const reviewInputArg = process.argv.find(x => x.startsWith('--review-input='))?.slice('--review-input='.length);
const reviewInput = reviewInputArg ? path.resolve(reviewInputArg) : undefined;
if (reviewInput) assert.ok(reviewed && reviewInput.startsWith(path.join(root, 'tmp') + path.sep));
const out = path.resolve(process.argv.find(x => x.startsWith('--out='))?.slice(6) || reviewInput || (reviewed ? path.join(baseOut, 'ocr-review') : baseOut));
assert.ok(out.startsWith(path.join(root, 'tmp') + path.sep));
const preparing = process.argv.includes('--prepare'), live = process.argv.includes('--live'), engineering = process.argv.includes('--engineering');
assert.equal([preparing, live, engineering].filter(Boolean).length, 1, 'Choose --prepare, --engineering or --live');
assert.ok((!reviewed || preparing) && (!checkOnly || reviewed), 'Use --prepare --reviewed [--check-only] for the reviewed draft import');
fs.mkdirSync(out, { recursive: true });
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
process.env.XIAOK_FASTGPT_RETRIEVAL_FILE = path.join(reviewInput ?? (reviewed ? baseOut : out), 'retrieval.private.json');
const target = new URL(process.env.DATABASE_URL!);
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = await imp('src/db/transaction.ts');
const { one, rows } = await imp('src/db/repositories/assistant-repository.ts');
const { KnowledgeService } = await imp('src/lib/assistant/knowledge/service.ts');
const { claimKnowledgeJob, runKnowledgeJob } = await imp('src/lib/assistant/knowledge/index-worker.ts');
const { ConversationService, cancelRuns } = await imp('src/lib/assistant/core/conversation.ts');
const { claimJob } = await imp('src/lib/assistant/infrastructure/job-queue.ts');
const { processAssistantRun } = await imp('src/lib/assistant/application/worker.ts');
const { safeText } = await imp('src/lib/assistant/contracts/index.ts');
const { retrieveKnowledge } = await imp('src/lib/assistant/knowledge/retrieval.ts');
const { validatePreviewSnapshot, resolveEvidence } = await imp('src/lib/assistant/knowledge/sources.ts');
const { readOriginal } = await imp('src/lib/assistant/knowledge/file-service.ts');
const { closePostgresPool } = await imp('src/lib/postgresql.ts');
const { lockAssistantAcceptance } = await imp('scripts/assistant-acceptance-safety.mjs');
const tenant = (fn: any) => withTenantTransaction(eid, fn), platform = (fn: any) => withPlatformTransaction(fn);
const sha = (s: Buffer | string) => createHash('sha256').update(s).digest('hex');
const json = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (name: string, value: unknown) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
const sourceSha256 = 'efcdc6f1e01ec848d0908e99ddd08929a7f0f07b3942f5b539864361f4aa049b';
const corpusFile = reviewInput ? path.join(reviewInput, 'corpus-chunks.json') : path.join(root, 'tmp/mineru-online-test/corpus-chunks.json'), corpus = json(corpusFile);
const config = json(process.env.XIAOK_FASTGPT_RETRIEVAL_FILE);
assert.equal(config.enterpriseId, eid); assert.equal(config.corpusSha256, sha(fs.readFileSync(corpusFile)));
assert.equal(sha(fs.readFileSync(path.join(root, 'docs/装修施工标准手册制度规范/精艺.pdf'))), sourceSha256);
const previous = reviewed ? json(path.join(baseOut, reviewInput ? 'ocr-review/preparation.json' : 'preparation.json')) : null;
const reviewPath = path.join(out, 'reviewed-contexts.json');
const reviewHash = reviewed ? sha(fs.readFileSync(reviewPath)) : undefined;
const reviewInputs = new Map<number, any>(reviewed ? json(reviewPath).map((r: any) => [r.page, r]) : []);
const pageInput = (page: number) => ({ page, sourceSha256, corpusSha256: config.corpusSha256,
  chunks: corpus.filter((x: any) => x.pdf_page === page), ...(reviewed ? { review: reviewInputs.get(page) } : {}) });
if (reviewed) {
  assert.equal(previous.status, 'ready'); assert.equal(previous.enterpriseId, eid);
  assert.equal(previous.sourceSha256, sourceSha256);
  if (!reviewInput) assert.equal(previous.corpusSha256, config.corpusSha256);
  assert.equal(reviewInputs.size, 28);
  const { parseMineruPage } = await imp('src/lib/assistant/knowledge/mineru.ts');
  const { fileContent, filePassages } = await imp('src/lib/assistant/knowledge/source-file.ts');
  const layout = path.join(root, 'tmp/mineru-online-test/result-p1-28/85e6f144-ffa5-4178-9909-abfbeb6a9c46_content_list.json');
  const layoutFiles: string[] = reviewInput ? json(path.join(reviewInput, 'review-layout-paths.json')) : [layout];
  const layoutHashes = new Set(layoutFiles.map(f => {
    assert.ok(path.resolve(f).startsWith(path.join(root, 'tmp') + path.sep)); return sha(fs.readFileSync(f));
  })), pages = [];
  for (let page = 1; page <= 28; page++) {
    const input = pageInput(page), review = input.review;
    assert.ok(review); assert.ok(layoutHashes.has(review.layoutSha256));
    assert.equal(review.pageImageSha256, sha(fs.readFileSync(path.join(reviewInput ? path.join(baseOut, 'ocr-review') : out, 'pages', `page-${String(page).padStart(2, '0')}.png`))));
    const parsed = parseMineruPage(input), legacy = parseMineruPage({ ...input, review: undefined });
    assert.deepEqual(parsed.blocks.map((b: any) => [b.id, b.text, b.cells]), legacy.blocks.map((b: any) => [b.id, b.text, b.cells]));
    const file = { assetId: 'preflight', version: 1, hash: sourceSha256, name: '精艺.pdf', format: 'pdf', parsed, review: null };
    pages.push({ page, tables: review.tables.length, blocks: parsed.blocks.length, chars: fileContent(file).body.length,
      maxPassageChars: Math.max(0, ...filePassages(file).map((p: any) => p.text.length)), warnings: parsed.warnings });
  }
  assert.equal(pages.reduce((n, p) => n + p.tables, 0), 42);
  assert.equal(pages.filter(p => p.blocks).length, reviewInput ? 28 : 24);
  save('parser-preflight.json', { sourceSha256, layoutHashes: [...layoutHashes], reviewHash, corpusSha256: config.corpusSha256, pages, originalBlockTextAndCellsUnchanged: true });
  if (checkOnly) {
    console.log(JSON.stringify({ pages: pages.length, tables: 42, nonempty: pages.filter(p => p.blocks).length, maxPageChars: Math.max(...pages.map(p => p.chars)),
      maxPassageChars: Math.max(...pages.map(p => p.maxPassageChars)) }));
    process.exit(0);
  }
}
const preparationPath = path.join(out, 'preparation.json');
const preparation: any = fs.existsSync(preparationPath) ? json(preparationPath) : {
  prefix: previous?.prefix ?? 'synthetic-mineru-preview-' + randomUUID(), enterpriseId: eid, sourceSha256,
  corpusSha256: config.corpusSha256, parts: [], adminIds: previous?.adminIds ?? [], status: 'preparing', reviewHash,
};
if (reviewed) assert.equal(preparation.reviewHash, reviewHash);
const actor = (adminId = preparation.adminIds[0]): any => ({ enterpriseId: eid, principal: { kind: 'admin', adminId }, contextVersion: 1, capabilities: ['assistant.preview.self'] });
const snapshot = () => tenant((tx: any) => one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`));
const queues = () => platform((tx: any) => one(tx, sql`select count(*)::int active from app.assistant_jobs where status in ('queued','running')`));
const report: any = { status: 'running', scope: 'Microcloud1454 isolated original staff preview; unpublished MinerU drafts, original Agent and Evidence authority; no customer activation',
  model: 'qwen3.7-flash', trials: [], engineering: [], unknowns: [], corpusSha256: config.corpusSha256 };
const reportPath = path.join(out, 'live-report.json');
const engineeringReportName = process.argv.find(x => x.startsWith('--engineering-label='))?.slice(20) || 'engineering-report';
assert.match(engineeringReportName, /^[a-zA-Z0-9-]+$/);
if (live) assert.ok(!fs.existsSync(reportPath), 'Never overwrite or resample a prior live batch');
const conversations: string[] = [];
let before: any, platformBefore: any, release: any;
const restoreErrors: string[] = [];
const bind = () => {
  const ts = require('typescript'), settings = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(settings.config, ts.sys, process.cwd()).options, files = new Set<string>();
  const visit = (f: string) => {
    if (files.has(f) || f.includes('node_modules') || !fs.existsSync(f)) return;
    files.add(f);
    for (const i of ts.preProcessFile(fs.readFileSync(f, 'utf8'), true, true).importedFiles) {
      const resolved = ts.resolveModuleName(i.fileName, f, options, ts.sys).resolvedModule?.resolvedFileName;
      if (resolved) visit(path.resolve(resolved));
    }
  };
  for (const f of ['src/lib/assistant/application/worker.ts', 'src/lib/assistant/knowledge/service.ts', 'src/app/api/assistant/preview/[...path]/route.ts', 'scripts/fastgpt/mineru-preview.mts']) visit(path.resolve(f));
  for (const f of ['package-lock.json', 'package.json', '.env.local']) files.add(path.resolve(f));
  files.add(corpusFile); files.add(process.env.XIAOK_FASTGPT_RETRIEVAL_FILE!);
  return Object.fromEntries([...files].sort().map(f => [path.relative(root, f).replaceAll('\\', '/'), sha(fs.readFileSync(f))]));
};
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  assert.equal((await queues()).active, 0);
  const enterprise = await platform((tx: any) => one(tx, sql`select name from app.enterprises where id=${eid}`));
  assert.match(enterprise.name, /微云/);
  before = await snapshot(); assert.ok(before); assert.equal(before.enabled, false);
  if (preparing) {
    assert.notEqual(preparation.status, 'ready', 'Reuse the retained prepared fixture');
    if (!preparation.adminIds.length) await platform(async (tx: any) => {
      for (let i = 0; i < 2; i++) {
        const a = await one(tx, sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,menu_permissions,must_change_password)
          values(${eid},${preparation.prefix + ':' + i},${'合成测试·MinerU预览·' + i},'unusable-test-account','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`);
        preparation.adminIds.push(String(a.id));
      }
    });
    save('preparation.json', preparation);
    await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,version=version+1 where enterprise_id=${eid}`));
    const service = new KnowledgeService({ enterpriseId: eid, adminId: preparation.adminIds[0] });
    const pages = json(path.join(root, 'tmp/v1-01-weiyun-jingyi/prepared.json'));
    assert.equal(pages.sha256, sourceSha256);
    for (let page = 1; page <= 28; page++) {
      let part = preparation.parts.find((x: any) => x.page === page);
      if (!part) { part = { page, keys: { create: randomUUID(), revise: randomUUID(), import: randomUUID(), review: randomUUID(), index: randomUUID() } }; preparation.parts.push(part); save('preparation.json', preparation); }
      const source = pages.parts.find((p: any) => p.page === page), bytes = fs.readFileSync(source.path);
      assert.equal(sha(bytes), source.sha256);
      if (reviewed && !part.documentId) {
        const retained = previous.parts.find((p: any) => p.page === page);
        assert.equal(retained.assetHash, source.sha256);
        const detail = await service.execute('detail', { documentId: retained.documentId });
        assert.equal(detail.document.category, preparation.prefix);
        assert.equal(detail.document.audience, 'staff_internal');
        assert.equal(detail.document.published_version_id, null);
        if (detail.document.status === 'retired') {
          assert.ok([14, 27].includes(page), 'Only replace the two previously retired test sources');
          part.replacesRetiredDocumentId = retained.documentId;
        } else {
          const draft = await service.execute('newVersion', { documentId: retained.documentId, fromVersionId: retained.versionId,
            expectedVersion: Number(detail.document.version) }, part.keys.revise);
          part.documentId = retained.documentId; part.versionId = String(draft.id); part.assetHash = source.sha256;
          assert.equal(draft.source_file.hash, source.sha256);
          save('preparation.json', preparation);
        }
      }
      if (!part.documentId) {
        const created = await service.execute('createFile', { title: `合成测试·MinerU${reviewed ? '校核' : '候选'}·精艺原PDF第${page}页`,
          category: preparation.prefix, audience: 'staff_internal', fileName: path.basename(source.path), fileBase64: bytes.toString('base64'),
          authorization: `用户2026-11-07授权微云1454隔离员工草稿预览。原精艺.pdf SHA256=${sourceSha256}；原PDF第${page}页图像保留副本。MinerU候选不发布，样板预算不作正式报价。` }, part.keys.create);
        part.documentId = String(created.document.id); part.versionId = String(created.draft.id); part.assetHash = source.sha256;
        save('preparation.json', preparation);
      }
      if (!part.imported) {
        const detail = await service.execute('detail', { documentId: part.documentId });
        const draft = detail.versions.find((x: any) => String(x.id) === part.versionId);
        const imported = await service.execute('importMineru', { documentId: part.documentId, versionId: part.versionId,
          expectedEditVersion: Number(draft.edit_version), assetHash: source.sha256,
          mineru: pageInput(page) }, part.keys.import);
        part.imported = true; part.blocks = imported.source_file.parsed.blocks.length;
        part.parser = imported.source_file.parsed.parser; part.contentHash = imported.content_hash;
        save('preparation.json', preparation);
      }
      // Index only the fixed preview sources, leaving all other pages as drafts.
      if ((reviewInput ? [9, 10, 14, 16, 20, 23].includes(page) : reviewed ? page === 14 : [14, 27].includes(page)) && !part.indexed) {
        let detail = await service.execute('detail', { documentId: part.documentId });
        let draft = detail.versions.find((x: any) => String(x.id) === part.versionId);
        if (!draft.source_file.review) {
          await service.execute('reviewFile', { documentId: part.documentId, versionId: part.versionId,
            expectedEditVersion: Number(draft.edit_version), acknowledgeWarnings: true, excludedBlockIds: [] }, part.keys.review);
          detail = await service.execute('detail', { documentId: part.documentId }); draft = detail.versions.find((x: any) => String(x.id) === part.versionId);
        }
        const indexed = await service.execute('index', { documentId: part.documentId, versionId: part.versionId, expectedEditVersion: Number(draft.edit_version) }, part.keys.index);
        const lease = await claimKnowledgeJob(); assert.ok(lease); assert.equal(lease.jobId, indexed.jobId);
        await runKnowledgeJob(lease);
        const job = await service.execute('job', { jobId: indexed.jobId });
        part.indexJobId = String(indexed.jobId); part.indexStatus = job.status;
        save('preparation.json', preparation); assert.equal(job.status, 'succeeded', String(job.last_error)); part.indexed = true;
      }
      const original = await readOriginal({ enterpriseId: eid, adminId: preparation.adminIds[0] }, part.documentId, part.versionId);
      assert.equal(sha(original.data), source.sha256); part.originalVerified = true;
      save('preparation.json', preparation);
      console.log(JSON.stringify({ page, blocks: part.blocks, indexed: !!part.indexed, originalVerified: true }));
    }
    const published = await tenant((tx: any) => rows(tx, sql`select id from app.assistant_knowledge_versions where enterprise_id=${eid}
      and id in (${sql.join(preparation.parts.map((p: any) => sql`${p.versionId}`), sql`,`)}) and published_at is not null`));
    if (reviewed) assert.equal(sha(fs.readFileSync(reviewPath)), reviewHash);
    assert.equal(published.length, 0); preparation.status = 'ready'; preparation.unpublished = 28; save('preparation.json', preparation);
  } else if (engineering) {
    assert.equal(preparation.status, 'ready');
    await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,version=version+1 where enterprise_id=${eid}`));
    const service = new ConversationService(actor());
    const selected = preparation.parts.find((p: any) => p.page === 14);
    const c = await service.create(randomUUID(), { audience: 'staff_internal', draftVersionIds: [selected.versionId] });
    conversations.push(String(c.id));
    const result = await retrieveKnowledge(String(c.id), actor(), '97平米样板房鞋柜的单价是多少？', Number(before.knowledge_epoch));
    save('retrieval-engineering.json', result);
    assert.ok(result.evidence.some((e: any) => e.text.includes('鞋柜') && e.text.includes('600.00')));
    assert.ok(result.evidence.every((e: any) => e.ref.version === selected.versionId && e.file?.extraction?.provider === 'mineru'));
    assert.ok(result.diagnostic.externalIndex);
    await assert.rejects(() => new ConversationService(actor(preparation.adminIds[1])).detail(String(c.id)));
    await assert.rejects(() => new ConversationService({ ...actor(), enterpriseId: '2385' }).detail(String(c.id)));
    await platform((tx: any) => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY[]::text[] where id=${preparation.adminIds[1]}`));
    await assert.rejects(() => new ConversationService(actor(preparation.adminIds[1])).create(randomUUID(), { audience: 'staff_internal', draftVersionIds: [selected.versionId] }));
    report.engineering.push('authorized_FastGPT_candidates_map_to_current_original_Evidence', 'other_owner_and_tenant_denied', 'manager_permission_revocation_denied');
    const changing = preparation.parts.find((p: any) => p.page === 27), knowledge = new KnowledgeService({ enterpriseId: eid, adminId: preparation.adminIds[0] });
    const current = await knowledge.execute('detail', { documentId: changing.documentId });
    const draft = current.versions.find((v: any) => String(v.id) === changing.versionId);
    const stale = await service.create(randomUUID(), { audience: 'staff_internal', draftVersionIds: [changing.versionId] });
    conversations.push(String(stale.id));
    const sources = await retrieveKnowledge(String(stale.id), actor(), '123平米主材预算瓷砖类的小计是多少？', Number(before.knowledge_epoch));
    assert.ok(sources.evidence.length);
    await knowledge.execute('edit', { documentId: changing.documentId, versionId: changing.versionId, expectedEditVersion: Number(draft.edit_version) }, randomUUID());
    await tenant(async (tx: any) => {
      const original = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${String(stale.id)}`);
      await assert.rejects(() => validatePreviewSnapshot(tx, actor(), original));
      assert.equal(await resolveEvidence(tx, actor(), original, sources.evidence[0]), undefined);
    });
    report.engineering.push('draft_revision_invalidates_preview_and_Evidence'); report.status = 'passed';
    save(engineeringReportName + '.json', report);
  } else {
    assert.equal(preparation.status, 'ready');
    report.fixedTrials = 2;
    report.questions = ['97平米那套样板房，鞋柜的单价是多少？', '那份家具预算也包含在装修总价里吗？'];
    report.fixture = { adminIds: preparation.adminIds, documents: preparation.parts.map((p: any) => ({ page: p.page, documentId: p.documentId, versionId: p.versionId })) };
    platformBefore = await platform((tx: any) => one(tx, sql`select llm_config from app.platform_configs where key='default'`));
    const src = new URL(primary!); assert.equal(src.port, '5432'); assert.equal(src.pathname, '/smart_floor_planner');
    const client = new (require('pg').Client)({ connectionString: primary }); let source: any;
    try { await client.connect(); await client.query('begin read only'); source = (await client.query("select llm_config from app.platform_configs where key='default'")).rows[0].llm_config; await client.query('rollback'); } finally { await client.end(); }
    if (source.providerKey !== 'dashscope') {
      const profile = source.profiles?.dashscope; assert.ok(profile?.apiKeyEncrypted); source = { ...source, ...profile, providerKey: 'dashscope' };
    }
    await platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify({ ...source, model: report.model })}::jsonb where key='default'`));
    const agent = { ...before.agent_config, runtime: 'langgraph-v1', providerKey: 'dashscope', model: report.model, imageInput: false, tools: true,
      enterpriseKnowledgeEnabled: false, knowledgeExplanation: 'natural-knowledge-answer-v1', knowledgeAnswerValidation: 'server-source-boundary-v1' };
    await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify(agent)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`));
    const selected = preparation.parts.find((p: any) => p.page === 14), service = new ConversationService(actor());
    report.bindingBefore = bind(); save('live-report.json', report);
    for (let trial = 1; trial <= 2; trial++) {
      const c = await service.create(randomUUID(), { audience: 'staff_internal', draftVersionIds: [selected.versionId] });
      const cid = String(c.id); conversations.push(cid);
      const journey: any = { trial, conversationId: cid, turns: [] }; report.trials.push(journey);
      await assert.rejects(() => new ConversationService(actor(preparation.adminIds[1])).detail(cid));
      await assert.rejects(() => new ConversationService({ ...actor(), enterpriseId: '2385' }).detail(cid));
      for (const question of report.questions) {
        assert.deepEqual(bind(), report.bindingBefore, 'Source drift before dispatch');
        const key = randomUUID(), sent = await service.send(cid, key, { version: 1, blocks: [{ type: 'text', text: question }] });
        assert.equal((await service.send(cid, key, { version: 1, blocks: [{ type: 'text', text: question }] })).runId, sent.runId);
        const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
        await processAssistantRun(lease);
        const trace = await tenant(async (tx: any) => ({ run: await one(tx, sql`select * from app.assistant_runs where enterprise_id=${eid} and id=${sent.runId}`),
          steps: await rows(tx, sql`select * from app.assistant_run_steps where enterprise_id=${eid} and run_id=${sent.runId} order by step_seq`),
          usage: await rows(tx, sql`select * from app.assistant_usage_records where enterprise_id=${eid} and run_id=${sent.runId}`) }));
        save('run-' + sent.runId + '.json', trace);
        const answer = (await service.messages(cid)).items.find((m: any) => m.id === String(trace.run.output_message_id));
        const item: any = { question, runId: sent.runId, status: trace.run.status, error: trace.run.error_code,
          answer: answer ? safeText(answer.content) : null, citations: answer?.citations || [] };
        journey.turns.push(item); save('live-report.json', report);
        assert.equal(trace.run.status, 'succeeded', String(trace.run.error_code));
        assert.ok(answer?.available); assert.ok(item.citations.length);
        for (const citation of item.citations) {
          const opened = await service.citation(citation.id, false, cid); assert.equal(opened.available, true); assert.equal(opened.isDraft, true);
          assert.equal(opened.sourceFile?.extraction?.provider, 'mineru');
          await assert.rejects(() => new ConversationService(actor(preparation.adminIds[1])).citation(citation.id, false, cid));
        }
        assert.deepEqual((await service.messages(cid)).items.find((m: any) => m.id === answer.id), answer);
        assert.deepEqual(bind(), report.bindingBefore, 'Source drift after dispatch');
        const decision = path.join(out, 'review-' + sent.runId + '.json');
        item.review = { status: 'pending', path: decision }; save('live-report.json', report);
        console.log(JSON.stringify({ reviewRequired: sent.runId, question, answer: item.answer, reviewFile: decision }));
        const until = Date.now() + 180000;
        while (!fs.existsSync(decision) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 500));
        assert.ok(fs.existsSync(decision), 'Stop before next question without first-draft review');
        item.review = json(decision); save('live-report.json', report); assert.equal(item.review.accepted, true, item.review.reason);
      }
    }
    // Revocation uses the existing document service; all original published
    // sources and the other 27 candidates keep their original state.
    const knowledge = new KnowledgeService({ enterpriseId: eid, adminId: preparation.adminIds[0] });
    const detail = await knowledge.execute('detail', { documentId: selected.documentId });
    await knowledge.execute('retire', { documentId: selected.documentId, expectedVersion: Number(detail.document.version) }, randomUUID());
    for (const j of report.trials) {
      const messages = await service.messages(j.conversationId);
      for (const m of messages.items.filter((x: any) => x.authorKind === 'assistant')) assert.equal(m.available, false);
      const attempts = await platform((tx: any) => one(tx, sql`select count(*)::int n from app.ai_provider_attempts`));
      const sent = await service.send(j.conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '这份资料现在还能用吗？' }] });
      const lease = await claimJob();
      // claimJob itself finishes stale-source jobs before returning a lease.
      if (lease) { assert.equal(lease.runId, sent.runId); await processAssistantRun(lease); }
      const revoked = await tenant((tx: any) => one(tx, sql`select * from app.assistant_runs where enterprise_id=${eid} and id=${sent.runId}`));
      assert.equal(revoked.status, 'failed'); assert.equal(revoked.error_code, 'context_changed'); assert.equal(revoked.output_message_id, null);
      assert.equal((await platform((tx: any) => one(tx, sql`select count(*)::int n from app.ai_provider_attempts`))).n, attempts.n);
    }
    report.engineering.push('source_retirement_invalidates_saved_answers_and_reentry');
    report.bindingAfter = bind(); assert.deepEqual(report.bindingAfter, report.bindingBefore);
    report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed'; report.error = (error as Error).stack;
  if (preparing) { preparation.status = 'failed'; preparation.error = report.error; save('preparation.json', preparation); }
  process.exitCode = 1;
} finally {
  const clean = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { restoreErrors.push(String(error)); } };
  for (const cid of conversations) await clean(async () => {
    await tenant((tx: any) => cancelRuns(tx, actor(), cid));
    const service = new ConversationService(actor()), c = await service.detail(cid);
    if (c.status === 'open') await service.archive(cid, c.version, randomUUID());
  });
  if (before) await clean(() => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${before.enabled},agent_config=${JSON.stringify(before.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`)));
  if (platformBefore) await clean(() => platform((tx: any) => tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  if (live) {
    report.cleanup = { restored: !restoreErrors.length, errors: restoreErrors, queues: await queues() };
    save('live-report.json', report);
  }
  if (engineering) {
    await clean(() => platform((tx: any) => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-knowledge'] where id=${preparation.adminIds[1]}`)));
    report.cleanup = { restored: !restoreErrors.length, errors: restoreErrors, queues: await queues() }; save(engineeringReportName + '.json', report);
  }
  if (preparing && reviewed) {
    preparation.cleanup = { restored: !restoreErrors.length, errors: restoreErrors, queues: release ? await queues() : null };
    save('preparation.json', preparation);
  }
  await release?.(); await closePostgresPool();
  console.log(JSON.stringify({ mode: preparing ? 'prepare' : engineering ? 'engineering' : 'live', status: preparing ? preparation.status : report.status,
    parts: preparation.parts.length, trials: report.trials.map((t: any) => t.turns.length), error: report.error, restoreErrors }));
}
