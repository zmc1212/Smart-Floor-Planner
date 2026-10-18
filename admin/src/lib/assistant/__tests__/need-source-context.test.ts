import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresTransaction } from '@/db/transaction';
import { applyNeedDelta, assertRecordedReply, needWriteFeedback, parseNeedDelta, readMemory, type NeedFact } from '../agent/memory';
import { availableNeedMemory } from '../agent/memory-sources';

const save = (text: string, value: string, quote = value, room = '书房') => applyNeedDelta(readMemory({}),
  parseNeedDelta({ room, field: 'use', value, quote, sourceMessageId: '1', expectedVersion: 0 }),
  { id: '1', text }, 'synthetic-source-context', '');

test('cropped explicit denial or undecided use is not a positive customer fact', () => {
  for (const text of [
    '书房不再单人办公，请记录当前情况。',
    '书房不是单人办公，是双人办公，请记录。',
    '书房是否要单人办公还没确定，请记录现在人数未定。',
    '书房单人办公还没定，请记录人数未定。',
    '书房单人办公不需要了，请记录。',
    '书房暂定单人办公，请记录待确认状态。',
    '书房单人办公需要再确认，请记录人数未定。',
    '书房单人办公已经取消了，请记录。',
  ]) assert.throws(() => save(text, '单人办公'), /need_source_mismatch/, text);
});

test('the latest direct same-room assertion controls, without borrowing a different quoted occurrence', () => {
  assert.throws(() => save('书房单人办公。更正一下，书房不再单人办公，请记录。', '单人办公', '书房单人办公'), /need_source_mismatch/);
  assert.equal(save('书房不是单人办公。现在书房确定单人办公，请记录。', '单人办公').facts[0].value, '单人办公');
  assert.throws(() => save('书房不是单人办公。现在书房确定单人办公，请记录。', '单人办公', '不是单人办公'), /need_source_mismatch/);
});

test('another explicitly named room cannot supply the requested room value or an abbreviated quote', () => {
  for (const text of ['书房单人办公。客厅双人办公，请记录。', '书房单人办公，客厅双人办公，请记录。']) {
    for (const quote of ['双人办公', '客厅双人办公']) assert.throws(() => save(text, '双人办公', quote), /need_source_mismatch/, text + quote);
  }
  assert.throws(() => save('客厅双人办公。书房先不改。', '双人办公', '双人办公。书房先不改'), /need_source_mismatch/);
});

test('supported affirmative corrections, shared-room subjects and full signed statements remain literal', () => {
  for (const [text, value, quote, room] of [
    ['书房不是双人办公，而是单人办公，请记录。', '单人办公', '单人办公', '书房'],
    ['书房不是双人办公而是单人办公，请记录。', '单人办公', '单人办公', '书房'],
    ['书房靠窗，单人办公，请记录。', '单人办公', '单人办公', '书房'],
    ['书房和客厅都单人办公，请记录。', '单人办公', '单人办公', '书房'],
    ['书房和客厅都单人办公，请记录。', '单人办公', '单人办公', '客厅'],
    ['书房不需要双人办公，请记录。', '不需要双人办公', '不需要双人办公', '书房'],
    ['书房人数未定，请记录。', '人数未定', '人数未定', '书房'],
    ['书房暂定单人办公，请记录。', '暂定单人办公', '暂定单人办公', '书房'],
    ['书房单人办公待确认，请记录。', '单人办公待确认', '单人办公待确认', '书房'],
    ['单人办公，书房就这样定，请记录。', '单人办公', '单人办公，书房就这样定', '书房'],
  ]) assert.equal(save(text, value, quote, room).facts[0].value, value, text);
});

test('reported/hypothetical mentions do not override a direct assertion or repair an unsupported quote', () => {
  assert.equal(save('书房单人办公。假如书房不再单人办公，会怎样？', '单人办公').facts[0].value, '单人办公');
  assert.throws(() => save('书房不是单人办公。设计师说书房单人办公。', '单人办公'), /need_source_mismatch/);
  assert.throws(() => save('书房不是单人办公。现在书房单人办公，请记录。', '单人办公', '不是单人办公'), /need_source_mismatch/);
});

test('rejected extraction leaves immutable memory intact and cannot authorize a save acknowledgement', () => {
  const memory = save('书房双人办公，请记录。', '双人办公');
  const before = structuredClone(memory), text = '书房不再单人办公，请记录当前情况。';
  try {
    applyNeedDelta(memory, parseNeedDelta({ room: '书房', field: 'use', value: '单人办公', quote: '单人办公', sourceMessageId: '2', expectedVersion: 1 }),
      { id: '2', text }, 'synthetic-next:need', '');
    assert.fail('unsupported extraction must fail');
  } catch (error) {
    const feedback = needWriteFeedback(error, text);
    assert.equal(feedback?.status, 'not_saved');
    assert.equal(feedback?.error, 'need_source_mismatch');
    assert.equal(feedback?.sourceText, text);
    assert.match(feedback!.instructions, /保留否定和未定/);
  }
  assert.deepEqual(memory, before);
  assert.throws(() => assertRecordedReply('已按你的更正更新了。', memory, 'synthetic-next'), /unsupported_model_commitment/);
  assert.strictEqual(applyNeedDelta(memory, parseNeedDelta({ room: '书房', field: 'use', value: '双人办公', quote: '双人办公', sourceMessageId: '1', expectedVersion: 0 }),
    { id: '1', text: '书房双人办公，请记录。' }, 'synthetic-source-context', ''), memory);
});

function storedFact(id: string, value: string, field: NeedFact['field'] = 'use', room = '书房'): NeedFact {
  return { id: 'synthetic:' + id, room, field, value, quote: value, sourceMessageId: id,
    provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: '' };
}

/** Executes the real projection and SQL guards against explicitly synthetic rows.
 * This is an offline repository double, not database/RLS integration evidence. */
function projectionRows(originals: Map<string, string>, sourceRefs: string[] = [], sourceAvailable = true) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const tx = { execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
    const q = new PgDialect().sqlToQuery(query); queries.push(q);
    assert.ok(!/insert|update\s+app\.|delete\s+from/.test(q.sql));
    assert.ok(q.params.includes('101'), 'enterprise scope remains bound');
    if (!q.sql.includes('select version from app.construction_stage_settings')) assert.ok(q.params.includes('202'), 'consultation scope remains bound');
    if (q.sql.includes('select content from app.assistant_messages')) {
      assert.match(q.sql, /author_kind='user' for share/);
      const text = originals.get(String(q.params[2]));
      return { rows: text === undefined ? [] : [{ content: { blocks: [{ type: 'text', text }] } }] };
    }
    if (q.sql.includes('select s.source_refs')) return { rows: sourceRefs.length ? [{ source_refs: sourceRefs }] : [] };
    if (q.sql.includes('join app.domain_event_outbox')) return { rows: sourceAvailable
      ? [{ aggregate_id: '303', aggregate_version: 1, payload: {}, purpose: 'construction.stage' }] : [] };
    if (q.sql.includes('select version from app.construction_stage_settings')) return { rows: [{ version: 1 }] };
    if (q.sql.includes('select p.id from app.construction_projects')) return { rows: [{ id: '303' }] };
    throw Error('Unexpected projection SQL: ' + q.sql);
  } } as unknown as PostgresTransaction;
  return { tx, queries };
}

test('reentry excludes a cropped old fact without reviving mixed occupancy or changing its audit chain', async () => {
  const facts = [storedFact('1', '双人办公、书桌靠窗', 'desk'), storedFact('2', '单人办公'), storedFact('3', '电脑和台灯', 'devices')];
  const entry = { agentMemory: { version: 3, facts } }, before = structuredClone(entry);
  const source = projectionRows(new Map([['1', '书房双人办公、书桌靠窗。'], ['2', '书房不再单人办公，请记录。'], ['3', '书房电脑和台灯继续保留。']]));
  for (let i = 0; i < 2; i++) {
    const current = await availableNeedMemory(source.tx, '101', '202', entry);
    assert.equal(current.version, 3);
    assert.deepEqual(current.facts.map(f => f.id), ['synthetic:1', 'synthetic:3']);
    assert.deepEqual(current.interpretations, [{ factId: 'synthetic:1', field: 'use', currentFactId: null }]);
    assert.deepEqual(entry, before);
  }
});

test('projection retains literal negative/unknown values, filters other-room values, and preserves source revocation', async () => {
  const facts = [storedFact('1', '不需要双人办公'), storedFact('2', '人数未定'), storedFact('3', '双人办公'), storedFact('4', '单人办公')];
  const originals = new Map([['1', '书房不需要双人办公。'], ['2', '书房人数未定。'], ['3', '书房单人办公。客厅双人办公。'], ['4', '书房单人办公。']]);
  const entry = { agentMemory: { version: 4, facts } }, before = structuredClone(entry);
  const allowed = projectionRows(originals, ['505']);
  assert.deepEqual((await availableNeedMemory(allowed.tx, '101', '202', entry)).facts.map(f => f.id), ['synthetic:1', 'synthetic:2', 'synthetic:4']);
  assert.equal(allowed.queries.filter(q => q.sql.includes('join app.domain_event_outbox')).length, 1);
  const revoked = projectionRows(originals, ['505'], false);
  assert.deepEqual((await availableNeedMemory(revoked.tx, '101', '202', entry)).facts, []);
  assert.equal(revoked.queries.filter(q => q.sql.includes('join app.domain_event_outbox')).length, 1);
  const missing = projectionRows(new Map());
  assert.deepEqual((await availableNeedMemory(missing.tx, '101', '202', entry)).facts, []);
  assert.equal(missing.queries.filter(q => q.sql.includes('select s.source_refs')).length, 0);
  assert.deepEqual(entry, before);
});
