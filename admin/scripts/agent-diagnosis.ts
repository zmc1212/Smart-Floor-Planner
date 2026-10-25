import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { append, readback, fixture, retire, syntheticKnowledge } from './agent-comparison';
import { ComparisonServices, comparisonContextData, type ComparisonContext } from './agent-comparison-services';

// Preserve heterogeneous native SDK/provider payloads, without normalizing failures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const root = path.resolve(process.cwd(), '..'), source = path.join(root, 'scripts/agent-comparison');
const directory = path.join(root, 'tmp/agent-diagnosis'), mode = process.argv[2];
const python = process.env.SFP_PYDANTIC_PYTHON || path.join(root, 'tmp/agent-diagnosis-venv/Scripts/python.exe');
const protocol = JSON.parse(fs.readFileSync(path.join(source, 'protocol.json'), 'utf8'));
const scenarios = JSON.parse(fs.readFileSync(path.join(source, 'scenarios.json'), 'utf8'));
const scope = JSON.parse(fs.readFileSync(path.join(source, 'diagnosis.json'), 'utf8'));
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const tokens = (calls: Row[]) => calls.reduce((n, c) => n + (c.usage?.total_tokens ?? c.reservedTokens), 0);

function splitProtocol() {
  const base = structuredClone(protocol.tools[0]);
  const descriptions: Record<string, string> = {
    save_requirements: '保存或修改待审核的装修需求。', request_designer: '提交设计师接待请求。',
    cancel_designer: '取消设计师接待请求。', read_status: '只读查询已保存的需求与接待状态。',
  };
  return { ...protocol, tools: [...Object.entries(descriptions).map(([action, description]) => {
    const parameters = structuredClone(base.parameters); delete parameters.properties.action;
    return { ...base, name: 'sfp-comparison-' + action, action, description: description + base.description, parameters };
  }), protocol.tools[1]] };
}

function binding() {
  const files = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z',
    'admin/src/lib/assistant', 'admin/src/db', 'admin/src/lib/postgresql.ts', 'admin/scripts/agent-comparison*',
    'admin/scripts/agent-diagnosis*', 'admin/scripts/assistant-acceptance-safety.mjs', 'scripts/agent-comparison'],
  { cwd: root, windowsHide: true, encoding: 'utf8' }).split('\0').filter(Boolean);
  files.push('tmp/xiaok-intelligent-consult/.env.qwen37', 'tmp/xiaok-vector/connection.private.json', python, process.execPath);
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '__pycache__') visit(file);
      else if (entry.isFile() && /\.(?:py|pyd|dll|json)$|METADATA$|RECORD$/.test(file)) files.push(file);
    }
  };
  visit(path.resolve(path.dirname(python), '../Lib/site-packages'));
  return Object.fromEntries([...new Set(files)].sort().filter(f => fs.existsSync(path.resolve(root, f)))
    .map(f => [f, hash(fs.readFileSync(path.resolve(root, f)))]));
}

async function runPython(config: Row) {
  return new Promise<Row>((resolve, reject) => {
    const child = cp.spawn(python, [path.join(source, 'pydanticai.py')], {
      cwd: root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, stdio: 'pipe',
    });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => output.push(b)); child.stderr.on('data', (b: Buffer) => errors.push(b));
    child.once('error', reject);
    child.once('close', code => {
      if (code) reject(new Error('PydanticAI process ' + code + ': ' + Buffer.concat(errors).toString('utf8').slice(-5000).replaceAll(config.apiKey, '[BRIDGE]')));
      else { try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); } catch (e) { reject(e); } }
    });
    child.stdin.end(JSON.stringify(config));
  });
}

async function main() {
  assert.ok(['services', 'transport', 'live'].includes(mode));
  const idle = await withPlatformTransaction(tx => rows(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));
  assert.equal(Number(idle[0].n), 0, 'Isolated queue must be idle');
  fs.mkdirSync(directory, { recursive: true });
  const previous = (dir: string) => fs.readdirSync(dir).filter(f => /^trial-.*\.json$/.test(f))
    .flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).calls || []);
  const pilotCalls = previous(path.join(root, 'tmp/anythingllm-pilot'));
  const comparisonCalls = previous(path.join(root, 'tmp/agent-comparison')), diagnosisCalls = previous(directory);
  const contractDirectory = path.join(root, 'tmp/agent-contract');
  const contractCalls = fs.existsSync(contractDirectory) ? previous(contractDirectory) : [];
  assert.ok([...pilotCalls, ...comparisonCalls, ...diagnosisCalls, ...contractCalls].every(c => c.status === 'succeeded'), 'Unresolved provider outcome blocks new dispatch');
  const batch = new Date().toISOString().replace(/[:.]/g, '-'), output = path.join(directory, `trial-${batch}.json`);
  const report: Row = { version: scope.version, mode, started: new Date().toISOString(), scope,
    upstream: { pydanticai: '2.61.0', source: 'https://github.com/pydantic/pydantic-ai',
      installed: cp.execFileSync(python, ['-m', 'pip', 'freeze', '--all'], { windowsHide: true, encoding: 'utf8' }).trim().split(/\r?\n/) },
    originalProtocolHash: hash(JSON.stringify(protocol)), knowledgeHash: hash(syntheticKnowledge),
    authorization: { previousPlanTokens: 518485, previousPlanMicros: 869762, previousPilotTokens: tokens(pilotCalls),
      previousComparisonTokens: tokens(comparisonCalls), previousDiagnosisTokens: tokens(diagnosisCalls), previousContractTokens: tokens(contractCalls),
      newTokenLimit: scope.newTokenLimit, cumulativeTokenLimit: 1000000, cumulativeMicrosLimit: 5000000 },
    fixtures: [], calls: [], tools: [], cases: [], checks: {}, transportRequests: [], actualBilledYuan: null };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
  const env = Object.fromEntries(fs.readFileSync(path.join(root, 'tmp/xiaok-intelligent-consult/.env.qwen37'), 'utf8')
    .replace(/^\uFEFF/, '').split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#')).map(s => {
      const n = s.indexOf('='); return [s.slice(0, n).trim(), s.slice(n + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
    }));
  const provider = new URL(env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(provider.origin, 'https://dashscope.aliyuncs.com'); assert.equal(provider.pathname.replace(/\/$/, ''), '/compatible-mode/v1');
  const bridgeKey = randomUUID();
  let active: { f: Row; row: Row; key: string; context: ComparisonContext; system: string; protocol: Row; direct: boolean } | undefined;
  let server: http.Server | undefined, unknown = false, inFlight = false;

  async function execute(name: string, args: Row) {
    assert.ok(active && !active.direct);
    const current = active;
    const def = current.protocol.tools.find((d: Row) => d.name === name); assert.ok(def);
    const attempt: Row = { case: current.row.id, name, args, started: new Date().toISOString() };
    report.tools.push(attempt); save();
    try {
      if (def.action) assert.equal(args.action, undefined, 'Split tool cannot override its action');
      const mapped = def.action ? { ...args, action: def.action } : args;
      attempt.result = await new ComparisonServices(current.f.actor, current.f.conversationId)
        .execute(current.context, current.key, def.direct ? 'sfp-comparison-business' : name, mapped);
      attempt.ok = true; return attempt.result.text;
    } catch (e) {
      attempt.ok = false; attempt.error = String((e as Error).message);
      return def.direct ? '暂时无法核实这次操作的结果，请重新查询当前状态；不能确认已保存或已提交接待。' : JSON.stringify({ ok: false, error: attempt.error });
    } finally { if (def.direct) current.direct = true; attempt.finished = new Date().toISOString(); save(); }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.authorization !== `Bearer ${bridgeKey}`) return send(401, { error: 'unauthorized' });
      assert.ok(active && !unknown);
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; assert.ok(size < 512000); chunks.push(Buffer.from(chunk)); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/comparison/tools') return send(200, { text: await execute(body.name, body.args) });
      assert.equal(req.url, '/v1/chat/completions'); assert.equal(body.model, scope.model);
      assert.ok(!inFlight && !active.direct, 'Serial inference, terminal receipt boundary');
      const service = new ComparisonServices(active.f.actor, active.f.conversationId); await service.fresh(active.context);
      const start = body.messages.findLastIndex((m: Row) => m.role === 'user' && m.content === active!.row.prompt);
      assert.ok(start >= 0, 'One current user message required');
      const tools = active.protocol.tools.map((d: Row) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } }));
      assert.deepEqual((body.tools || []).map((t: Row) => t.function.name).sort(), tools.map((t: Row) => t.function.name).sort(), 'Native framework must expose the same tools');
      const request = { model: scope.model, messages: [{ role: 'system', content: active.system }, ...body.messages.slice(start)],
        tools, tool_choice: 'auto', parallel_tool_calls: false, temperature: 0.2, stream: false, enable_thinking: false, max_tokens: 2048 };
      if (mode === 'transport') {
        report.transportRequests.push({ variant: active.f.variant, native: body, canonical: request }); save();
        const name = active.f.variant === 'baseline' ? 'sfp-comparison-business' : 'sfp-comparison-read_status';
        return send(200, { id: 'local-transport-only', object: 'chat.completion', created: 1, model: scope.model,
          choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_transport', type: 'function',
            function: { name, arguments: JSON.stringify(active.f.variant === 'baseline' ? { action: 'read_status' } : {}) } }] }, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      }
      assert.ok(report.calls.length < scope.providerCallLimit && report.calls.filter((c: Row) => c.case === active!.row.id).length < scope.perTurnCallLimit);
      const reserve = Buffer.byteLength(JSON.stringify(request), 'utf8') + 2048, used = tokens(report.calls), prior = report.authorization;
      assert.ok(prior.previousComparisonTokens + prior.previousDiagnosisTokens + used + reserve <= scope.inheritedComparisonTokenCap, 'Inherited comparison cap');
      assert.ok(prior.previousPlanTokens + prior.previousPilotTokens + prior.previousComparisonTokens + prior.previousDiagnosisTokens + prior.previousContractTokens + used + reserve <= prior.cumulativeTokenLimit, 'Cumulative token cap');
      assert.ok(prior.previousPlanMicros + (prior.previousPilotTokens + prior.previousComparisonTokens + prior.previousDiagnosisTokens + prior.previousContractTokens + used + reserve) * 5 <= prior.cumulativeMicrosLimit, 'Cumulative cost cap');
      const attempt: Row = { id: randomUUID(), case: active.row.id, variant: active.f.variant, request, nativeRequest: body,
        reservedTokens: reserve, status: 'dispatching', started: new Date().toISOString() };
      report.calls.push(attempt); inFlight = true; save();
      try {
        const response = await fetch(`${provider.toString().replace(/\/$/, '')}/chat/completions`, { method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(90000) });
        const result = await response.json(); attempt.response = result; attempt.httpStatus = response.status;
        if (!response.ok || !Number.isSafeInteger(result.usage?.total_tokens)) { attempt.status = 'unknown'; unknown = true; }
        else { attempt.status = 'succeeded'; attempt.usage = result.usage; }
        await service.fresh(active.context); send(response.status, result);
      } catch (e) { attempt.status = 'unknown'; attempt.error = String((e as Error).message); unknown = true; send(502, { error: 'provider_outcome_unknown' }); }
      finally { inFlight = false; attempt.finished = new Date().toISOString(); save(); }
    } catch (e) { send(409, { error: String((e as Error).message) }); }
  }

  try {
    // A terminated non-paid driver may not reach finally. Recover only fixtures
    // named by this experiment's own incomplete reports, never another run.
    report.recoveredInterrupted = [];
    for (const file of fs.readdirSync(directory).filter(f => /^trial-.*\.json$/.test(f))) {
      const previousReport = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      if (previousReport.finished || file === path.basename(output)) continue;
      assert.equal(previousReport.calls.length, 0, 'Interrupted paid run needs explicit outcome reconciliation');
      for (const f of previousReport.fixtures) {
        await withPlatformTransaction(async tx => {
          const owned = await rows(tx, sql`select id from app.enterprises where id=${f.enterpriseId} and code like 'synthetic-agent-comparison-%'`);
          assert.equal(owned.length, 1);
          await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);
          await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`);
        });
      }
      report.recoveredInterrupted.push({ file, fixturesDisabled: previousReport.fixtures.map((f: Row) => f.enterpriseId),
        outcome: 'Driver interrupted before completion; no provider calls; no acceptance evidence.' }); save();
    }
    const embedding = await embeddingGateway().embed([syntheticKnowledge], 'document');
    report.embedding = { profile: embeddingGateway().profile, usage: embedding.usage };
    report.bindingBefore = binding(); save();
    for (let i = 0; i < (mode === 'services' ? 3 : mode === 'transport' ? 2 : 4); i++) {
      const f = await fixture(batch, i, embedding.vectors[0]); report.fixtures.push(f); save();
      f.variant = i < (mode === 'live' ? 2 : 1) ? 'baseline' : 'split'; f.trial = i % 2 + 1;
    }
    const [a, b, c] = report.fixtures;
    await assert.rejects(() => new ComparisonServices(b.actor, a.conversationId).context()); report.checks.crossTenantDenied = true;
    if (mode === 'services') {
      async function write(f: Row, text: string, fields: (id: string) => Row[]) {
        const key = await append(f, text), service = new ComparisonServices(f.actor, f.conversationId), context = await service.context();
        return service.execute(context, key, 'sfp-comparison-business', { action: 'save_requirements', quote: text,
          sourceSeq: context.sourceSeq, fields: fields(context.customerMessages.at(-1)!.id) });
      }
      for (const f of [a, b]) {
        const atomic = f === b;
        await write(f, scenarios.turns[0].text + '先帮我留一下。', id => [
          { field: 'housing', text: '90平', sourceMessageId: id }, { field: 'budget', text: '12万', sourceMessageId: id },
          { field: 'room', text: atomic ? '客厅想铺木地板' : '客厅想铺木地板，地暖不做', sourceMessageId: id },
          ...(atomic ? [{ field: 'devices', text: '地暖不做', sourceMessageId: id }] : []),
        ]);
        const before = await readback(f);
        await write(f, scenarios.turns[3].text, id => [{ field: 'budget', text: '10万', sourceMessageId: id }, { field: 'room', text: '客厅换瓷砖', sourceMessageId: id }]);
        const after = await readback(f); assert.ok(after.requirements.latest);
        const retained = /地暖不做/.test(JSON.stringify(after.requirements.latest.draftFields));
        assert.equal(retained, atomic);
        report.checks[atomic ? 'atomicFieldPreservesHeating' : 'compositeFieldLosesHeating'] = { reproduced: true, before, after };
      }
      const key = await append(c, scenarios.turns[1].text), service = new ComparisonServices(c.actor, c.conversationId), context = await service.context();
      await service.execute(context, key, 'sfp-comparison-business', { action: 'request_designer', quote: scenarios.turns[1].text });
      const after = await readback(c); assert.equal(after.handoff.handoff?.state, 'waiting');
      report.checks.exactNegativeQuoteIsNotConsent = { reproduced: true, input: scenarios.turns[1].text, after,
        boundary: 'Deliberately instrumented synthetic comparison seam only; production intent guard remains unchanged.' };
      return;
    }
    server = http.createServer((req, res) => { void handle(req, res); });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const bridgeURL = `http://127.0.0.1:${address.port}`; report.bridgeOrigin = bridgeURL;
    // Baseline/control order reverses between trial pairs. Every fixture is isolated.
    const execution = mode === 'live' ? [report.fixtures[0], report.fixtures[2], report.fixtures[3], report.fixtures[1]] : report.fixtures;
    for (const f of execution) {
      const selected = f.variant === 'baseline' ? protocol : splitProtocol();
      const turns = mode === 'transport' ? [{ id: 'transport', text: '查询测试状态。' }]
        : scenarios.turns.filter((t: Row) => (f.variant === 'baseline' ? scope.baseline.turns : scope.splitToolsControl.turns).includes(t.id));
      for (const turn of turns) {
        assert.ok(!unknown, 'Unknown provider result stops dispatch');
        if (turn.retireBefore) f.withdrawal = await retire(f);
        const before = await readback(f), key = await append(f, turn.text);
        const context = await new ComparisonServices(f.actor, f.conversationId).context(), system = selected.system + '\n' + JSON.stringify(comparisonContextData(context));
        const row: Row = { id: `pydanticai.${f.variant}.${f.trial}.${turn.id}`, variant: f.variant, trial: f.trial,
          prompt: turn.text, expected: turn.expect, started: new Date().toISOString(), before, authorizedContext: context };
        report.cases.push(row); active = { f, row, key, context, system, protocol: selected, direct: false }; save();
        try {
          row.result = await runPython({ protocol: selected, model: scope.model, baseURL: bridgeURL + '/v1', bridgeURL,
            apiKey: bridgeKey, system, text: turn.text });
          row.after = await readback(f); row.finished = new Date().toISOString();
          row.receipt = report.tools.filter((t: Row) => t.case === row.id && t.result?.receipt).at(-1)?.result;
          row.receiptMatchesFinal = row.receipt ? row.result.textResponse === row.receipt.text : null;
          row.persistence = 'Business state read back from real services on every turn; no product chat/checkpointer integration claimed.';
          if (mode === 'transport') { assert.ok(row.receiptMatchesFinal); assert.equal(row.after.requirements.latest, null); }
          console.log(JSON.stringify({ case: row.id, receipt: row.receipt?.receipt.action || null, tokens: tokens(report.calls) }));
        } catch (e) { row.error = String((e as Error).message); throw e; }
        finally { active = undefined; save(); }
      }
    }
    const receipts = report.cases.filter((r: Row) => r.receipt);
    report.checks.receipts = { delivered: receipts.length, matched: receipts.filter((r: Row) => r.receiptMatchesFinal).length };
    report.checks.withdrawnInputAbsent = report.calls.filter((c: Row) => ['withdrawal', 'reversal', 'contact', 'cancel'].some(id => c.case.endsWith('.' + id)))
      .every((c: Row) => !/90\s*分钟/.test(JSON.stringify(c.request.messages)));
    report.semanticReview = 'Pending independent assessment against original first answers and real state; plumbing is not semantic acceptance.';
  } catch (e) { report.error = String((e as Error).stack || e).replaceAll(env.DASHSCOPE_API_KEY || 'NO_KEY', '[REDACTED]'); process.exitCode = 1; }
  finally {
    active = undefined;
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    for (const f of report.fixtures) {
      try { await withPlatformTransaction(async tx => {
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);
        await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`);
      }); f.disabled = true; } catch (e) { f.cleanupError = String((e as Error).message); process.exitCode = 1; }
    }
    report.bindingAfter = binding();
    report.drift = [...new Set([...Object.keys(report.bindingBefore || {}), ...Object.keys(report.bindingAfter)])]
      .filter(f => report.bindingBefore?.[f] !== report.bindingAfter[f]);
    if (report.drift.length) process.exitCode = 1;
    report.observedTokens = report.calls.reduce((n: number, c: Row) => n + (c.usage?.total_tokens || 0), 0);
    report.unknownCalls = report.calls.filter((c: Row) => c.status !== 'succeeded').length;
    report.conservativeNewCostMicros = tokens(report.calls) * 5; report.finished = new Date().toISOString(); save();
    console.log(JSON.stringify({ output: path.relative(root, output), cases: report.cases.length, calls: report.calls.length,
      tokens: report.observedTokens, unknown: report.unknownCalls, checks: Object.keys(report.checks), drift: report.drift,
      error: report.error?.split('\n').slice(0, 2).join(' '), cleaned: report.fixtures.every((f: Row) => f.disabled) }));
  }
}
void main().catch(e => { console.error(String(e.message)); process.exitCode = 1; }).finally(() => closePostgresPool());
