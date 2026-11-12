import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { appendMessage, ConversationService, newRun } from '@/lib/assistant/core/conversation';
import { publicIntroEntryDecision } from '@/lib/construction/public-customer';
import type { ActorContext } from '@/lib/assistant/contracts';

const prefix = 'assistant-public-intro-retry-' + process.pid + '-' + Date.now();
const tenants: string[] = []; const userIds: string[] = [];
let actor: ActorContext; let service: ConversationService; let eventVersion = 0;
const content = (text: string) => ({ version: 1 as const, blocks: [{ type: 'text' as const, text }] });

before(async () => {
  loadEnvConfig(process.cwd());
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(resolvePostgresRuntimeConfig().connectionString).hostname));
  await withPlatformTransaction(async tx => {
    const tenant = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!;
    tenants.push(String(tenant.id));
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${String(tenant.id)},true,100,1200000,100000000,90)`);
    const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!;
    userIds.push(String(user.id));
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(user.id)},${prefix + '-openid'})`);
  });
  actor = { enterpriseId: tenants[0], principal: { kind: 'user', userId: userIds[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  service = new ConversationService(actor);
});
after(async () => {
  await withPlatformTransaction(async tx => {
    for (const tenant of tenants) {
      await deleteAssistantData(tx, BigInt(tenant));
      await tx.execute(sql`delete from app.enterprises where id=${tenant}`);
    }
    for (const user of userIds) await tx.execute(sql`delete from app.users where id=${user}`);
  });
  await closePostgresPool();
});

async function conversation() { return String((await service.create('create-' + crypto.randomUUID())).id); }

// The opening trigger is a real system message; its event id is the outbox row
// the production public-context path also writes.
async function openingRun(tx: PostgresTransaction, cid: string, text: string) {
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},'test.public.intro.v1','assistant_conversation',${cid},${++eventVersion},'{"kind":"system"}',${prefix},'{}'::jsonb) returning id`))!;
  const message = await appendMessage(tx, actor, cid, { author: 'system', eventId: String(event.id), purpose: 'construction.public.context', content: content(text) });
  const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${cid} for update`))!;
  const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`))!;
  const run = await newRun(tx, actor, c, settings, String(message.id), undefined, { kind: 'user_message', messageId: String(message.id) }, 'public.site.intro');
  await tx.execute(sql`update app.assistant_runs set status='failed',error_code='model_unavailable',completed_at=now()
    where enterprise_id=${actor.enterpriseId} and id=${run.runId}`);
  // A resident worker polls this database; a queued job would be claimed and
  // would rewrite the run or call a real model before the test commits.
  await tx.execute(sql`update app.assistant_jobs set status='failed',lease_token=null,updated_at=now()
    where enterprise_id=${actor.enterpriseId} and run_id=${run.runId}`);
  return run.runId;
}

async function snapshot(cid: string) {
  const row = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations
    where enterprise_id=${actor.enterpriseId} and id=${cid}`));
  return row!.entry_snapshot as Row;
}

test('an opening cannot retry when its selected publication is unavailable', async () => {
  const cid = await conversation();
  const siteId = '9001', versionId = '9101';
  const original = await withTenantTransaction(actor.enterpriseId, async tx => {
    const runId = await openingRun(tx, cid, '正在围观：城西新家。');
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=${JSON.stringify({
      activePublicSite: { siteId, versionId }, publicIntros: [{ siteId, versionId, attempts: 1, runId }],
    })}::jsonb where enterprise_id=${actor.enterpriseId} and id=${cid}`);
    return runId;
  });

  await assert.rejects(service.run(original, 'retry', 'retry-' + crypto.randomUUID()), /public_site_unavailable/);
  const intros = (await snapshot(cid)).publicIntros as Row[];
  assert.deepEqual(intros, [{ siteId, versionId, attempts: 1, runId: original }]);
  assert.equal(publicIntroEntryDecision(intros[0] as { attempts?: number }, 'succeeded'), 'existing');
});

test('retrying an opening after the visitor switched sites is rejected without side effects', async () => {
  const cid = await conversation();
  const oldSite = { siteId: '9002', versionId: '9102' }, newSite = { siteId: '9003', versionId: '9103' };
  const runs = await withTenantTransaction(actor.enterpriseId, async tx => {
    const oldRun = await openingRun(tx, cid, '正在围观：旧工地。');
    const newRunId = await openingRun(tx, cid, '正在围观：新工地。');
    const intros = [{ ...oldSite, attempts: 1, runId: oldRun }, { ...newSite, attempts: 1, runId: newRunId }];
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=${JSON.stringify({ activePublicSite: newSite, publicIntros: intros })}::jsonb
      where enterprise_id=${actor.enterpriseId} and id=${cid}`);
    return { oldRun, newRunId, intros };
  });

  await assert.rejects(service.run(runs.oldRun, 'retry', 'retry-' + crypto.randomUUID()), /context_changed/);

  const count = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select count(*) n from app.assistant_runs
    where enterprise_id=${actor.enterpriseId} and conversation_id=${cid}`));
  assert.equal(Number(count!.n), 2);
  const entry = await snapshot(cid);
  assert.deepEqual(entry.publicIntros, runs.intros);
});
