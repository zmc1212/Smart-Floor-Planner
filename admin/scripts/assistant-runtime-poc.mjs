/** Same deterministic scenarios, real framework engines, no provider/network I/O.
 * Install pinned candidates in tmp/xiaok-p2m-poc; pass that directory as argv[2].
 * This tests orchestration compatibility, not model quality or durable DB recovery.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve(process.argv[2], 'package.json'));
const { StateGraph, Annotation, START, END } = require('@langchain/langgraph');
const { Agent, Runner, tool, Usage, setTracingDisabled } = require('@openai/agents-core');
setTracingDisabled(true);

const scenarios = ['first-image', 'followup', 'correction', 'authorized-query', 'handoff', 'restart', 'takeover', 'revocation', 'timeout', 'duplicate-write'];
function fixture(scenario) {
  return { scenario, authorized: true, ai: true, calls: 0, writes: new Map(), observations: [],
    history: [{ role: 'user', content: '书房要采光好' }, { role: 'assistant', content: '书房采光需求已记下' }],
    facts: { study: { daylight: true, desk: 1 }, bedroom: { quiet: true } } };
}
function check(s) { if (!s.authorized || !s.ai) throw Error('context_changed'); }
async function execute(s) {
  check(s);
  const key = 'tenant:customer:conversation:turn:operation';
  if (!s.writes.has(key)) {
    s.writes.set(key, { status: 'succeeded' });
    if (s.scenario === 'correction') s.facts.study.desk = 2;
    if (s.scenario === 'handoff') s.ai = false;
  }
  return s.writes.get(key);
}
async function model(s) {
  check(s); s.calls++;
  if (s.scenario === 'timeout') throw Error('provider_outcome_unknown');
  if (s.scenario === 'takeover') { s.ai = false; check(s); }
  if (s.scenario === 'revocation') { s.authorized = false; check(s); }
  if (s.scenario === 'first-image') s.observations.push('synthetic image observed');
  return ['correction', 'authorized-query', 'handoff', 'duplicate-write', 'restart'].includes(s.scenario) && !s.writes.size ? 'tool' : 'done';
}
async function langgraph(s) {
  const State = Annotation.Root({ next: Annotation() });
  const graph = new StateGraph(State)
    .addNode('model', async () => ({ next: await model(s) }))
    .addNode('tool', async () => { await execute(s); return { next: s.ai ? 'model' : 'done' }; })
    .addEdge(START, 'model')
    .addConditionalEdges('model', x => x.next === 'tool' ? 'tool' : END)
    .addConditionalEdges('tool', x => x.next === 'model' ? 'model' : END)
    .compile();
  await graph.invoke({ next: 'model' }, { recursionLimit: 8 });
}
async function agents(s) {
  const runtimeModel = { name: 'poc-fixture', async getResponse() {
    const next = await model(s);
    return { usage: new Usage(), output: next === 'tool'
      ? [{ type: 'function_call', callId: 'operation', name: 'business_operation', arguments: '{}' }]
      : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'done' }] }] };
  }, async *getStreamedResponse() { throw Error('streaming_disabled'); } };
  const business = tool({ name: 'business_operation', description: 'Server-authorized fixture operation',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    execute: () => execute(s) });
  const agent = new Agent({ name: 'poc', model: runtimeModel, tools: [business],
    toolUseBehavior: s.scenario === 'handoff' ? 'stop_on_first_tool' : 'run_llm_again' });
  await new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false }).run(agent, 'fixture', { maxTurns: 4 });
}
const results = [];
for (const [runtime, run] of [['langgraph', langgraph], ['agents-core', agents]]) {
  for (const scenario of scenarios) {
    const s = fixture(scenario), start = performance.now(); let error = null;
    // Resume from a business-owned completed operation, not a second source of truth.
    if (scenario === 'restart') await execute(s);
    try { await run(s); if (scenario === 'duplicate-write') await execute(s); } catch (e) { error = e.message; }
    if (['takeover', 'revocation'].includes(scenario)) assert.equal(error, 'context_changed');
    else if (scenario === 'timeout') { assert.equal(error, 'provider_outcome_unknown'); assert.equal(s.calls, 1); }
    else assert.equal(error, null, runtime + '/' + scenario);
    assert.ok(s.writes.size <= 1);
    if (scenario === 'correction') assert.deepEqual(s.facts, { study: { daylight: true, desk: 2 }, bedroom: { quiet: true } });
    if (scenario === 'handoff') assert.equal(s.ai, false);
    if (scenario === 'first-image') assert.equal(s.observations.length, 1);
    results.push({ runtime, scenario, passed: true, calls: s.calls, writes: s.writes.size, ms: Math.round(performance.now() - start) });
  }
}
console.log(JSON.stringify({ scope: 'deterministic orchestration only; synthetic perception; application-owned replay; no database restart or live-model claim',
  versions: { langgraph: '1.5.0', agentsCore: '0.20.0' }, results }, null, 2));
