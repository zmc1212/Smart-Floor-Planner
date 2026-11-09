/* eslint-disable @typescript-eslint/no-explicit-any -- read-only customer-text acceptance */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);
const originalDatabase = process.env.DATABASE_URL;
process.env.DATABASE_URL = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8')).DATABASE_URL;

const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
require(path.resolve('src/lib/assistant/application/worker.ts'));
const { queryBusiness } = require(path.resolve('src/lib/assistant/agent/business-tools.ts'));
const { one } = require(path.resolve('src/db/repositories/assistant-repository.ts'));

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'snapshot-display-01';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('../tmp/xiaok-fastgpt-agentv2-model-switch-20261109');
const out = path.join(evidence, 'snapshot-display-' + label);
assert.ok(!fs.existsSync(path.join(out, 'assessment.json')), 'Preserve every original batch');
fs.mkdirSync(out, { recursive: true });

const u = await withPlatformTransaction((tx: any) => one(tx, sql`select id,context_version from app.users where id='645'`));
assert.ok(u, 'Eval user 645 must exist');
const actor = { enterpriseId: '1454', principal: { kind: 'user', userId: '645' }, contextVersion: Number(u.context_version), capabilities: ['assistant.chat.self'] };
const snapshot = await withTenantTransaction('1454', async (tx: any) => {
  const schemes = await queryBusiness(tx, actor, { domain: 'schemes', leadId: '' }, 'probe');
  const construction = await queryBusiness(tx, actor, { domain: 'construction', leadId: '' }, 'probe');
  return { leads: schemes.leadIds, schemesRows: Array.isArray(schemes.data) ? schemes.data.length : 0, schemesText: schemes.displayText,
    constructionRows: Array.isArray(construction.data) ? construction.data.length : 0, constructionText: construction.displayText };
});

assert.ok(snapshot.schemesRows > 0, 'The schemes probe must read real publications');
assert.ok(snapshot.constructionRows > 0, 'The construction probe must read real published records');
assert.doesNotMatch(snapshot.schemesText, /（\d+）|发布记录\d+/, 'Scheme text must not expose lead or publication IDs');
assert.doesNotMatch(snapshot.constructionText, /记录\d+|版本\d+/, 'Construction text must not expose record IDs or versions');
const assessment = { status: 'passed', label, enterpriseId: '1454', user: '645', source: {
  commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  files: Object.fromEntries(['src/lib/assistant/agent/business-tools.ts', 'src/lib/construction/customer.ts', 'scripts/fastgpt/agent-v2-snapshot-display-probe.mts']
    .map(file => [file, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex')])) },
  snapshot, checks: { schemesNonVacuous: true, constructionNonVacuous: true, noInternalIds: true } };
fs.writeFileSync(path.join(out, 'assessment.json'), JSON.stringify(assessment, null, 2));
console.log(JSON.stringify({ passed: true, schemesRows: snapshot.schemesRows, constructionRows: snapshot.constructionRows, checks: assessment.checks }, null, 2));
await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool();
if (originalDatabase) process.env.DATABASE_URL = originalDatabase;
