/** Test-only proof for continuing the two saved natural-answer turns; no product restore API. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
export type NaturalContinuation = {
  label: string; conversationId: string; customerId: string; scopeHash: string;
  turns: Row[]; runs: Row[]; outputs: Row[]; originalFailure: string;
};
export function loadNaturalContinuation(root: string, label: string): NaturalContinuation {
  assert.equal(label, 'natural-configured-20261105-01', 'Only the documented two-turn fixture may continue');
  const directory = path.join(root, 'tmp/v1-01-weiyun-jingyi', label);
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const prior = read('report.json'), binding = read('binding.json'), plan = read('fixed-plan.json');
  assert.equal(prior.passed, false); assert.match(prior.error, /JSON\.stringify\(read\)/);
  assert.deepEqual(binding.drift, []); assert.deepEqual(prior.ownedConversationIds, ['1302']);
  assert.equal(prior.ownedChatsArchived, 1); assert.equal(prior.trials.length, 1);
  const trial = prior.trials[0];
  assert.equal(trial.round, 1); assert.equal(trial.kind, 'customer'); assert.equal(trial.native, false);
  assert.deepEqual(trial.turns.map((turn: Row) => turn.runId), ['2203', '2204']);
  assert.ok(prior.calls.length === 7 && prior.calls.every((call: Row) => call.status === 'succeeded'));
  const traces = ['2203', '2204'].map(id => read('run-' + id + '.json'));
  const repair = JSON.parse(fs.readFileSync(path.join(root, 'tmp/v1-01-weiyun-jingyi/natural-answer-20261105/readback-repair.json'), 'utf8'));
  assert.equal(repair.passed, true); assert.equal(repair.conversationId, '1302'); assert.deepEqual(repair.binding.drift, []);
  for (const file of ['admin/src/lib/assistant/core/conversation.ts', 'admin/src/lib/assistant/contracts/index.ts', 'admin/.env.local']) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), repair.binding.after[file]);
  }
  for (const [index, trace] of traces.entries()) {
    assert.equal(trace.run.status, 'succeeded'); assert.equal(trace.run.policy_snapshot.sourceAnswerMode, 'natural-knowledge-answer-v1');
    assert.equal(trace.run.output_message_id, String(trace.output.id));
    assert.equal(String(trace.output.conversation_id), '1302');
    assert.equal(trial.turns[index].question, plan.scope.journeys.customer[index]);
    assert.ok(repair.checks.some((check: Row) => check.runId === trace.run.id && check.exactTextMatches === true));
  }
  return {label, conversationId: '1302', customerId: '645', scopeHash: plan.scopeHash,
    turns: trial.turns, runs: traces.map(trace => trace.run), outputs: traces.map(trace => trace.output), originalFailure: prior.error};
}

export function assertNaturalContinuationState(proof: NaturalContinuation, state: {
  conversation: Row; participants: Row[]; messages: Row[]; runs: Row[];
}, customerId: string): void {
  assert.equal(customerId, proof.customerId);
  const c = state.conversation;
  assert.equal(String(c.id), proof.conversationId); assert.equal(String(c.enterprise_id), '1454');
  assert.equal(c.purpose, 'customer_consultation'); assert.equal(c.mode, 'ai'); assert.equal(c.status, 'archived');
  assert.deepEqual(c.entry_snapshot, {id: '3132', kind: 'lead'}); assert.equal(String(c.last_seq), '4');
  assert.equal(state.participants.length, 1);
  const owner = state.participants[0];
  assert.equal(owner.principal_kind, 'user'); assert.equal(String(owner.user_id), customerId);
  assert.equal(owner.participant_role, 'owner'); assert.equal(owner.status, 'active');
  assert.equal(String(owner.enterprise_id), '1454'); assert.equal(String(owner.conversation_id), proof.conversationId);
  assert.deepEqual(state.messages.map(m => String(m.id)), ['12277', '12278', '12279', '12280']);
  assert.deepEqual(state.runs.map(r => String(r.id)), ['2203', '2204']);
  for (const [index, run] of state.runs.entries()) {
    assert.equal(run.status, 'succeeded'); assert.deepEqual(run.policy_snapshot, proof.runs[index].policy_snapshot);
    assert.equal(String(run.conversation_id), proof.conversationId);
    const user = state.messages[index * 2], output = state.messages[index * 2 + 1];
    assert.equal(String(run.trigger_message_id), String(user.id)); assert.equal(String(run.output_message_id), String(output.id));
    assert.equal(user.author_kind, 'user'); assert.equal(String(user.user_id), customerId);
    assert.equal(user.client_message_id, proof.turns[index].key);
    assert.deepEqual(user.content, {version: 1, blocks: [{type: 'text', text: proof.turns[index].question}]});
    assert.deepEqual(output.content, proof.outputs[index].content);
  }
}
