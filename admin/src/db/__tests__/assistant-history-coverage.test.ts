import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
// Match the service bootstrap order for the existing source/Worker dependency cycle.
import '@/lib/assistant/agent/worker';
import { recallHistory, historyRefsAvailable, type HistorySnapshot } from '@/lib/assistant/agent/history';
import { fingerprint, safeText, type ActorContext } from '@/lib/assistant/contracts';

const question = '最开始我对书房和客厅怎么说，后来改了哪一项？';
const content = (text: string) => ({ version: 1, blocks: [{ type: 'text', text }] });
before(() => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
});
after(closePostgresPool);

/** Real SQL under forced tenant RLS; roll back only this synthetic transaction.
 * No Worker, provider, customer data, or unrelated cleanup schema is involved. */
async function fixture(check: (tx: PostgresTransaction, actor: ActorContext, c: Row, originals: Row[]) => Promise<void>) {
  const rollback = new Error('synthetic-history-coverage-rollback');
  try {
    await withPlatformTransaction(async tx => {
      const prefix = 'synthetic-history-coverage-' + randomUUID();
      const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status)
        values(${prefix},${prefix},'active') returning id`))!.id);
      const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
      const c = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
        values(${enterpriseId},'customer_consultation','{}'::jsonb,1) returning *`))!;
      const originals: Row[] = [];
      const texts = ['请记下：书房书桌靠窗，保留收纳。', '请记下：客厅不要投影设备。',
        '更正并请保存：书房书桌从靠窗改为靠内墙；书房保留收纳，客厅不要投影设备，装修日期未定，这些保持不变。',
        ...Array.from({ length: 30 }, () => question + '只回顾本咨询原话，区分最初说法和当前更正；不要查企业资料或项目，也不要新增保存。')];
      for (const [i, text] of texts.entries()) originals.push((await one(tx, sql`insert into app.assistant_messages
        (enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
        values(${enterpriseId},${String(c.id)},${i + 1},'user',${userId},${JSON.stringify(content(text))}::jsonb,'synthetic.history') returning *`))!);
      const fact = (id: string, source: number, room: string, field: string, status = 'current', supersedes: string | null = null) => ({
        id, room, field, status, supersedes, sourceMessageId: String(originals[source].id), provenance: 'customer_statement',
        quote: safeText(originals[source].content as Parameters<typeof safeText>[0]), value: safeText(originals[source].content as Parameters<typeof safeText>[0]), createdAt: new Date().toISOString(),
      });
      c.entry_snapshot = { agentMemory: { version: 4, facts: [fact('old-desk', 0, '书房', 'desk', 'superseded'),
        fact('old-living', 1, '客厅', 'devices', 'superseded'), fact('desk', 2, '书房', 'desk', 'current', 'old-desk'),
        fact('living', 2, '客厅', 'devices', 'current', 'old-living')] } };
      await tx.execute(sql`update app.assistant_conversations set entry_snapshot=${JSON.stringify(c.entry_snapshot)}::jsonb
        where enterprise_id=${enterpriseId} and id=${String(c.id)}`);
      await tx.execute(sql`select set_config('app.current_enterprise_id',${enterpriseId},true),set_config('app.is_platform_admin','false',true)`);
      const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
      await check(tx, actor, c, originals);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

function bounded(snapshot: HistorySnapshot) {
  assert.ok(snapshot.sources.length <= 4);
  assert.ok(snapshot.sources.reduce((n, source) => n + Buffer.byteLength(JSON.stringify(source)), 0) <= 7000);
}

test('AG01: repeated questions cannot displace the initial room originals and current correction', async () => {
  await fixture(async (tx, actor, c, originals) => {
    const before = JSON.stringify(c.entry_snapshot);
    const result = await recallHistory(tx, actor, c, '999999999', question);
    for (const original of originals.slice(0, 3)) {
      const source = result.sources.find(s => s.messageId === String(original.id));
      assert.ok(source, safeText(original.content as Parameters<typeof safeText>[0]));
      assert.equal(source.text, safeText(original.content as Parameters<typeof safeText>[0]));
      assert.equal(source.hash, fingerprint(original.content)); assert.equal(source.memoryVersion, 4);
    }
    bounded(result); assert.equal(result.hasMore, true);
    assert.equal(JSON.stringify(c.entry_snapshot), before);
    assert.equal(await historyRefsAvailable(tx, actor.enterpriseId, String(c.id), result.sources), true);
  });
});

test('AG07: source-backed priority retains cutoff, customer, consultation and tenant boundaries', async () => {
  await fixture(async (tx, actor, c, originals) => {
    const cutoff = await recallHistory(tx, actor, c, String(originals[2].seq), question);
    assert.deepEqual(cutoff.sources.map(s => s.messageId), originals.slice(0, 2).map(s => String(s.id)));
    const other = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
      values(${actor.enterpriseId},'customer_consultation','{}'::jsonb,1) returning *`))!;
    other.entry_snapshot = c.entry_snapshot;
    assert.deepEqual((await recallHistory(tx, actor, other, '999999999', question)).sources, []);
    assert.deepEqual((await recallHistory(tx, { ...actor, principal: { kind: 'user', userId: '0' } }, c, '999999999', question)).sources, []);
    assert.deepEqual((await recallHistory(tx, { ...actor, enterpriseId: '0' }, c, '999999999', question)).sources, []);
    bounded(cutoff);
  });
});

test('AG07: withdrawing the current correction blocks its older room sources and previously derived refs', async () => {
  await fixture(async (tx, actor, c, originals) => {
    const before = await recallHistory(tx, actor, c, '999999999', question);
    await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify(content('合成更正原话已撤回'))}::jsonb
      where enterprise_id=${actor.enterpriseId} and id=${String(originals[2].id)}`);
    const after = await recallHistory(tx, actor, c, '999999999', question);
    assert.ok(after.sources.every(s => !originals.slice(0, 3).some(original => String(original.id) === s.messageId)));
    assert.equal(await historyRefsAvailable(tx, actor.enterpriseId, String(c.id), before.sources), false);
    bounded(after);
  });
});

test('AG01: oversized recorded originals are omitted whole while other origins remain available', async () => {
  await fixture(async (tx, actor, c, originals) => {
    const oversized = '请记下：客厅' + '条件'.repeat(2500) + '不要投影设备。';
    await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify(content(oversized))}::jsonb
      where enterprise_id=${actor.enterpriseId} and id=${String(originals[1].id)}`);
    const result = await recallHistory(tx, actor, c, '999999999', question);
    assert.equal(result.oversized, true); assert.equal(result.hasMore, true);
    assert.ok(!result.sources.some(s => s.messageId === String(originals[1].id)));
    assert.ok(result.sources.some(s => s.messageId === String(originals[2].id)));
    assert.doesNotMatch(JSON.stringify(result), /条件/); bounded(result);
  });
});
