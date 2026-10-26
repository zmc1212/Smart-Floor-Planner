import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { deletePortfolioData, portfolioCounts } from '@/db/repositories/portfolio-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const prefix = 'portrait-' + randomUUID();
const tenants: string[] = [], authors: string[] = [];

before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!;
      tenants.push(String(enterprise.id));
      const author = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(${tenants[i]},${prefix + i},'test-only','designer','active',false,${'肖像测试' + i}) returning id`))!;
      authors.push(String(author.id));
    }
  });
});

after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const enterpriseId of tenants) {
        await deletePortfolioData(tx, BigInt(enterpriseId));
        await tx.execute(sql`delete from app.admin_users where enterprise_id=${enterpriseId}`);
        await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`);
      }
    });
  } finally {
    await closePostgresPool();
  }
});

async function insertPortrait(tenant: string, enterprise: string, author: string, consentBy: string) {
  return withTenantTransaction(tenant, tx => tx.execute(sql`insert into app.portfolio_portraits(enterprise_id,author_id,image_base64,content_hash,consent_at,consent_by) values(${enterprise},${author},'test-image','hash',now(),${consentBy})`));
}

test('portrait is tenant isolated, unique per author and removed with portfolio data', async () => {
  await insertPortrait(tenants[0], tenants[0], authors[0], authors[0]);
  await assert.rejects(insertPortrait(tenants[0], tenants[0], authors[0], authors[0]), (error: unknown) => /portfolio_portraits_enterprise_id_author_id_key/.test(String((error as Error & { cause?: Error }).cause?.message ?? error)));
  await assert.rejects(insertPortrait(tenants[0], tenants[1], authors[1], authors[0]), (error: unknown) => /row-level security/.test(String((error as Error & { cause?: Error }).cause?.message ?? error)));
  assert.equal((await withTenantTransaction(tenants[1], async tx => (await tx.execute(sql`select id from app.portfolio_portraits`)).rowCount)), 0);
  assert.equal((await withTenantTransaction(tenants[0], async tx => (await tx.execute(sql`select id from app.portfolio_portraits`)).rowCount)), 1);
  await assert.rejects(
    withTenantTransaction(tenants[0], tx => tx.execute(sql`insert into app.portfolio_portraits(enterprise_id,author_id,image_base64,content_hash,consent_at,consent_by) values(${tenants[0]},${authors[0]},${'x'.repeat(409601)},'hash',now(),${authors[0]})`)),
    (error: unknown) => /portfolio_portraits_image_base64_check/.test(String((error as Error & { cause?: Error }).cause?.message ?? error))
  );
  const counts = await withPlatformTransaction(tx => portfolioCounts(tx, BigInt(tenants[0])));
  assert.equal(counts.find(item => item.table === 'portfolio_portraits')?.count, 1);
  await withPlatformTransaction(tx => deletePortfolioData(tx, BigInt(tenants[0])));
  assert.equal((await withPlatformTransaction(tx => portfolioCounts(tx, BigInt(tenants[0])))).find(item => item.table === 'portfolio_portraits')?.count, 0);
});
