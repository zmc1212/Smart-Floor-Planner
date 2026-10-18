import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectContextCandidates } from '../knowledge/context-selection';
import { applicability, professionalKnowledge } from '../knowledge/professional';
import { knowledgeSynthesisSources, unresolvedSynthesisConflict } from '../agent/synthesis';
import { professionalEntry } from '../../../../scripts/assistant-professional-cases';

const chunk = (document: string, ordinal = 0) => ({
  id: `${document}:${ordinal}`, document_id: document,
  text: `合成原文 ${document} 第${ordinal}段，条件、单位与例外保持原样。`,
  locator: { start: ordinal * 50, end: ordinal * 50 + 35, unit: 'unicode_code_point' },
});

test('K03/04 four required documents survive two highly ranked documents with repeated chunks', () => {
  const ranked = [chunk('A'), chunk('A', 1), chunk('B'), chunk('B', 1), chunk('C'), chunk('D')];
  const selected = selectContextCandidates(ranked, new Map());
  assert.equal(selected.length, 5);
  assert.deepEqual(new Set(selected.map(c => c.document_id)), new Set(['A', 'B', 'C', 'D']));
  assert.equal(selected[0], ranked[0], 'The highest ranked usable chunk stays first');
  for (const c of selected) assert.ok(ranked.includes(c), 'Original objects, text and locators are retained');
});

test('K04 five relevant documents can each use one slot in the existing five-chunk budget', () => {
  const ranked = ['A', 'B', 'C', 'D', 'E'].flatMap(document => [chunk(document), chunk(document, 1)]);
  const selected = selectContextCandidates(ranked, new Map());
  assert.deepEqual(selected.map(c => c.document_id), ['A', 'B', 'C', 'D', 'E']);
});

test('K03 one or two documents retain useful repeats after coverage, without duplicating a chunk', () => {
  const first = Array.from({ length: 6 }, (_, i) => chunk('A', i));
  assert.deepEqual(selectContextCandidates(first, new Map()), first.slice(0, 5));
  const second = chunk('B'), selected = selectContextCandidates([...first, second], new Map());
  assert.equal(selected.length, 5); assert.equal(new Set(selected).size, 5);
  assert.ok(selected.includes(second)); assert.deepEqual(selected.filter(c => c !== second), first.slice(0, 4));
});

test('K09 a known incompatible document cannot displace a usable repeat to increase breadth', () => {
  const usable = Array.from({ length: 5 }, (_, i) => chunk('A', i)), wrong = chunk('wrong');
  const state = { status: 'not_applicable' as const, matched: [], missing: [], mismatched: ['实际阶段'] };
  assert.deepEqual(selectContextCandidates([wrong, ...usable], new Map([[wrong.id, state]])), usable);
});

test('K04 source diversity preserves both registered conflicting claims for the existing uncertainty guard', () => {
  const base = ['A', 'B'].flatMap(document => [chunk(document), chunk(document, 1)]);
  const pair = ['C', 'D'].map((document, i) => {
    const c = chunk(document), entry = professionalKnowledge(professionalEntry({
      conditions: [{ field: 'material', operator: 'in', values: ['合成板材'] }],
      claim: { key: '合成屏幕朝向', value: i ? '正对窗' : '侧向' },
    }), { adminId: '17', reviewedAt: '2026-10-18T00:00:00.000Z' })!;
    return { ...c, ref: { type: 'knowledge_chunk', id: c.id, version: document }, hash: 'synthetic-hash',
      professional: { documentId: document, title: '合成冲突资料', contentHash: 'synthetic-hash', entry,
        applicability: applicability(entry, {}), context: {} } };
  });
  const ranked = [...base, ...pair], states = new Map(pair.map(c => [c.id, c.professional.applicability]));
  const selected = selectContextCandidates(ranked, states);
  const conflicts = pair.filter(c => selected.includes(c));
  assert.equal(conflicts.length, 2, 'Both explicitly registered sides must reach the existing guard');
  assert.ok(conflicts.every(c => c.professional.applicability.status === 'unknown'));
  assert.equal(unresolvedSynthesisConflict(knowledgeSynthesisSources(conflicts)), true);
});
