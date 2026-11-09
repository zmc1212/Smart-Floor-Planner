import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '../../src/db/transaction';
import { closePostgresPool } from '../../src/lib/postgresql';
import { rows } from '../../src/db/repositories/assistant-repository';
import { embeddingGateway, EMBEDDING_PROFILE as profile } from '../../src/lib/assistant/infrastructure/embedding-gateway';
import { chineseTerms, fuseAuthorizedCandidates } from '../../src/lib/assistant/knowledge/chinese-lexical';
import { documents, unanswerable } from './recall-fixture';

async function main() {
  for (const key of ['DATABASE_URL', 'EMBEDDING_EVAL_OWNER_URL']) {
    const url = new URL(process.env[key]!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432' && url.pathname === '/xiaok_embedding_eval', 'isolated clone required');
  }
  const owner = new Pool({ connectionString: process.env.EMBEDDING_EVAL_OWNER_URL });
  try {
    await owner.query('drop table if exists app.assistant_embedding_probe');
    await owner.query(await readFile(new URL('./vector-probe.sql', import.meta.url), 'utf8'));
    const tenantIds: string[] = [];
    for (const label of ['a', 'b']) {
      const result = await owner.query("insert into app.enterprises(name,code,status) values($1,$1,'active') returning id", ['embedding-probe-' + label + '-' + Date.now()]);
      tenantIds.push(String(result.rows[0].id));
    }
    const gateway = embeddingGateway();
    let inputTokens = 0;
    const vectors: number[][] = [];
    for (let i = 0; i < documents.length; i += 8) {
      const batch = await gateway.embed(documents.slice(i, i + 8).map(d => d[1]), 'document');
      assert.ok(batch.usage); inputTokens += batch.usage.inputTokens; vectors.push(...batch.vectors);
    }
    for (const tenant of tenantIds) {
      await withTenantTransaction(tenant, async tx => {
        for (let i = 0; i < documents.length; i++) {
          const [id, body] = documents[i];
          await tx.execute(sql`insert into app.assistant_embedding_probe(enterprise_id,id,profile,body,terms,embedding)
            values(${tenant},${id},${profile.id},${body},ARRAY(select jsonb_array_elements_text(${JSON.stringify(chineseTerms(body))}::jsonb)),${JSON.stringify(vectors[i])}::vector)`);
        }
      });
    }
    // Exact matching decoys must be rejected BEFORE ranking, including same-dimensional other profiles.
    const variants = [
      ['draft', "state='draft'"], ['internal', "audience='internal'"], ['future', "valid_from='2099-01-01'"],
      ['expired', "valid_until='2020-01-01'"], ['retired', "state='retired'"], ['old-version', 'published_version=2'],
      ['other-profile', "profile='different-1024-model'"],
    ];
    for (const [name, update] of variants) {
      await owner.query(`insert into app.assistant_embedding_probe select enterprise_id,$1,profile,version,published_version,audience,state,valid_from,valid_until,body,terms,embedding from app.assistant_embedding_probe where enterprise_id=$2 and id='water'`, ['decoy-' + name, tenantIds[0]]);
      await owner.query(`update app.assistant_embedding_probe set ${update} where enterprise_id=$1 and id=$2`, [tenantIds[0], 'decoy-' + name]);
    }
    const role = await withTenantTransaction(tenantIds[0], tx => rows(tx, sql`select rolname,rolsuper,rolbypassrls from pg_roles where rolname=current_user`));
    assert.equal(role[0].rolsuper, false); assert.equal(role[0].rolbypassrls, false);
    const visible = await withTenantTransaction(tenantIds[0], tx => rows(tx, sql`select distinct enterprise_id from app.assistant_embedding_probe`));
    assert.deepEqual(visible.map(r => String(r.enterprise_id)), [tenantIds[0]]);
    await assert.rejects(withTenantTransaction(tenantIds[0], tx => tx.execute(sql`insert into app.assistant_embedding_probe(enterprise_id,id,profile,body,terms,embedding)
      values(${tenantIds[1]},'forged',${profile.id},'forged','{}',${JSON.stringify(vectors[0])}::vector)`)));
    type Candidate = { id: string; distance: number; terms: string[]; enterprise_id: string };
    async function retrieve(query: string) {
      const encoded = await gateway.embed([query], 'query');
      assert.ok(encoded.usage); inputTokens += encoded.usage.inputTokens;
      const candidates = await withTenantTransaction(tenantIds[0], tx => rows(tx, sql`
        select id,enterprise_id,terms,embedding <=> ${JSON.stringify(encoded.vectors[0])}::vector as distance
        from app.assistant_embedding_probe
        where enterprise_id=${tenantIds[0]} and profile=${profile.id} and audience='customer_public'
          and state='published' and version=published_version and valid_from<=now() and (valid_until is null or valid_until>now())
        order by distance,id`)) as Candidate[];
      assert.equal(candidates.length, documents.length);
      assert.ok(candidates.every(c => String(c.enterprise_id) === tenantIds[0] && !c.id.startsWith('decoy-')));
      return { vector: candidates.slice(0, 5), hybrid: fuseAuthorizedCandidates(candidates, query) };
    }
    let vectorHits = 0; let hybridHits = 0;
    const misses: string[] = [];
    for (const [id, , ...questions] of documents) for (const query of questions) {
      const result = await retrieve(query);
      if (result.vector.some(c => c.id === id)) vectorHits++;
      if (result.hybrid.some(c => c.id === id)) hybridHits++; else misses.push(query);
    }
    const noAnswer: Array<{ query: string; topCosine: number }> = [];
    for (const query of unanswerable) {
      const result = await retrieve(query);
      noAnswer.push({ query, topCosine: 1 - result.vector[0].distance });
    }
    // Warm up, then measure 50 queries in 10 batches of 5 concurrent requests over the actual tunnel.
    await gateway.embed(['水电改造如何验收？'], 'query');
    const latencies: number[] = [];
    const start = performance.now();
    for (let i = 0; i < 10; i++) await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      const begin = performance.now(); await gateway.embed([documents[(i * 5 + index) % documents.length][2]], 'query');
      latencies.push(performance.now() - begin);
    }));
    latencies.sort((a, b) => a - b);
    const report = { profile, fixture: 'synthetic dependency acceptance; not A10', answerable: 50, vectorHits, hybridHits,
      vectorRecallAt5: vectorHits / 50, hybridRecallAt5: hybridHits / 50, misses,
      unanswerable: { count: noAnswer.length, handling: 'ranking-only; no company answer generated; refusal calibration belongs to 1B', results: noAnswer },
      isolation: { unauthorizedReturned: 0, tenantRead: 'passed', tenantWrite: 'passed', filteredVariants: variants.map(v => v[0]), role: role[0] },
      measuredInputTokens: inputTokens, performance: { concurrency: 5, requests: 50, p95Ms: latencies[47], maxMs: latencies[49], queriesPerSecond: 50000 / (performance.now() - start) },
      tenantIds };
    await writeFile(new URL('../../../tmp/xiaok-embedding-evaluation.json', import.meta.url), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, unanswerable: { ...report.unanswerable, results: undefined } }, null, 2));
    assert.ok(hybridHits >= 45, 'Recall@5 below 90%');
  } finally { await owner.end(); await closePostgresPool(); }
}
main().catch(error => { console.error(error.cause?.message ?? error.message ?? 'evaluation_failed'); process.exitCode = 1; });
