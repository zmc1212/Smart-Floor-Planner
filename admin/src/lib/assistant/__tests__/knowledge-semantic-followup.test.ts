import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { auditProjectedSources } from '../../../../scripts/assistant-knowledge-semantics-followup';

const knowledge = (sourceId: string) => ({ sourceId, kind: 'knowledge', title: 'Synthetic rule', text: 'Complete original with prerequisite and exception.',
  professional: { origin: { version: '1' }, prerequisites: ['verify site'], exceptions: ['pending approval'] },
  applicability: { status: 'unknown' }, context: { projectId: '10', policyVersion: 1 }, citationQuotes: ['Complete original'] });
const project = (sourceId: string) => ({ sourceId, kind: 'project', title: 'Actual synthetic stage', resultKey: 'run:0:0',
  text: 'Project 10 is at utilities; no approval or point plan was found.', material: { ref: { id: '20', version: '3' }, text: 'Project 10 is at utilities; no approval or point plan was found.' } });
const packets = (sources: object[], aliases?: object[]) => [{ role: 'tool', content: JSON.stringify({ synthesisSources: sources, ...(aliases ? { sourceAliases: aliases } : {}) }) }];

test('complete canonical knowledge and actual project sources survive permitted hint removal', () => {
  const expected = [knowledge('K1'), knowledge('K2'), project('B1')];
  const actual = structuredClone(expected) as Array<Record<string, unknown>>;
  for (const source of actual) delete source.citationQuotes;
  delete (actual[2].material as Record<string, unknown>).text;
  assert.deepEqual(auditProjectedSources(packets(expected), packets(actual)).knowledge, 2);
});
test('distinct knowledge identities cannot be collapsed even when original text is equal', () => {
  assert.throws(() => auditProjectedSources(packets([knowledge('K1'), knowledge('K2')]), packets([knowledge('K1')], [{ sourceId: 'K2', canonicalSourceId: 'K1' }])));
});
test('omitting any canonical passage, prerequisite, exception or metadata fails coverage', () => {
  const expected = knowledge('K1');
  for (const field of ['text', 'professional', 'applicability', 'context']) {
    const changed = { ...expected, [field]: field === 'text' ? 'Truncated original' : {} };
    assert.throws(() => auditProjectedSources(packets([expected]), packets([changed])));
  }
});
test('project aliases retain exact source text, identity metadata and original result key', () => {
  const a = project('B1'), b = { ...a, sourceId: 'B2', resultKey: 'run:0:1' };
  auditProjectedSources(packets([a, b]), packets([a], [{ sourceId: 'B2', canonicalSourceId: 'B1', resultKey: b.resultKey }]));
  assert.throws(() => auditProjectedSources(packets([a, b]), packets([a], [{ sourceId: 'B2', canonicalSourceId: 'B1', resultKey: 'wrong' }])));
  assert.throws(() => auditProjectedSources(packets([a, { ...b, text: 'Different actual stage' }]), packets([a], [{ sourceId: 'B2', canonicalSourceId: 'B1', resultKey: b.resultKey }])));
});
test('missing source baselines or actual project facts never become passing empty evidence', () => {
  assert.throws(() => auditProjectedSources([], []));
  assert.throws(() => auditProjectedSources(packets([project('B1')]), []));
});
test('unknown source identities and conflicting duplicate payloads cannot pass the request audit', () => {
  assert.throws(() => auditProjectedSources(packets([knowledge('K1')]), packets([knowledge('K1'), knowledge('PRIVATE')])));
  assert.throws(() => auditProjectedSources(packets([knowledge('K1')]), packets([knowledge('K1'), { ...knowledge('K1'), context: {} }])));
});
test('paid and nonpaid modes cannot mix and invalid options fail before private-file access', () => {
  for (const args of [['--followup', '--preflight', '--live'], ['--followup', '--budget-only', '--live'], ['--followup', '--knowledge-only', '--preflight'], ['--unknown']]) {
    const result = spawnSync(process.execPath, ['scripts/assistant-knowledge-semantics-acceptance.mjs', ...args,
      '--connection-file', 'PRIVATE-MUST-NOT-READ'], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 1); assert.doesNotMatch(result.stderr, /ENOENT/);
    assert.match(result.stderr, /Followup modes must be explicit and separate|Invalid or duplicate acceptance argument/);
  }
});
