import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNativeDelivery, nativeExecutorPrompt, recoveredDialogueToolState, xiaokNativeExecutorProtocol } from '../agent/native-executor';
import { nativeAgentRuntimeBinding } from '../fastgpt/agent-v2/config';
import { recoverableUnavailableRead } from '../agent/runtime';
import type { ModelTool, ModelTurnOutput } from '../contracts/model';

type Code = { code?: string };
const invalidCheckpoint = (error: Code) => error.code === 'invalid_agent_checkpoint';
const readTools: ModelTool[] = [
  { name: 'query_business', description: '', parameters: {} },
  { name: 'final_response', description: '', parameters: {} },
];

test('knowledge retrieval without a model citation fails closed', () => {
  assert.throws(() => composeNativeDelivery('先排版再铺贴。', '', 0, true), (error: Code) => error.code === 'missing_citation');
  assert.throws(() => composeNativeDelivery('先排版再铺贴。', '', 0, false, true), (error: Code) => error.code === 'missing_citation');
  // The same text with its citation marker present is deliverable.
  assert.equal(composeNativeDelivery('先排版再铺贴[15](CITE)。', '', 1, true).modelIncluded, true);
});

test('an uncited explanation now accompanies an authoritative snapshot when nothing was retrieved', () => {
  // P1 delivery change: the FastGPT V2 discard rule retires with the bridge.
  const composed = composeNativeDelivery('您家的施工记录里写着当前在软装阶段。', '项目记录快照内容', 0, false);
  assert.equal(composed.modelIncluded, true);
  assert.match(composed.text, /您家的施工记录里写着当前在软装阶段。/);
  assert.match(composed.text, /项目记录（授权快照，以此为准）\n项目记录快照内容$/);
  // Retrieved-but-uncited knowledge still cannot ride along with a snapshot.
  assert.equal(composeNativeDelivery('先排版再铺贴。', '项目记录快照内容', 0, true).modelIncluded, false);
  assert.equal(composeNativeDelivery('', '项目记录快照内容', 0, false).modelIncluded, false);
});

test('a commitment-violating draft falls back to the snapshot section only', () => {
  assert.equal(composeNativeDelivery('您家已经验收完成了。', '项目记录快照内容', 0, false).modelIncluded, false);
  // Without a snapshot the violated draft has nothing authoritative to fall
  // back to; the run fails closed exactly like the FastGPT V2 path.
  assert.throws(() => composeNativeDelivery('您家已经验收完成了。', '', 0, false),
    (error: Code) => error.code === 'unsupported_model_commitment');
  assert.throws(() => composeNativeDelivery('这个价格我保证不超过五万元。', '', 0, false),
    (error: Code) => error.code === 'unsupported_model_commitment');
});

test('the executor prompt keeps knowledge discipline without the knowledge switch', () => {
  assert.match(nativeExecutorPrompt(true), /search_enterprise/);
  assert.match(nativeExecutorPrompt(true), /\[id\]\(CITE\)/);
  const off = nativeExecutorPrompt(false);
  assert.doesNotMatch(off, /search_enterprise检索获权资料/);
  assert.match(off, /不声称检索过企业资料/);
  assert.match(nativeExecutorPrompt(false), /query_business/);
});

test('the runtime read registry covers the V2 tool names for unavailable-read recovery', () => {
  const calls = (name: string, id: string, args = '{}'): ModelTurnOutput =>
    ({ text: '', toolCalls: [{ id, name, arguments: args }], finishReason: 'tool_calls', providerRequestId: null, usage: null });
  // A batch mixing one active read with the unregistered V2 name stays
  // recoverable instead of instantly poisoning the run.
  assert.equal(recoverableUnavailableRead(calls('search_enterprise', 'a'), readTools), true);
  assert.equal(recoverableUnavailableRead(calls('recommend_public_sites', 'a'), readTools), true);
  // A write outside the read family is never recoverable.
  assert.equal(recoverableUnavailableRead(calls('record_need', 'a'), readTools), false);
});

test('the native binding only selects the langgraph-v1 executor switch', () => {
  // Without a workflows file nothing is bound; the executor cannot silently start.
  const previous = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  try {
    assert.equal(nativeAgentRuntimeBinding('1454'), undefined);
  } finally {
    if (previous !== undefined) process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = previous;
  }
  assert.equal(xiaokNativeExecutorProtocol, 'xiaok-native-executor-v1');
});

test('recovered tool state reuses persisted receipts and allocates fresh sequences', () => {
  const state = recoveredDialogueToolState(
    [{ step_seq: 1301, input_summary: { query: '防水闭水试验', receipt: { status: 'ready', kind: 'enterprise', cites: [1] } } }],
    [{ step_seq: 1402, input_summary: { key: 'construction:3132', receipt: { status: 'ready', text: '快照' } } }]);
  assert.equal(state.nextSequence, 3);
  assert.equal(state.searches.get('防水闭水试验')?.status, 'ready');
  assert.equal(state.businesses.get('construction:3132')?.status, 'ready');
  // Receipts recorded before the recovery format are not reconstructable:
  // fail closed instead of re-dispatching a metered call.
  assert.throws(() => recoveredDialogueToolState([{ step_seq: 1301, input_summary: { query: 'q' } }], []), invalidCheckpoint);
  // Duplicate identities and unknown step ranges cannot be recovered either.
  assert.throws(() => recoveredDialogueToolState([
    { step_seq: 1301, input_summary: { query: 'q', receipt: { status: 'empty' } } },
    { step_seq: 1302, input_summary: { query: 'q', receipt: { status: 'empty' } } }], []), invalidCheckpoint);
  assert.throws(() => recoveredDialogueToolState([{ step_seq: 1501, input_summary: { query: 'q', receipt: {} } }], []), invalidCheckpoint);
  // An empty run starts the shared counter from the beginning.
  assert.equal(recoveredDialogueToolState([], []).nextSequence, 0);
});
