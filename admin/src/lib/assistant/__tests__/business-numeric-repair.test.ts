import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fingerprint} from '../contracts';
import type {ModelMessage} from '../contracts/model';
import {modelCitationCatalog} from '../agent/citation-catalog';
import {parseSynthesis, synthesisRepairFeedback, type SynthesisSource} from '../agent/synthesis';
import {resolveSynthesisRepair} from '../agent/synthesis-repair';

const saved: { question: string; source: SynthesisSource;
  draft: { kind: string; segments: Array<{ basis: string; text: string; citations: Array<{ citationId: string }> }> } } =
  JSON.parse(readFileSync(new URL('./fixtures/construction-count-2449.json', import.meta.url), 'utf8'));
const source = saved.source, raw = JSON.stringify(saved.draft);
const control = (feedback: string): ModelMessage[] => [{ role: 'assistant', content: raw },
  { role: 'system', content: [{ type: 'text', text: feedback }] }];

test('saved2449 construction count receives the existing single numeric repair instead of an empty failure', () => {
  assert.throws(() => parseSynthesis(raw, [source]), /unsupported_model_commitment/);
  assert.deepEqual(modelCitationCatalog(source).map(catalog => catalog.citationId),
    saved.draft.segments[0].citations.map(citation => citation.citationId));
  const issue = synthesisRepairFeedback(raw, [source]);
  assert.ok(issue); assert.equal(issue.code, 'unsupported_model_commitment');
  assert.match(issue.feedback, /segments\[0\]\.text/);
  assert.match(issue.feedback, /"removeUnsupportedNumbers":\["4"\]/);
  assert.match(issue.feedback, /synthesis-edit-v1/);
  const repaired = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(raw), edits: [{
    segment: 0, text: saved.draft.segments[0].text.replace('您名下目前共有4个项目的施工记录', '您名下目前有以下项目的施工记录') }] }),
  control(issue.feedback), [source], 1);
  const answer = parseSynthesis(repaired, [source]);
  assert.match(answer.segments[0].text, /以下项目的施工记录/);
  assert.doesNotMatch(answer.segments[0].text, /共有4个项目/);
  assert.equal(answer.segments[0].citations.length, 2);
});

test('business numeric recovery keeps completion claims, unknown citations and non-snapshot sources closed', () => {
  const claim = JSON.stringify({ ...saved.draft, segments: [{ ...saved.draft.segments[0],
    text: saved.draft.segments[0].text.replace('根据系统查询，', '根据系统查询，现场已经正式验收，') }] });
  assert.throws(() => synthesisRepairFeedback(claim, [source]), /unsupported_model_commitment/);
  const unknown = JSON.stringify({ ...saved.draft, segments: [{ ...saved.draft.segments[0], citations: [{ citationId: 'Cunknown' }] }] });
  assert.throws(() => synthesisRepairFeedback(unknown, [source]), /invalid_model_citation/);
  const withoutResultKey = { ...source, resultKey: undefined };
  assert.throws(() => synthesisRepairFeedback(raw, [withoutResultKey]), /unsupported_model_commitment/);
  const knowledge: SynthesisSource = { sourceId: 'K1', kind: 'knowledge', title: '工艺手册', text: '瓷砖铺贴前应检查基层含水率。' };
  const unrelated = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '基层含水率应在4%以内。',
    citations: [{ sourceId: 'K1', quote: '瓷砖铺贴前应检查基层含水率。' }] }] });
  assert.throws(() => synthesisRepairFeedback(unrelated, [knowledge]), /unsupported_model_commitment/);
});

test('the repaired business answer still passes the complete original guards', () => {
  const repaired = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(raw), edits: [{
    segment: 0, text: saved.draft.segments[0].text.replace('您名下目前共有4个项目的施工记录', '您名下目前有以下项目的施工记录') }] }),
  control(synthesisRepairFeedback(raw, [source])!.feedback), [source], 1);
  assert.throws(() => parseSynthesis(repaired.replace('您名下目前有以下项目的施工记录', '您名下目前有以下项目的施工记录，现场已经正式验收'), [source]),
    /unsupported_model_commitment/);
  assert.throws(() => parseSynthesis(raw, [source]), /unsupported_model_commitment/);
});
