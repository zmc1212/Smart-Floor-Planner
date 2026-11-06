/* eslint-disable @typescript-eslint/no-explicit-any -- Offline replay records original service snapshots. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import nextEnv from '@next/env';
import ts from 'typescript';
import { sql } from 'drizzle-orm';
import { lockAssistantAcceptance } from '../assistant-acceptance-safety.mjs';
import type { Row } from '../../src/db/repositories/assistant-repository';
import type { ActorContext } from '../../src/lib/assistant/contracts';
import type { ModelTurnOutput, ModelMessage } from '../../src/lib/assistant/contracts/model';

// Match the Worker's CommonJS graph, including its runtime singleton and pool.
const require = createRequire(import.meta.url);
const { withPlatformTransaction, withTenantTransaction } = require('../../src/db/transaction.ts');
const { one, rows } = require('../../src/db/repositories/assistant-repository.ts');
const { closePostgresPool } = require('../../src/lib/postgresql.ts');
const { ConversationService, cancelRuns, appendMessage } = require('../../src/lib/assistant/core/conversation.ts');
const { claimJob } = require('../../src/lib/assistant/infrastructure/job-queue.ts');
const { processAgentAnswer, finalTool } = require('../../src/lib/assistant/agent/worker.ts');
const { fastGPTWorkflows, closeFastGPTWorkflows } = require('../../src/lib/assistant/fastgpt/runtime.ts');
const { minimalDialogueProtocol } = require('../../src/lib/assistant/agent/minimal-dialogue.ts');
const { sourceCitationCatalog } = require('../../src/lib/assistant/agent/citation-catalog.ts');
const { webEvidence, webSynthesisSources } = require('../../src/lib/assistant/agent/web-evidence.ts');
const { nativeFinalDefinition } = require('../../src/lib/assistant/agent/native-final.ts');
const { businessToolDefinitions } = require('../../src/lib/assistant/agent/business-tools.ts');
const { historyTool } = require('../../src/lib/assistant/agent/history.ts');
const { webSearchTool } = require('../../src/lib/assistant/agent/web.ts');
const { publicResearchTools } = require('../../src/lib/assistant/agent/public-research.ts');
const { safeText } = require('../../src/lib/assistant/contracts/index.ts');

// This driver cannot contact a model or the remote platform. The existing model
// port supplies retained provider outputs; all domain writes/readback are real.
nextEnv.loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
const database = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname));
assert.equal(database.port, '55432'); assert.equal(database.pathname, '/xiaok_embedding_eval');
const output = path.resolve(process.argv.find(a => a.startsWith('--out='))?.slice(6)
  || path.join(root, 'tmp/fastgpt-native-qa-20261106/interface-calibration/service01'));
assert.ok(output.startsWith(path.join(root, 'tmp') + path.sep));
assert.ok(!fs.existsSync(output), 'Never overwrite an earlier replay result');
fs.mkdirSync(output, { recursive: true });
const fixturePath = path.join(process.cwd(), 'scripts/fastgpt/fixtures/native-knowledge-saved-io.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
assert.ok(selectedCase === undefined || ['empty-search', 'web-citation', 'invalid-history-id'].includes(selectedCase));
const prefix = 'synthetic-native-interface-' + randomUUID();
const config = { baseUrl: 'http://127.0.0.1:18300', apiKey: 'offline-replay-no-provider-credential',
  knowledgeAppId: '000000000000000000000001', stageAppId: '000000000000000000000002',
  nativeKnowledgeAppId: '000000000000000000000003', nativeTransportModel: 'offline-retained-native-io',
  nativeBridgeKey: randomUUID() + randomUUID(), auditFile: path.join(output, 'transport.jsonl') };
const runtimeFile = path.join(output, 'runtime.json'); fs.writeFileSync(runtimeFile, JSON.stringify(config));
const originalEnvironment = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = runtimeFile;
const tenant = (fn: any): Promise<any> => withTenantTransaction(eid, fn);
const platform = (fn: any): Promise<any> => withPlatformTransaction(fn);
const report: any = { status: 'running', kind: 'saved-I/O engineering replay', semanticAcceptance: false,
  newModelCalls: 0, externalRequests: [], enterpriseId: eid, target: '55432/xiaok_embedding_eval', prefix,
  cases: [], citationRebindings: [], originalFailuresUnchanged: false };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const users: string[] = [], conversations: string[] = [];
const actor = (user = users[0]): ActorContext => ({ enterpriseId: eid, principal: { kind: 'user', userId: user },
  contextVersion: 1, capabilities: ['assistant.chat.self'] });
const counts = () => platform(async (tx: any) => ({
  attempts: Number((await one(tx, sql`select count(*)::int n from app.ai_provider_attempts`))!.n),
  active: Number((await one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`))!.n),
  pending: Number((await one(tx, sql`select count(*)::int n from app.construction_report_deliveries where state in ('pending','held')`))!.n),
}));
const originals = () => tenant((tx: any) => rows(tx, sql`select id::text,status,error_code,output_message_id::text
  from app.assistant_runs where enterprise_id=1454 and id in (10907,10915,10919) order by id`));
const sourceFiles = new Set<string>();
const cfg = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(cfg.config, ts.sys, process.cwd()).options;
function visit(file: string) {
  if (sourceFiles.has(file) || file.includes('node_modules') || !fs.existsSync(file)) return;
  sourceFiles.add(file);
  for (const imported of ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true).importedFiles) {
    const resolved = ts.resolveModuleName(imported.fileName, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (resolved) visit(path.resolve(resolved));
  }
}
visit(fileURLToPath(import.meta.url));
for (const file of ['src/lib/assistant/agent/worker.ts', 'src/lib/assistant/core/conversation.ts',
  'src/lib/assistant/fastgpt/runtime.ts']) visit(path.resolve(file));
for (const file of [fixturePath, runtimeFile, 'package.json', 'package-lock.json', 'tsconfig.json',
  'scripts/assistant-acceptance-safety.mjs', 'src/lib/assistant/__tests__/fastgpt-native-knowledge.test.ts']) sourceFiles.add(path.resolve(file));
const binding = () => Object.fromEntries([...sourceFiles].sort().map(file => [path.relative(root, file).replaceAll('\\', '/'),
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
let release: any, settings: Row | undefined, active: any, lastCallback: (() => Promise<Response>) | undefined;
const previousFetch = globalThis.fetch;
const wire = (route: string, token: string, payload?: unknown) => new Request('http://localhost' + route, {
  method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});
const definitions = [historyTool, ...businessToolDefinitions.filter((t: any) => t.name === 'query_business'),
  ...publicResearchTools([webSearchTool], true, true), nativeFinalDefinition(finalTool, { quantityValidation: 'application', taggedFields: true })];

try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL);
  report.before = await counts(); assert.equal(report.before.active, 0); assert.equal(report.before.pending, 0);
  report.originalsBefore = await originals(); report.bindingBefore = binding(); save();
  settings = await tenant((tx: any) => one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=1454`));
  assert.ok(settings); assert.equal(settings.enabled, false, 'Do not replace an active development owner');
  await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,
    agent_config=${JSON.stringify({ ...(settings!.agent_config as Row), runtime: 'langgraph-v1', providerKey: 'dashscope',
      model: 'deepseek-v4.1-flash-1017', tools: true, imageInput: false, enterpriseKnowledgeEnabled: false,
      probeVersion: minimalDialogueProtocol })}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  await platform(async (tx: any) => {
    for (let i = 0; i < 2; i++) {
      const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + ':' + i},1) returning id`))!.id);
      users.push(uid);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix + ':openid:' + i})`);
    }
  });
  const runtime = fastGPTWorkflows()!;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== config.baseUrl + '/api/v1/chat/completions') {
      report.externalRequests.push(String(url)); throw Error('Offline replay forbids every external/model request');
    }
    assert.ok(active);
    const packet = JSON.parse(String(init?.body)); assert.equal(packet.chatId, undefined);
    const id = packet.variables.workflowTicket;
    const loaded = await runtime.handle(wire('/native-input', id)); assert.equal(loaded.status, 200);
    const input = await loaded.json();
    const messages: any[] = [{ role: 'system', content: input.instructions }, { role: 'user', content: input.input }];
    for (let turn = 0; turn < active.turns.length; turn++) {
      const response = await runtime.handle(wire('/native-model/v1/chat/completions', config.nativeBridgeKey, {
        model: config.nativeTransportModel, messages, tools: definitions.map(tool => ({ type: 'function', function: {
          name: tool.name, description: tool.description, parameters: { type: 'object', properties: { payload: tool.parameters }, required: ['payload'] },
        } })),
      }));
      if (response.status !== 200) { report.transportFailure = { turn, status: response.status, body: await response.clone().json() }; save(); }
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const model = await response.json();
      const reply = model.choices[0].message; messages.push(reply);
      for (const call of reply.tool_calls || []) {
        const callback = () => runtime.handle(wire('/native-tool/' + call.function.name, id, JSON.parse(call.function.arguments).payload));
        const responses = await Promise.all([callback(), callback()]);
        assert.equal(responses[0].status, responses[1].status);
        const result = await responses[0].json();
        assert.deepEqual(result, await responses[1].json(), 'Concurrent repeats reuse one exact receipt');
        active.callbacks.push({ turn, name: call.function.name, status: responses[0].status, ...(result.error ? { error: result.error } : {}) });
        if (call.function.name === 'final_response') {
          lastCallback = callback;
          if (active.reject) { report.rejectedCallback = { status: responses[0].status, result }; save(); return Response.json({ error: result.error || 'retained_invalid_citation' }); }
          assert.equal(responses[0].status, 200);
        } else {
          assert.equal(responses[0].status, 200);
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
    }
    return Response.json({});
  };

  async function replay(sample: any, kind: 'empty-search' | 'web-citation' | 'invalid-history-id') {
    const service = new ConversationService(actor());
    const created = await service.create(randomUUID()), cid = String(created.id); conversations.push(cid);
    // The invalid-history sample reads newly saved copies of the same customer
    // originals. Its original stale/source IDs must remain rejected, untouched.
    if (kind === 'invalid-history-id') {
      await tenant(async (tx: any) => {
        for (const text of ['卧室墙面摸着掉粉，想重新刷漆，通常先处理什么？', '补充一下，是住人的老房子，不是空房，想尽量少影响生活。'])
          await appendMessage(tx, actor(), cid, { author: 'user', content: { version: 1, blocks: [{ type: 'text', text }] } });
      });
    }
    const clientId = randomUUID(), sent = await service.send(cid, clientId, { version: 1, blocks: [{ type: 'text', text: sample.question }] });
    const rid = String(sent.runId), lease = await claimJob(); assert.equal(lease?.runId, rid);
    const sourceIds = new Map<string, string>(), citationIds = new Map<string, string>();
    if (kind === 'web-citation') for (const entry of sample.snapshots) {
      const oldSources = webSynthesisSources(webEvidence(entry.snapshot, sample.runId, entry.sequence));
      const newSources = webSynthesisSources(webEvidence(entry.snapshot, rid, entry.sequence));
      for (let i = 0; i < oldSources.length; i++) {
        sourceIds.set(oldSources[i].sourceId, newSources[i].sourceId);
        const oldCatalog = sourceCitationCatalog(oldSources[i]), newCatalog = sourceCitationCatalog(newSources[i]);
        oldCatalog.forEach((item: any, index: number) => citationIds.set(item.citationId, newCatalog[index].citationId));
      }
    }
    active = { kind, runId: rid, originalRunId: sample.runId, callbacks: [], modelPortCalls: 0,
      turns: kind === 'web-citation' ? sample.turns : sample.turns.map((turn: any) => turn.output), reject: kind === 'invalid-history-id' };
    const startSources = JSON.stringify(sample);
    const replayOutput = (turn: number): ModelTurnOutput => {
      const original = structuredClone(active.turns[turn]);
      for (const call of original.toolCalls) {
        let payload = JSON.parse(call.arguments);
        if (payload.payload) payload = payload.payload;
        if (kind === 'web-citation') {
          let encoded = JSON.stringify(payload).replaceAll('P' + sample.runId + ':', 'P' + rid + ':');
          for (const [oldId, newId] of citationIds) encoded = encoded.replaceAll(oldId, newId);
          payload = JSON.parse(encoded);
        }
        call.arguments = JSON.stringify({ payload });
      }
      // Retained usage is historical evidence, never new observed provider use.
      return { ...original, usage: null, providerRequestId: null };
    };
    let searches = 0, reads = 0;
    await processAgentAnswer(lease!, {
      model: async (_messages: ModelMessage[], _tools: unknown, turn: number) => {
        active.modelPortCalls++; assert.equal(turn, active.modelPortCalls - 1);
        return replayOutput(turn);
      },
      webSearch: async (query: any) => {
        searches++;
        const original = structuredClone(kind === 'web-citation' ? sample.snapshots[0].snapshot : sample.searchSnapshots[searches - 1]);
        original.query = query;
        original.candidates = (original.candidates || []).map((candidate: any) => ({ ...candidate,
          id: candidate.id.replace('P' + sample.runId + ':', 'P' + rid + ':') }));
        return original;
      },
      webRead: async (query: any, _candidate: any, _previous: any, sequence: number) => {
        reads++;
        const original = structuredClone(sample.snapshots.find((entry: any) => entry.sequence === sequence).snapshot);
        original.query = query;
        original.candidates = (original.candidates || []).map((candidate: any) => ({ ...candidate,
          id: candidate.id.replace('P' + sample.runId + ':', 'P' + rid + ':') }));
        return original;
      },
    });
    assert.equal(JSON.stringify(sample), startSources, 'Original fixture is immutable');
    const trace = await tenant(async (tx: any) => ({
      run: await one(tx, sql`select id::text,status,error_code,output_message_id::text from app.assistant_runs where enterprise_id=1454 and id=${rid}`),
      steps: await rows(tx, sql`select step_seq,kind,capability_name,status,input_summary,private_checkpoint,provider_attempt_id::text
        from app.assistant_run_steps where enterprise_id=1454 and run_id=${rid} order by step_seq`),
    }));
    fs.writeFileSync(path.join(output, 'run-' + rid + '.json'), JSON.stringify(trace, null, 2));
    const detail = await service.messages(cid), answers = detail.items.filter((item: any) => item.authorKind === 'assistant');
    const models = trace.steps.filter((step: any) => step.kind === 'agent_model');
    assert.equal(models.length, active.turns.length);
    assert.ok(models.every((step: any) => step.input_summary.nativeProtocol === 'fastgpt-native-knowledge-v1'
      && step.input_summary.modelPort === 'injected' && !step.provider_attempt_id));
    if (active.reject) {
      assert.equal(trace.run?.status, 'failed'); assert.equal(trace.run?.error_code, 'invalid_model_citation');
      assert.equal(answers.length, 0);
    } else {
      assert.equal(trace.run?.status, 'succeeded', trace.run?.error_code); assert.equal(answers.length, 1);
      const message = answers[0];
      if (kind === 'empty-search') {
        const original = JSON.parse(sample.turns.at(-1).output.toolCalls[0].arguments).payload;
        assert.equal(safeText(message.content as Parameters<typeof safeText>[0]), original.text); assert.equal(message.citations.length, 0);
        assert.equal(trace.steps.filter((s: any) => ['web.search.v1','web.read.v1'].includes(s.capability_name)).flatMap((s: any) => s.private_checkpoint.pages).length, 0);
      } else {
        assert.ok(message.citations.length >= 2, 'Real retained webpage references survive storage');
        for (const citation of message.citations) {
          const opened: any = await service.citation(String(citation.id), false, cid);
          assert.equal(opened.available, true); assert.ok(opened.quote); assert.ok(opened.sourceUrl);
          await assert.rejects(() => new ConversationService(actor(users[1])).citation(String(citation.id), false, cid));
          await assert.rejects(() => new ConversationService({ ...actor(), enterpriseId: '2385' }).citation(String(citation.id), false, cid));
        }
        active.citationCount = message.citations.length;
        const stored = await tenant((tx: any) => one(tx, sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=1454 and run_id=${rid} and step_seq=1210`));
        await tenant((tx: any) => tx.execute(sql`update app.assistant_run_steps set private_checkpoint=jsonb_set(private_checkpoint,'{pages,0,text}','"revoked synthetic source"'::jsonb)
          where enterprise_id=1454 and run_id=${rid} and step_seq=1210`));
        try {
          const revoked = await service.citation(String(message.citations[0].id), false, cid);
          assert.equal(revoked.available, false, 'Changed original invalidates its saved citation');
        } finally {
          await tenant((tx: any) => tx.execute(sql`update app.assistant_run_steps set private_checkpoint=${JSON.stringify(stored!.private_checkpoint)}::jsonb
            where enterprise_id=1454 and run_id=${rid} and step_seq=1210`));
        }
        report.citationRebindings.push({ originalRunId: sample.runId, replayRunId: rid, sourceIds: [...sourceIds], citationIds: [...citationIds],
          purpose: 'Only run-scoped transport IDs change; source originals and prose stay intact. This is not a new first draft.' });
      }
      assert.equal(String((await service.send(cid, clientId, { version: 1, blocks: [{ type: 'text', text: sample.question }] })).runId), rid);
      assert.equal((await service.messages(cid)).items.filter((item: any) => item.authorKind === 'assistant').length, 1);
      assert.equal(String((await service.detail(cid)).id), cid);
      active.messageId = String(message.id);
    }
    await assert.rejects(() => new ConversationService(actor(users[1])).detail(cid));
    await assert.rejects(() => new ConversationService({ ...actor(), enterpriseId: '2385' }).detail(cid));
    assert.equal((await lastCallback!()).status, 404, 'Expired workflow tickets cannot submit again');
    active.searches = searches; active.reads = reads; active.status = trace.run?.status;
    report.cases.push(active); active = undefined; save();
  }

  if (!selectedCase || selectedCase === 'empty-search') await replay(fixture.cases.find((item: any) => item.runId === '10919'), 'empty-search');
  if (!selectedCase || selectedCase === 'web-citation') await replay(fixture.webCitationCase, 'web-citation');
  if (!selectedCase || selectedCase === 'invalid-history-id') await replay(fixture.cases.find((item: any) => item.runId === '10915'), 'invalid-history-id');
  report.originalsAfter = await originals(); assert.deepEqual(report.originalsAfter, report.originalsBefore);
  report.originalFailuresUnchanged = true;
  report.after = await counts(); assert.equal(report.after.attempts, report.before.attempts);
  assert.equal(report.externalRequests.length, 0); assert.equal(report.after.active, 0);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = (error as Error).stack || String(error); process.exitCode = 1;
} finally {
  globalThis.fetch = previousFetch;
  const errors: string[] = [];
  const clean = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { errors.push(String(error)); } };
  for (const cid of conversations) await clean(async () => {
    await tenant((tx: any) => cancelRuns(tx, actor(), cid));
    const service = new ConversationService(actor()), detail = await service.detail(cid);
    if (detail.status === 'open') await service.archive(cid, Number(detail.version), randomUUID());
  });
  if (settings) await clean(() => tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${settings!.enabled},
    agent_config=${JSON.stringify(settings!.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  for (const uid of users) await clean(() => platform((tx: any) => tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`)));
  await clean(closeFastGPTWorkflows);
  if (originalEnvironment === undefined) delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  else process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = originalEnvironment;
  if (release) {
    await clean(async () => { report.finalCounts = await counts(); assert.equal(report.finalCounts.active, 0); assert.equal(report.finalCounts.pending, 0); assert.equal(report.finalCounts.attempts, report.before.attempts); });
    await clean(async () => { report.bindingAfter = binding(); report.drift = Object.keys(report.bindingBefore).filter(file => report.bindingBefore[file] !== report.bindingAfter[file]); assert.deepEqual(report.drift, []); });
    await clean(release);
  }
  report.cleanup = { restored: errors.length === 0, archivedConversations: conversations, invalidatedSyntheticUsers: users, errors };
  if (errors.length) { report.status = 'failed'; process.exitCode = 1; }
  save(); await closePostgresPool();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, newModelCalls: 0, error: report.error,
    cleanup: report.cleanup.restored, drift: report.drift, output }));
}
