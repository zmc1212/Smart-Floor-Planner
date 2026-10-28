import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAgentReply } from '../agent/context';
import { negativeWorkStatusSpans } from '../agent/formal-status-polarity';
import { parseSynthesis, type SynthesisSource } from '../agent/synthesis';
const original = (text: string) => JSON.stringify({ kind: 'general', text });
test('complete negative work-state scopes preserve the exact provider wording while denying a completion assertion', () => {
  for (const text of ['因此现在既没有可确认的“已落实”证据，也没有正式解决或关闭的记录。',
    '因此该事项既未确认已落实，也未关闭。', '本次查询未显示该事项已落实、正式解决或关闭；当前仍待团队核对。']) {
    assert.equal(negativeWorkStatusSpans(text).length, 1);
    assert.equal(parseAgentReply(original(text), { formalStatusEvidence: true }), text);
    assert.throws(() => parseAgentReply(original(text)), /unsupported_model_commitment/);
  }
});
test('positive suffixes, outer negation, unknown subjects, incomplete quote scopes and financial verbs remain closed', () => {
  for (const text of ['已正式关闭事项。', '本次查询显示该事项已落实。', '本次查询未显示该事项已落实，但已经关闭事项。',
    '本次查询并非未显示该事项已落实。', '没有未显示该事项已落实。', '本次查询未显示陌生对象已落实。',
    '没有“已落实，但是已关闭”的证据。', '本次查询未显示该事项已落实并已付款。', '本次查询未显示已付款。'])
    assert.throws(() => parseAgentReply(original(text), { formalStatusEvidence: true }), /unsupported_model_commitment/, text);
});
test('a formal source must actually be cited before sourced synthesis may analyze a negative status scope', () => {
  const source: SynthesisSource = { sourceId: 'P', kind: 'project', title: '正式方案', text: '书房方案仍待现场核对。', followup: {
    issueId: '7', revision: 3, projectId: '2', room: '书房', field: 'formal_plan', status: 'approved', waitingFor: 'team', ownerName: '项目团队',
    sourceMessageId: '4', sourceFactId: null, lastProgress: 'approved', kind: 'formal_plan', sourceVersion: 'hash' } };
  const other: SynthesisSource = { sourceId: 'K', kind: 'knowledge', title: '一般说明', text: source.text };
  const raw = (id: string) => JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'uncertainty', text: '本次查询未显示该事项已落实。', citations: [{ sourceId: id, quote: source.text }] }] });
  const context = { currentQuestion: '我同意的书房方案现在落实了吗？' };
  assert.equal(parseSynthesis(raw('P'), [source], context).segments[0].text, '本次查询未显示该事项已落实。');
  assert.throws(() => parseSynthesis(raw('K'), [source, other], context), /unsupported_model_commitment/);
});
