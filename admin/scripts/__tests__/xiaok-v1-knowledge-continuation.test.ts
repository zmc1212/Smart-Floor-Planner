import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNaturalContinuationState, type NaturalContinuation } from '../xiaok-v1-knowledge-continuation';

function fixture() {
  const turns = [{key: 'first', question: '原首问'}, {key: 'second', question: '原更正'}];
  const policy = {sourceAnswerMode: 'natural-knowledge-answer-v1'};
  const content = (text: unknown) => ({version: 1, blocks: [{type: 'text', text}]});
  const outputs = [{content: content('原回答一')}, {content: content('带"引号"的回答二')}];
  const proof: NaturalContinuation = {label: 'natural-configured-20261105-01', conversationId: '1302', customerId: '645',
    scopeHash: 'fixed', turns, outputs, runs: [{policy_snapshot: policy}, {policy_snapshot: policy}], originalFailure: 'readback'};
  const state = {
    conversation: {id: '1302', enterprise_id: '1454', purpose: 'customer_consultation', mode: 'ai', status: 'archived',
      entry_snapshot: {kind: 'lead', id: '3132'}, last_seq: '4'},
    participants: [{principal_kind: 'user', user_id: '645', participant_role: 'owner', status: 'active', enterprise_id: '1454', conversation_id: '1302'}],
    messages: turns.flatMap((turn, i) => [{id: String(12277 + i * 2), author_kind: 'user', user_id: '645', client_message_id: turn.key, content: content(turn.question)},
      {id: String(12278 + i * 2), author_kind: 'assistant', user_id: '', client_message_id: '', content: outputs[i].content}]),
    runs: turns.map((_, i) => ({id: String(2203 + i), status: 'succeeded', conversation_id: '1302', policy_snapshot: policy,
      trigger_message_id: String(12277 + i * 2), output_message_id: String(12278 + i * 2)})),
  };
  return {proof, state};
}
test('exact archived fixture accepts both original turns, including quoted content', () => {
  const {proof, state} = fixture(); assert.doesNotThrow(() => assertNaturalContinuationState(proof, state, '645'));
});
test('wrong tenant, owner, entry or extra participant cannot be restored', () => {
  for (const mutate of [(s: ReturnType<typeof fixture>['state']) => {s.conversation.enterprise_id = '999';},
    (s: ReturnType<typeof fixture>['state']) => {s.participants[0].user_id = '999';},
    (s: ReturnType<typeof fixture>['state']) => {s.conversation.entry_snapshot.id = '999';},
    (s: ReturnType<typeof fixture>['state']) => {s.participants.push({...s.participants[0]});}]) {
    const {proof, state} = fixture(); mutate(state); assert.throws(() => assertNaturalContinuationState(proof, state, '645'));
  }
});
test('changed or appended conversation history cannot continue', () => {
  for (const mutate of [(s: ReturnType<typeof fixture>['state']) => {s.messages[0].content.blocks[0].text = 'changed';},
    (s: ReturnType<typeof fixture>['state']) => {s.messages[3].content = {version: 1, blocks: [{type: 'text', text: 'changed'}]};},
    (s: ReturnType<typeof fixture>['state']) => {s.messages.push({...s.messages[0], id: '12281'});}]) {
    const {proof, state} = fixture(); mutate(state); assert.throws(() => assertNaturalContinuationState(proof, state, '645'));
  }
});
test('active, failed or unknown original runs are never replayed', () => {
  for (const status of ['queued', 'running', 'failed', 'indeterminate']) {
    const {proof, state} = fixture(); state.runs[1].status = status; assert.throws(() => assertNaturalContinuationState(proof, state, '645'));
  }
});
test('open conversation, revoked participant or changed policy rejects restoration', () => {
  for (const mutate of [(s: ReturnType<typeof fixture>['state']) => {s.conversation.status = 'open';},
    (s: ReturnType<typeof fixture>['state']) => {s.participants[0].status = 'revoked';},
    (s: ReturnType<typeof fixture>['state']) => {s.runs[0].policy_snapshot = {sourceAnswerMode: 'other'};}]) {
    const {proof, state} = fixture(); mutate(state); assert.throws(() => assertNaturalContinuationState(proof, state, '645'));
  }
});
