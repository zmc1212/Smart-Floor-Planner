import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { append, readback, fixture, retire, syntheticKnowledge } from './agent-comparison';
import { ContractServices, contractContext, type Prepared, type Verdict } from './agent-contract-services';
import type { ComparisonContext } from './agent-comparison-services';

// Keep original provider/framework payloads, including first drafts and failures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const root = path.resolve(process.cwd(), '..'), source = path.join(root, 'scripts/agent-comparison');
const directory = path.join(root, 'tmp/agent-contract'), mode = process.argv[2];
const protocol = JSON.parse(fs.readFileSync(path.join(source, 'contract.json'), 'utf8'));
const scope = JSON.parse(fs.readFileSync(path.join(source, 'contract-scope.json'), 'utf8'));
const scenarios = JSON.parse(fs.readFileSync(path.join(source, 'scenarios.json'), 'utf8'));
const python = process.env.SFP_PYDANTIC_PYTHON || path.join(root, 'tmp/agent-diagnosis-venv/Scripts/python.exe');
const pilot = path.join(root, 'tmp/anythingllm-pilot'), origin = 'http://127.0.0.1:18093';
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const tokens = (calls: Row[]) => calls.reduce((n, c) => n + (c.usage?.total_tokens ?? c.reservedTokens), 0);
const verdictSchema = { type: 'object', additionalProperties: false, properties: {
  authorized: { type: 'boolean' }, changesFaithful: { type: 'boolean' }, answerTruthful: { type: 'boolean' }, questionAnswered: { type: 'boolean' },
  problems: { type: 'array', items: { type: 'string' }, maxItems: 6 },
}, required: ['authorized', 'changesFaithful', 'answerTruthful', 'questionAnswered', 'problems'] };
const accepted: Verdict = { authorized: true, changesFaithful: true, answerTruthful: true, questionAnswered: true, problems: [] };

function binding() {
  const files = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z',
    'admin/src/lib/assistant', 'admin/src/db', 'admin/src/lib/postgresql.ts', 'admin/scripts/agent-contract*',
    'admin/scripts/agent-comparison*', 'admin/scripts/assistant-acceptance-safety.mjs', 'scripts/agent-comparison'],
  { cwd: root, windowsHide: true, encoding: 'utf8' }).split('\0').filter(Boolean);
  files.push('tmp/xiaok-intelligent-consult/.env.qwen37', 'tmp/xiaok-vector/connection.private.json',
    'tmp/anythingllm-pilot/instance.env', 'tmp/anythingllm-pilot/instance.private.json', process.execPath, python,
    'miniprogram/packages/assistant/lib/requirements.js', 'miniprogram/packages/assistant/lib/client.js', 'miniprogram/test/assistant-requirements.test.js',
    'miniprogram/packages/assistant/requirements/requirements.js', 'miniprogram/packages/assistant/requirements/requirements.wxml');
  const visit = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name); if (e.isDirectory() && e.name !== '__pycache__') visit(file);
    else if (e.isFile() && /\.(?:py|pyd|dll|json|js|mjs|cjs)$|METADATA$|RECORD$/.test(file)) files.push(file);
  } };
  visit(path.resolve(path.dirname(python), '../Lib/site-packages'));
  visit(path.join(source, 'node_modules/langchain'));
  visit(path.join(source, 'node_modules/@langchain'));
  for (const name of [protocol.tools[0].name, 'sfp-comparison-business', 'sfp-comparison-search']) {
    for (const file of ['plugin.json', 'handler.js']) files.push(`tmp/anythingllm-pilot/storage/plugins/agent-skills/${name}/${file}`);
  }
  return Object.fromEntries([...new Set(files)].sort().filter(f => fs.existsSync(path.resolve(root, f)))
    .map(f => [f, hash(fs.readFileSync(path.resolve(root, f)))]));
}

async function main() {
  assert.notEqual(mode, 'live', 'OS-CONTRACT-05 retires the three-Agent live matrix; use requirement-workflow-acceptance.ts for saved-input LangGraph approval checks');
  assert.ok(['services', 'transport', 'live'].includes(mode), 'Retired online-judge protocol probes are not authorized in this batch');
  assert.equal(scope.semanticEvaluation, 'offline'); fs.mkdirSync(directory, { recursive: true });
  const idle = await withPlatformTransaction(tx => rows(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));
  assert.equal(Number(idle[0].n), 0);
  const previous = (dir: string) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^trial-.*\.json$/.test(f))
    .flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).calls || []) : [];
  const earlier = [...previous(pilot), ...previous(path.join(root, 'tmp/agent-comparison')), ...previous(path.join(root, 'tmp/agent-diagnosis'))];
  const prior = previous(directory); assert.ok([...earlier, ...prior].every(c => c.status === 'succeeded'), 'Resolve any new unknown before dispatch');
  const batch = new Date().toISOString().replace(/[:.]/g, '-'), output = path.join(directory, `trial-${batch}.json`);
  const report: Row = { version: scope.version, mode, started: new Date().toISOString(), scope,
    previousPlanTokens: 518485, previousPlanMicros: 869762, earlierTokens: tokens(earlier), priorContractTokens: tokens(prior),
    protocolHash: hash(JSON.stringify(protocol)), fixtures: [], calls: [], submissions: [], cases: [], checks: {}, transportRequests: [], actualBilledYuan: null };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
  const secret = JSON.parse(fs.readFileSync(path.join(pilot, 'instance.private.json'), 'utf8'));
  const env = Object.fromEntries(fs.readFileSync(path.join(root, 'tmp/xiaok-intelligent-consult/.env.qwen37'), 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#')).map(s => { const n = s.indexOf('='); return [s.slice(0, n).trim(), s.slice(n + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]; }));
  const provider = new URL(env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(provider.origin, 'https://dashscope.aliyuncs.com'); assert.equal(provider.pathname.replace(/\/$/, ''), '/compatible-mode/v1');
  let apiKey = '', server: http.Server | undefined, unknown = false, inFlight = false, haltReason = '';
  type Active = { f: Row; row: Row; context: ComparisonContext; service: ContractServices; key: string; system: string;
    prepared?: Prepared; digest?: string; lastSubmission?: Row; result?: Row; injected?: boolean; transportRejected?: boolean };
  let active: Active | undefined;
  async function api(route: string, body?: Row, auth = apiKey) {
    const response = await fetch(origin + '/api' + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180000), redirect: 'error' });
    assert.ok(response.ok, `AnythingLLM HTTP ${response.status}`); return response.json();
  }
  const systemFor = (a: Active) => protocol.system + '\n' + JSON.stringify(contractContext(a.context, a.f.dialogue));
  const summaryCount = async (f: Row) => Number((await withPlatformTransaction(tx => rows(tx, sql`select count(*)::int n from app.assistant_requirement_summaries where enterprise_id=${f.enterpriseId} and conversation_id=${f.conversationId}`)))[0].n);
  async function providerCall(kind: string, request: Row, attribution = active ? { id: active.row.id, engine: active.f.engine } : undefined) {
    assert.ok(attribution && !unknown && !inFlight && !haltReason); assert.ok(report.calls.length < scope.providerCallLimit);
    const reserve = Buffer.byteLength(JSON.stringify(request), 'utf8') + request.max_tokens, used = tokens(report.calls);
    assert.equal(scope.userApproval.startsWith('PENDING'), false, 'Budget extension not approved');
    assert.ok(Math.max(0, report.priorContractTokens - scope.batchStartsAfterContractTokens) + used + reserve <= scope.newTokenLimit, 'New fixed-batch token cap');
    assert.ok(report.previousPlanTokens + report.earlierTokens + report.priorContractTokens + used + reserve <= scope.cumulativeTokens, 'Cumulative token cap');
    assert.ok(report.previousPlanMicros + (report.earlierTokens + report.priorContractTokens + used + reserve) * 5 <= scope.cumulativeMicros, 'Cumulative cost cap');
    const attempt: Row = { id: randomUUID(), case: attribution.id, engine: attribution.engine, kind, request, reservedTokens: reserve, status: 'dispatching', started: new Date().toISOString() };
    report.calls.push(attempt); inFlight = true; save();
    try {
      const response = await fetch(provider.toString().replace(/\/$/, '') + '/chat/completions', { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(90000) });
      const result = await response.json(); attempt.response = result; attempt.httpStatus = response.status;
      if (!response.ok || !Number.isSafeInteger(result.usage?.total_tokens)) { attempt.status = 'unknown'; unknown = true; throw Error('provider_outcome_unknown'); }
      attempt.status = 'succeeded'; attempt.usage = result.usage; return result;
    } catch (e) { if (attempt.status !== 'succeeded') { attempt.status = 'unknown'; unknown = true; } attempt.error = String((e as Error).message); throw e; }
    finally { inFlight = false; attempt.finished = new Date().toISOString(); save(); }
  }
  async function verify(input: Row): Promise<Verdict> {
    if (mode !== 'live') return accepted;
    const result = await providerCall('semantic_boundary', { model: scenarios.model,
      messages: [{ role: 'system', content: protocol.verifierSystem + '\n' + JSON.stringify({ businessActions: protocol.actions }) }, { role: 'user', content: JSON.stringify({ ...input,
        safeDialogue: contractContext(active!.context, active!.f.dialogue).safeDialogue }) }],
      response_format: { type: 'json_schema', json_schema: { name: 'verify_contract', strict: true, schema: verdictSchema } },
      temperature: 0, stream: false, enable_thinking: false, max_tokens: scope.verifierMaxTokens });
    try {
      assert.notEqual(result.choices?.[0]?.finish_reason, 'length', 'incomplete_validator_output');
      const verdict = JSON.parse(result.choices?.[0]?.message?.content || '');
      assert.ok(['authorized', 'changesFaithful', 'answerTruthful', 'questionAnswered'].every(k => typeof verdict[k] === 'boolean') && Array.isArray(verdict.problems));
      return verdict;
    } catch (e) {
      haltReason = 'boundary_validator_unavailable: ' + String((e as Error).message); report.haltReason = haltReason; save(); throw Error(haltReason);
    }
  }
  async function prepare(args: Row) {
    assert.ok(active && !active.result && !unknown); const a = active;
    const digest = hash(JSON.stringify(args)); if (a.digest === digest && a.prepared) return { ok: true };
    const attempt: Row = { case: a.row.id, args, started: new Date().toISOString(), firstDraft: !report.submissions.some((s: Row) => s.case === a.row.id) };
    report.submissions.push(attempt); save();
    if (mode === 'transport' && a.row.turn === 'validation' && !a.transportRejected) {
      a.transportRejected = true; attempt.rejected = { code: 'local_validation_failure', problems: ['Known rejection; nothing executed. Correct the proposal and retry.'] };
      save(); return { ok: false, terminal: false, ...attempt.rejected };
    }
    const measurement = mode === 'live' && scope.semanticEvaluation === 'offline';
    if (measurement) assert.equal(process.env.SFP_COMPARISON_ISOLATED, '1', 'Measurement seam requires isolated test wrapper');
    const result = await a.service.prepare(a.context, args, measurement ? 'measure_native_proposals' : verify);
    attempt.semanticEvaluation = measurement ? 'unverified_offline_review_required' : 'online_experiment';
    attempt.verdict = result.verdict;
    if (!result.ok) { attempt.rejected = result; save(); return result; }
    a.prepared = result.prepared; a.digest = digest; a.lastSubmission = args; attempt.validated = true; save(); return { ok: true };
  }
  async function execute(args: Row): Promise<Row> {
    assert.ok(active && !unknown); const a = active;
    if (a.result) return a.result;
    const checked = await prepare(args); if (!checked.ok) return checked;
    assert.ok(a.prepared);
    if (((mode === 'live' && a.f.trial === scope.knownFailureInjection.trial && a.row.turn === scope.knownFailureInjection.turn)
      || (mode === 'transport' && a.row.turn === 'stale')) && !a.injected) {
      a.injected = true; await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_conversations set version=version+1 where enterprise_id=${a.f.enterpriseId} and id=${a.f.conversationId}`));
      a.row.injectedVersionConflict = true;
    }
    try {
      const result = await a.service.execute(a.prepared, a.key, args); a.result = result; a.row.receipt = result.receipt; a.row.validatedAnswer = args.answer;
      a.context = result.resultingContext; return result;
    } catch (e) {
      const error = String((e as Error).message);
      if (['context_changed', 'requirement_target_changed'].includes(error)) {
        a.context = await a.service.context(); a.system = systemFor(a); a.prepared = undefined; a.digest = undefined;
        const result = { ok: false, terminal: false, code: error, problems: ['Known stale-context rejection; nothing executed. References refreshed. Resubmit the current request.'] };
        a.row.recovery = [...(a.row.recovery || []), result]; save(); return result;
      }
      a.row.unknownWrite = error;
      haltReason = 'unknown_write_outcome'; report.haltReason = haltReason;
      a.result = { ok: false, terminal: true, outcome: 'unknown', text: '本次办理结果暂时无法核实，请查询当前状态，不能确认已办好或自动重放。' }; save(); return a.result;
    }
  }
  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body, (_, v) => typeof v === 'bigint' ? String(v) : v)); };
    try {
      if (req.headers.authorization !== `Bearer ${secret.bridgeKey}`) return send(401, { error: 'unauthorized' });
      if (req.url === '/v1/models') return send(200, { object: 'list', data: [{ id: scenarios.model, object: 'model' }] });
      assert.ok(active && !unknown); const a = active;
      const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; assert.ok(bytes < 512000); chunks.push(Buffer.from(chunk)); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/contract/prepare') return send(200, await prepare(body.args));
      if (req.url === '/contract/execute') {
        if (a.f.engine === 'anythingllm') assert.equal(body.workspaceId, a.f.workspaceId);
        const result = await execute(body.args); const { resultingContext: ignored, ...publicResult } = result; void ignored;
        return send(200, { ...publicResult, workspaceId: body.workspaceId });
      }
      assert.equal(req.url, '/v1/chat/completions'); assert.equal(body.model, scenarios.model); assert.ok(!a.result);
      await a.service.base.fresh(a.context);
      const getText = (m: Row) => typeof m.content === 'string' ? m.content : (m.content || []).map((p: Row) => p.text || '').join('');
      const start = body.messages.findLastIndex((m: Row) => m.role === 'user' && getText(m) === a.row.prompt); assert.ok(start >= 0);
      const request = { model: scenarios.model, messages: [{ role: 'system', content: a.system }, ...body.messages.slice(start)],
        tools: protocol.tools.map((d: Row) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } })),
        tool_choice: scope.candidateToolChoice, parallel_tool_calls: false, temperature: 0.2, stream: false, enable_thinking: false, max_tokens: 2048 };
      if (mode === 'transport') {
        report.transportRequests.push({ case: a.row.id, native: body, canonical: request }); save();
        return send(200, { id: 'local-native-recovery-' + report.transportRequests.length, object: 'chat.completion', created: 1, model: scenarios.model,
          choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + report.transportRequests.length,
            type: 'function', function: { name: protocol.tools[0].name, arguments: JSON.stringify({ action: 'none', changes: [], answer: '本地传输与恢复检查完成。', evidenceIds: [] }) } }] }, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      }
      assert.ok(report.calls.filter((c: Row) => c.case === a.row.id && c.kind === 'native_agent').length < scope.nativeModelCallsPerTurn, 'Native recovery call cap');
      send(200, await providerCall('native_agent', request));
    } catch (e) { send(409, { error: String((e as Error).message) }); }
  }
  async function pythonRun(config: Row) {
    return new Promise<Row>((resolve, reject) => {
      const child = cp.spawn(python, [path.join(source, 'contract-pydanticai.py')], { cwd: root, windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, stdio: 'pipe' });
      const output: Buffer[] = [], errors: Buffer[] = []; child.stdout.on('data', (b: Buffer) => output.push(b)); child.stderr.on('data', (b: Buffer) => errors.push(b));
      child.once('error', reject); child.once('close', code => {
        if (code) reject(new Error(Buffer.concat(errors).toString('utf8').slice(-1800)));
        else { try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); } catch (e) { reject(e); } }
      }); child.stdin.end(JSON.stringify(config));
    });
  }
  try {
    if (mode === 'protocol') {
      report.bindingBefore = binding();
      const saved = JSON.parse(fs.readFileSync(path.join(directory, 'trial-2026-10-25T02-03-43-940Z.json'), 'utf8'));
      const request = saved.calls.find((c: Row) => c.kind === 'semantic_boundary').request;
      report.protocolInputHash = hash(JSON.stringify(request)); report.protocolOutcomes = []; save();
      for (const trial of [1, 2]) for (const variant of ['forced_tool', 'strict_json']) {
        const input = structuredClone(request);
        if (variant === 'strict_json') {
          delete input.tools; delete input.tool_choice; delete input.parallel_tool_calls;
          input.response_format = { type: 'json_schema', json_schema: { name: 'verify_contract', strict: true, schema: verdictSchema } };
        }
        const result = await providerCall('boundary_protocol', input, { id: `protocol.${trial}.${variant}`, engine: 'shared_boundary' });
        let parsed: Row | undefined, error: string | undefined;
        try { parsed = JSON.parse(variant === 'strict_json' ? result.choices[0].message.content : result.choices[0].message.tool_calls[0].function.arguments); }
        catch (e) { error = String((e as Error).message); }
        const valid = !!parsed && ['authorized', 'changesFaithful', 'answerTruthful', 'questionAnswered'].every(k => typeof parsed![k] === 'boolean') && Array.isArray(parsed.problems);
        report.protocolOutcomes.push({ trial, variant, finish: result.choices[0].finish_reason, valid, parsed, error }); save();
      }
      return;
    }
    const embedding = await embeddingGateway().embed([syntheticKnowledge], 'document'); report.embedding = { profile: embeddingGateway().profile, usage: embedding.usage };
    if (mode !== 'services') {
      cp.execFileSync(process.execPath, [path.join(source, 'prepare-contract.mjs')], { cwd: root, windowsHide: true, encoding: 'utf8' });
      const auth = await api('/request-token', { password: secret.password }, ''); assert.ok(auth.valid && auth.token);
      const key = await api('/system/generate-api-key', { name: 'sfp-contract-' + batch }, auth.token); apiKey = key.apiKey.secret; report.apiKeyId = key.apiKey.id;
      server = http.createServer((req, res) => { void handle(req, res); });
      await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(3109, '0.0.0.0', resolve); });
    }
    report.bindingBefore = binding(); save();
    const engines = mode === 'services' ? ['services', 'services'] : mode === 'transport' ? scope.engines : [...scope.engines, ...scope.engines.slice().reverse()];
    for (let i = 0; i < engines.length; i++) {
      const f = await fixture(batch, i, embedding.vectors[0]);
      await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot || '{"requirementReviewMode":true}'::jsonb where enterprise_id=${f.enterpriseId} and id=${f.conversationId}`));
      f.engine = engines[i]; f.trial = mode === 'live' ? Math.floor(i / 3) + 1 : 1; f.dialogue = [];
      report.fixtures.push(f); save();
      if (f.engine === 'anythingllm') {
        const workspace = (await api('/v1/workspace/new', { name: `契约-${batch}-${i}`, openAiPrompt: protocol.system, openAiTemp: 0.2,
          openAiHistory: 20, chatProvider: 'generic-openai', chatModel: scenarios.model, agentProvider: 'generic-openai', agentModel: scenarios.model })).workspace;
        f.workspaceId = workspace.id; f.workspaceSlug = workspace.slug;
        f.thread = (await api(`/v1/workspace/${f.workspaceSlug}/thread/new`, { name: '新业务契约自然咨询' })).thread;
      }
    }
    const [a, b] = report.fixtures;
    if (b) { await assert.rejects(() => new ContractServices(b.actor, a.conversationId).context()); report.checks.crossTenantDenied = true; }
    if (mode === 'services') {
      const service = new ContractServices(a.actor, a.conversationId), req = service.base.requirements;
      const check = (name: string) => { report.checks[name] = true; save(); };
      await append(a, scenarios.turns[0].text);
      let context = await service.context(); const oldRef = context.knowledge.flatMap(e => e.text.match(/[^。！？\n]+[。！？]?/gu) || []);
      assert.ok(oldRef.length); const evidenceId = contractContext(context).knowledgeSentences[0].id;
      const adds = [{ operation: 'add', field: 'housing', sourceId: `c${context.customerMessages[0].id}.0` },
        { operation: 'add', field: 'budget', sourceId: `c${context.customerMessages[0].id}.1` },
        { operation: 'add', field: 'room', sourceId: `c${context.customerMessages[0].id}.2` },
        { operation: 'add', field: 'room', sourceId: `c${context.customerMessages[0].id}.3` }];
      const propose = async (changes: Row[], key = randomUUID()) => {
        const current = await service.base.context(false);
        return req.propose(a.conversationId, key, { sourceSeq: current.sourceSeq, baseSummaryId: current.requirements.latest?.id || null, changes },
          (repo, c) => service.base.guard(current, repo, c));
      };
      let staged = await propose(adds); assert.equal(staged.kind, 'proposal');
      if (staged.kind !== 'proposal') throw Error('proposal_expected');
      assert.equal(await summaryCount(a), 0); check('proposalDoesNotWriteRequirement');
      let pending: Row = (await new ContractServices(a.actor, a.conversationId).base.requirements.read(a.conversationId)).proposal!;
      assert.equal(pending.id, staged.proposal.id); check('proposalPersistedReentry');
      const decision = (p: Row, restoreConsent = false) => ({ action: 'apply_proposal', proposalId: p.id, digest: p.digest, consent: true, restoreConsent });
      const replayKey = randomUUID(), originalProposal = { sourceSeq: context.sourceSeq, baseSummaryId: null, changes: adds };
      await req.propose(a.conversationId, replayKey, originalProposal);
      const newer = await propose(adds.slice(0, 2)); assert.equal(newer.kind, 'proposal');
      assert.equal((await req.propose(a.conversationId, replayKey, originalProposal)).kind, 'superseded');
      assert.equal((await req.read(a.conversationId)).proposal!.id, newer.kind === 'proposal' ? newer.proposal.id : null); check('proposalKeyReplayCannotResurrectSupersededDiff');
      await assert.rejects(() => req.propose(a.conversationId, replayKey, { ...originalProposal, changes: [] }), /idempotency_conflict/); check('proposalKeyPayloadChangeDenied');
      await propose(adds); pending = (await req.read(a.conversationId)).proposal!;
      const sourceMessage = context.customerMessages[0];
      const originalContent = (await withPlatformTransaction(tx => rows(tx, sql`select content from app.assistant_messages where enterprise_id=${a.enterpriseId} and id=${sourceMessage.id}`)))[0].content;
      await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_messages set content='{"blocks":[{"type":"text","text":"已撤回"}]}'::jsonb where enterprise_id=${a.enterpriseId} and id=${sourceMessage.id}`));
      assert.equal((await req.read(a.conversationId)).proposal, null);
      await assert.rejects(() => req.write(a.conversationId, randomUUID(), decision(pending)), /requirements_stale/); check('sameSequenceRevokedSourceCannotApply');
      await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_messages set content=${JSON.stringify(originalContent)}::jsonb where enterprise_id=${a.enterpriseId} and id=${sourceMessage.id}`));
      assert.throws(() => req.write(a.conversationId, randomUUID(), { ...decision(pending), consent: false }), /invalid_message/); check('noConsentDenied');
      await assert.rejects(() => req.write(a.conversationId, randomUUID(), { ...decision(pending), digest: 'forged' }), /requirement_target_changed/); check('forgedDecisionDenied');
      await assert.rejects(() => new ContractServices(b.actor, a.conversationId).base.requirements.write(a.conversationId, randomUUID(), decision(pending))); check('crossTenantDecisionDenied');
      await append(a, scenarios.turns[1].text);
      await assert.rejects(() => req.write(a.conversationId, randomUUID(), decision(pending)), /requirements_stale/);
      assert.equal((await req.read(a.conversationId)).proposal, null); check('newCustomerMessageInvalidatesProposal');
      await append(a, scenarios.turns[2].text); staged = await propose(adds); assert.equal(staged.kind, 'proposal');
      pending = (await req.read(a.conversationId)).proposal!; const firstKey = randomUUID();
      const [first, concurrent] = await Promise.all([req.write(a.conversationId, firstKey, decision(pending)), req.write(a.conversationId, randomUUID(), decision(pending))]);
      assert.equal(concurrent.id, first.id); assert.equal(first.confirmedFields, null); check('concurrentDifferentKeysCreateOneUnconfirmedDraft');
      assert.equal(first.status, 'draft'); assert.equal(await summaryCount(a), 1); check('confirmedApplyCreatesOneDraftNotFormalConfirmation');
      assert.equal((await req.write(a.conversationId, firstKey, decision(pending))).id, first.id); check('sameKeyReplaySameEntity');
      assert.equal((await req.write(a.conversationId, randomUUID(), decision(pending))).id, first.id);
      assert.equal(await summaryCount(a), 1); check('differentKeySameProposalNoDuplicate');
      await assert.rejects(() => req.write(a.conversationId, firstKey, { ...decision(pending), restoreConsent: true }), /idempotency_conflict/); check('replayPayloadChangeDenied');
      let same = await propose([]); assert.equal(same.kind, 'existing');
      same = await propose(adds); assert.equal(same.kind, 'existing'); assert.equal(await summaryCount(a), 1); check('emptyAndDuplicateAddsReadExistingDraft');
      await append(a, scenarios.turns[3].text); context = await service.base.context(false);
      const items = contractContext(context).savedItems, mixedMessage = context.customerMessages.at(-1)!.id;
      staged = await propose([{ operation: 'replace', targetId: items.find(i => i.field === 'budget')!.id, sourceId: `c${mixedMessage}.0` },
        { operation: 'replace', targetId: items.find(i => i.text.includes('木地板'))!.id, sourceId: `c${mixedMessage}.1` }]);
      assert.equal(await summaryCount(a), 1); pending = (await req.read(a.conversationId)).proposal!;
      assert.equal((await propose([])).kind, 'existing'); assert.equal((await req.read(a.conversationId)).proposal, null); check('existingAcknowledgementClearsEarlierPendingDiff');
      staged = await propose([{ operation: 'replace', targetId: items.find(i => i.field === 'budget')!.id, sourceId: `c${mixedMessage}.0` },
        { operation: 'replace', targetId: items.find(i => i.text.includes('木地板'))!.id, sourceId: `c${mixedMessage}.1` }]);
      pending = (await req.read(a.conversationId)).proposal!;
      const mixed: Row = await req.write(a.conversationId, randomUUID(), decision(pending));
      assert.match(JSON.stringify(mixed.draftFields), /瓷砖/); assert.match(JSON.stringify(mixed.draftFields), /地暖不做/); check('partialChangePreservesSameFieldAndReentry');
      await append(a, scenarios.turns[5].text); context = await service.base.context(false);
      const currentItems = contractContext(context).savedItems, originalMessage = context.customerMessages[0].id;
      staged = await propose([{ operation: 'replace', targetId: currentItems.find(i => i.field === 'budget')!.id, sourceId: `c${originalMessage}.1` },
        { operation: 'replace', targetId: currentItems.find(i => i.text.includes('瓷砖'))!.id, sourceId: `c${originalMessage}.2` }]);
      const wrong: Row = (await req.read(a.conversationId)).proposal!;
      assert.equal(wrong.requiresRestoreConsent, true); assert.equal(wrong.diff.length, 2);
      await assert.rejects(() => req.write(a.conversationId, randomUUID(), decision(wrong)), /requirements_restore_confirmation_required/);
      assert.equal(await summaryCount(a), 2); assert.equal((await req.read(a.conversationId)).latest!.id, mixed.id); check('oldFlooringRestoreCannotWriteWithoutExtraConsent');
      staged = await propose([{ operation: 'replace', targetId: currentItems.find(i => i.field === 'budget')!.id, sourceId: `c${originalMessage}.1` }]);
      pending = (await req.read(a.conversationId)).proposal!; assert.equal(pending.diff.length, 1);
      await assert.rejects(() => req.write(a.conversationId, randomUUID(), decision(wrong, true)), /requirement_target_changed/); check('supersededProposalCannotApply');
      const restored: Row = await req.write(a.conversationId, randomUUID(), decision(pending, true));
      assert.equal(restored.draftFields.room.text, mixed.draftFields.room.text); assert.match(restored.draftFields.budget.text, /12万/); check('acceptedBudgetRestoreKeepsTileAndNegativeHeating');
      await assert.rejects(() => req.write(a.conversationId, randomUUID(), { action: 'draft' }), /requirements_proposal_required/); check('reviewModeRejectsLegacyDirectDraft');
      context = await service.base.context(false);
      const candidate = { action: 'propose_requirements', changes: [], answer: '', evidenceIds: [] };
      const prepared = await service.prepare(context, candidate, 'measure_native_proposals'); assert.ok(prepared.ok);
      await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_conversations set version=version+1 where enterprise_id=${a.enterpriseId} and id=${a.conversationId}`));
      await assert.rejects(() => service.execute(prepared.prepared, randomUUID(), candidate), /context_changed/); check('staleNativeProposalRejectedBeforeExecution');
      context = await service.base.context(false); const retry = await service.prepare(context, candidate, 'measure_native_proposals'); assert.ok(retry.ok);
      const ack = await service.execute(retry.prepared, randomUUID(), candidate); assert.equal(ack.receipt?.effect, 'existing'); assert.equal(await summaryCount(a), 3); check('nativeRecoveryReturnsExistingWithoutWrite');
      const handoffContext = await service.base.context(false), handoffArgs = { action: 'request_designer', changes: [], answer: '', evidenceIds: [] };
      const hp = await service.prepare(handoffContext, handoffArgs, 'measure_native_proposals'); assert.ok(hp.ok);
      const hr = await service.execute(hp.prepared, randomUUID(), handoffArgs); assert.equal(hr.receipt?.entity.status, 'pending');
      assert.equal((await service.base.handoff.customerRead(a.conversationId)).handoff, null); check('modelHandoffProposalDoesNotSubmitReception');
      await retire(a); const revoked = await service.context();
      const reject = await service.prepare(revoked, { action: 'none', changes: [], answer: '', evidenceIds: [evidenceId] }, 'measure_native_proposals');
      assert.equal(reject.ok, false); check('retiredCompanyEvidenceDenied');
      await append(a, '我再看看，晚些时候再确认。');
      const displayed = await req.read(a.conversationId);
      const formal = { action: 'confirm', draftId: restored.id, expectedVersion: restored.version,
        fields: { ...Object.fromEntries(Object.entries(restored.draftFields as Record<string, { text: string }>).map(([k, v]) => [k, v.text])), budget: '客户正式核对为13万' }, consent: true, reviewedSourceSeq: displayed.sourceSeq };
      await assert.rejects(() => req.write(a.conversationId, randomUUID(), { ...formal, reviewedSourceSeq: '0' }), /requirements_stale/); check('staleFormalReviewDenied');
      const formalSaved = await req.write(a.conversationId, randomUUID(), formal);
      assert.equal(formalSaved.id, restored.id); assert.equal(formalSaved.status, 'confirmed'); assert.equal(await summaryCount(a), 3); check('formalReviewAfterRepeatNeedsNoDuplicateDraft');
      const formalContext = contractContext(await service.base.context(false));
      assert.equal(formalContext.savedFields.budget, '客户正式核对为13万');
      assert.equal(formalContext.savedItems.some(i => i.field === 'budget'), false); check('formalCustomerValuesDoNotRevertToExtractedQuotes');
      assert.equal((await propose([])).kind, 'existing');
      await assert.rejects(() => propose(adds), /requirements_customer_edit_conflict/); check('unsupportedFormalEditIsPreservedAndReported');
      return;
    }
    const { runContractCreateAgent } = await import(pathToFileURL(path.join(source, 'contract-langchain.mjs')).href);
    for (const f of report.fixtures) {
      const turns = mode === 'transport' ? ['validation', 'stale'].map(id => ({ id, text: '我想了解一下现在的情况。' }))
        : [...scenarios.turns.slice(0, 3), { ...scenarios.turns[2], id: 'repeat', expect: 'Reentry: return the same existing saved draft, no duplicate, no new business proposal or formal confirmation.' }, ...scenarios.turns.slice(3)];
      for (const turn of turns) {
        assert.ok(!unknown && !haltReason, haltReason);
        if (turn.retireBefore) {
          f.withdrawal = await retire(f);
          if (f.engine === 'anythingllm') f.thread = (await api(`/v1/workspace/${f.workspaceSlug}/thread/new`, { name: '来源撤回后安全接续' })).thread;
        }
        const before = await readback(f), key = await append(f, turn.text), service = new ContractServices(f.actor, f.conversationId), context = await service.context();
        const row: Row = { id: `${f.engine}.${f.trial}.${turn.id}`, engine: f.engine, trial: f.trial, turn: turn.id, prompt: turn.text, expected: turn.expect, before, context,
          summaryCountBefore: await summaryCount(f), started: new Date().toISOString() };
        report.cases.push(row); active = { f, row, context, service, key, system: '' }; active.system = systemFor(active); save();
        try {
          if (f.engine === 'anythingllm') {
            await api(`/v1/workspace/${f.workspaceSlug}/update`, { openAiPrompt: active.system });
            row.result = await api(`/v1/workspace/${f.workspaceSlug}/thread/${f.thread.slug}/chat`, { message: '@agent ' + turn.text, mode: 'chat' });
            row.history = await api(`/v1/workspace/${f.workspaceSlug}/thread/${f.thread.slug}/chats`);
          } else if (f.engine === 'createAgent') row.result = await runContractCreateAgent({ protocol, model: scenarios.model, baseURL: 'http://127.0.0.1:3109/v1', apiKey: secret.bridgeKey,
            system: active.system, text: turn.text, prepare, execute });
          else row.result = await pythonRun({ protocol, model: scenarios.model, baseURL: 'http://127.0.0.1:3109/v1', bridgeURL: 'http://127.0.0.1:3109', apiKey: secret.bridgeKey, system: active.system, text: turn.text });
          row.beforeConfirmation = await readback(f); row.summaryCountBeforeConfirmation = await summaryCount(f);
          // This is a simulated first-party customer decision, never text or an
          // approval token supplied to the model. Wrong diffs are not accepted.
          const receipt = active.result?.receipt;
          if (receipt?.proposal && ['save','mixed','reversal'].includes(turn.id)) {
            const proposal = (await service.base.requirements.read(f.conversationId)).proposal;
            const value = Object.values(proposal?.summary.draftFields || {}).map((v: Row) => v.text).join('；');
            const expected = /90平/.test(value) && /地暖不做/.test(value)
              && (turn.id === 'save' ? /12万/.test(value) && /木地板/.test(value) && !/10万|瓷砖/.test(value)
                : turn.id === 'mixed' ? /10万/.test(value) && /瓷砖/.test(value) && !/12万|木地板/.test(value)
                  : /12万/.test(value) && /瓷砖/.test(value) && !/10万|木地板/.test(value));
            if (proposal && expected) {
              row.clientConfirmation = { proposalId: proposal.id, digest: proposal.digest, restoreConsent: proposal.requiresRestoreConsent, expectedDiffAccepted: true };
              row.confirmedDraft = await service.base.requirements.write(f.conversationId, randomUUID(), { action: 'apply_proposal',
                proposalId: proposal.id, digest: proposal.digest, consent: true, restoreConsent: proposal.requiresRestoreConsent });
            } else row.clientConfirmation = { expectedDiffAccepted: false, reason: 'Proposed values do not match this customer decision. No write.' };
          }
          if (receipt?.effect === 'proposal' && ((turn.id === 'contact' && receipt.action === 'request_designer')
            || (turn.id === 'cancel' && receipt.action === 'cancel_designer'))) {
            row.clientConfirmation = { action: turn.id, contactConsent: false };
            row.confirmedHandoff = await service.base.handoff.customerWrite(f.conversationId, randomUUID(),
              turn.id === 'contact' ? { action: 'request', consent: true, contactConsent: false } : { action: 'cancel' });
          }
          row.after = await readback(f); row.summaryCountAfter = await summaryCount(f); row.finished = new Date().toISOString();
          row.deliveredValidated = !!active.result?.ok && row.result.textResponse === active.result.text;
          if (row.deliveredValidated) f.dialogue.push({ epoch: active.context.epoch, user: turn.text, action: active.lastSubmission?.action,
            answer: active.lastSubmission?.answer, evidenceIds: active.lastSubmission?.evidenceIds || [] });
          if (turn.id === 'mixed') { save(); const stored = JSON.parse(fs.readFileSync(output, 'utf8')).fixtures.find((v: Row) => v.conversationId === f.conversationId); f.dialogue = stored.dialogue;
            row.reentry = await new ContractServices(f.actor, f.conversationId).context(); assert.deepEqual(row.reentry.requirements, row.after.requirements); }
          if (mode === 'transport') { assert.ok(row.deliveredValidated); assert.equal(row.after.requirements.latest, null); assert.equal(report.transportRequests.filter((r: Row) => r.case === row.id).length, 2); }
          console.log(JSON.stringify({ case: row.id, delivered: row.deliveredValidated, submissions: report.submissions.filter((s: Row) => s.case === row.id).length, tokens: tokens(report.calls) }));
          if (haltReason) throw Error(haltReason);
        } catch (e) { row.error = String((e as Error).message); if (unknown || haltReason || /token cap|outcome_unknown/i.test(row.error)) throw e; }
        finally { active = undefined; save(); }
      }
    }
  } catch (e) { report.error = String((e as Error).stack || e).replaceAll(env.DASHSCOPE_API_KEY || 'NO_KEY', '[REDACTED]'); process.exitCode = 1; }
  finally {
    active = undefined;
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    for (const f of report.fixtures) { try { await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);
      await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`);
    }); f.disabled = true; } catch (e) { f.cleanupError = String((e as Error).message); process.exitCode = 1; } }
    report.bindingAfter = binding(); report.bindingStatus = report.bindingBefore ? 'compared' : 'not_established';
    report.drift = report.bindingBefore ? [...new Set([...Object.keys(report.bindingBefore), ...Object.keys(report.bindingAfter)])]
      .filter(f => report.bindingBefore[f] !== report.bindingAfter[f]) : null;
    if (report.drift?.length) process.exitCode = 1;
    if (report.apiKeyId) { try { cp.execFileSync('docker', ['exec', '-w', '/app/server', 'sfp-anythingllm-pilot', 'node', '-e',
      `const {ApiKey}=require('./models/apiKeys');ApiKey.delete({id:${Number(report.apiKeyId)}}).then(ok=>process.exit(ok?0:1)).catch(()=>process.exit(1));`], { windowsHide: true, encoding: 'utf8', timeout: 10000 }); report.apiKeyRevoked = true; } catch { report.apiKeyRevoked = false; process.exitCode = 1; } }
    if (!['services', 'protocol'].includes(mode)) { const file = path.join(pilot, 'storage/plugins/agent-skills', protocol.tools[0].name, 'plugin.json');
      if (fs.existsSync(file)) { const skill = JSON.parse(fs.readFileSync(file, 'utf8')); skill.active = false; fs.writeFileSync(file, JSON.stringify(skill, null, 2)); report.skillDisabled = true; } }
    report.observedTokens = report.calls.reduce((n: number, c: Row) => n + (c.usage?.total_tokens || 0), 0);
    report.unknownCalls = report.calls.filter((c: Row) => c.status !== 'succeeded').length; report.conservativeNewCostMicros = tokens(report.calls) * 5; report.finished = new Date().toISOString(); save();
    console.log(JSON.stringify({ output: path.relative(root, output), cases: report.cases.length, calls: report.calls.length, tokens: report.observedTokens,
      unknown: report.unknownCalls, checks: report.checks, drift: report.drift, error: report.error?.split('\n').slice(0, 2).join(' '), cleaned: report.fixtures.every((f: Row) => f.disabled) }));
  }
}
void main().catch(e => { console.error(String(e.message)); process.exitCode = 1; }).finally(() => closePostgresPool());
