import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { RequirementService } from '@/lib/assistant/requirements/service';
import { type ActorContext } from '@/lib/assistant/contracts';
import { append } from './agent-comparison';

// Deterministic regression only: isolated synthetic database, no model/embedding.
const root = path.resolve(process.cwd(), '..');
createRequire(path.join(root, 'admin/package.json'))('@next/env').loadEnvConfig(process.cwd(), true);
const configPath = path.join(root, 'tmp/xiaok-vector/connection.private.json');
const database = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const url = new URL(database);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432' && url.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = database;
const files = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z',
  'admin/src/lib/assistant', 'admin/src/db', 'admin/src/lib/postgresql.ts', 'admin/scripts/agent-comparison*',
  'admin/scripts/agent-contract-replay.ts', 'admin/tsconfig.json', 'admin/package.json', 'admin/package-lock.json'],
{ cwd: root, windowsHide: true, encoding: 'utf8' }).split('\0').filter(Boolean);
files.push('tmp/xiaok-vector/connection.private.json', 'admin/.env.local', 'admin/.env');
const binding = () => Object.fromEntries([...new Set(files)].sort().filter(f => fs.existsSync(path.join(root, f)))
  .map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const before = binding(), checks: string[] = [];
const output = path.join(root, 'tmp/agent-contract/review-replay-final.json');
let fixture: { enterpriseId: string; userId: string } | undefined;
let conversationId = '', cleaned = false;
async function main() {
  const code = 'synthetic-agent-review-replay-' + randomUUID();
  fixture = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · 提案重放边界',${code},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values('测试专用提案重放',1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${enterpriseId},true,100,200000,1000000,30)`);
    return { enterpriseId, userId };
  });
  const f = fixture;
  const actor: ActorContext = { enterpriseId: f.enterpriseId, principal: { kind: 'user', userId: f.userId }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
  conversationId = String((await new ConversationService(actor).create(randomUUID())).id);
  await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot || '{"requirementReviewMode":true}'::jsonb where enterprise_id=${f.enterpriseId} and id=${conversationId}`));
  await append({ ...f, actor, conversationId }, '我家90平。预算12万。');
  const req = new RequirementService(actor), source = await req.customerEvidence(conversationId);
  const input = { sourceSeq: source.sourceSeq, baseSummaryId: null,
    changes: [{ operation: 'add' as const, field: 'housing', sourceId: `c${source.messages[0].id}.0` }] };
  const key = randomUUID(), first = await req.propose(conversationId, key, input);
  assert.equal(first.kind, 'proposal');
  assert.deepEqual(await req.propose(conversationId, key, input), first); checks.push('unchangedReplayReturnsSameProposal');
  let guardCalls = 0;
  await assert.rejects(() => req.propose(conversationId, key, input, async () => { guardCalls++; throw new Error('test_guard_revoked'); }), /test_guard_revoked/);
  assert.equal(guardCalls, 1); checks.push('cachedReplayStillExecutesIntegrationGuard');
  await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1 where enterprise_id=${f.enterpriseId}`));
  assert.equal((await req.propose(conversationId, key, input)).kind, 'superseded');
  assert.equal((await req.read(conversationId)).proposal, null); checks.push('epochInvalidatedReplayReturnsNoDiff');
  const freshKey = randomUUID(), fresh = await req.propose(conversationId, freshKey, input);
  assert.equal(fresh.kind, 'proposal');
  await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_conversations set mode='handoff_requested' where enterprise_id=${f.enterpriseId} and id=${conversationId}`));
  await assert.rejects(() => req.propose(conversationId, freshKey, input), /context_changed/); checks.push('handoffModeBlocksCachedReplay');
  await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_conversations set mode='ai',status='closed' where enterprise_id=${f.enterpriseId} and id=${conversationId}`));
  await assert.rejects(() => req.propose(conversationId, freshKey, input), /context_changed/); checks.push('closedConversationBlocksCachedReplay');
  await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_conversations set status='open' where enterprise_id=${f.enterpriseId} and id=${conversationId}`));
  const pending = (await req.read(conversationId)).proposal!;
  const draft = await req.write(conversationId, randomUUID(), { action: 'apply_proposal', proposalId: pending.id, digest: pending.digest, consent: true });
  assert.equal(draft.status, 'draft'); assert.equal(draft.confirmedFields, null);
  assert.equal((await req.propose(conversationId, freshKey, input)).kind, 'superseded'); checks.push('appliedReplayDoesNotRestorePendingDiff');
  const next = { ...input, baseSummaryId: draft.id, changes: [{ operation: 'add' as const, field: 'budget', sourceId: `c${source.messages[0].id}.1` }] };
  const nextKey = randomUUID(); await req.propose(conversationId, nextKey, next);
  await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_requirement_summaries set version=version+1 where enterprise_id=${f.enterpriseId} and id=${draft.id}`));
  assert.equal((await req.propose(conversationId, nextKey, next)).kind, 'superseded'); checks.push('changedBaseVersionReplayReturnsNoDiff');
  const count = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_requirement_summaries where enterprise_id=${f.enterpriseId} and conversation_id=${conversationId}`));
  assert.equal(count!.n, 1); checks.push('onlyExplicitCustomerAcceptanceWritesOneDraft');
}
async function run() {
let error: string | undefined;
try { await main(); } catch (e) { error = e instanceof Error ? e.message : String(e); process.exitCode = 1; }
finally {
  if (fixture) {
    const f = fixture;
    await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);
      await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`);
    });
    cleaned = true;
  }
  const after = binding(), drift = Object.keys(before).filter(f => before[f] !== after[f]);
  if (drift.length) process.exitCode = 1;
  fs.writeFileSync(output, JSON.stringify({ fixture, conversationId, checks, error, before, after, drift, cleaned, modelCalls: 0 }, null, 2));
  await closePostgresPool();
  console.log(JSON.stringify({ checks: checks.length, error, drift, cleaned, modelCalls: 0, output: path.relative(root, output) }));
}
}
void run().catch(() => { process.exitCode = 1; });
