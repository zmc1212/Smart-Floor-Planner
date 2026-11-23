import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { ActorContext } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { FollowupService } from '@/lib/construction/followup-service';
import { ConstructionService } from '@/lib/construction/service';

test('first consultation send and the follow-up list share a lock order and recheck current service', { timeout: 20000 }, async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
  assert.equal(target.pathname, '/xiaok_embedding_eval');
  assert.equal(target.port, process.env.XIAOK_ISOLATED_POSTGRES_PORT || '55432');

  const label = 'c01-first-send-lock-' + randomUUID();
  let fixture: { enterpriseId: string; ownerId: string; adminId: string; leadId: string } | undefined;
  try {
    fixture = await withPlatformTransaction(async tx => {
      const e = await one(tx, sql`insert into app.enterprises(name,code,status) values(${label},${label},'active') returning id`);
      const enterpriseId = String(e!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${enterpriseId},true,100,1200000,100000000,30)`);
      const u = await one(tx, sql`insert into app.users(nickname,context_version) values(${label},1) returning id`);
      const ownerId = String(u!.id);
      const a = await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
        values(${enterpriseId},${label},'test-only','enterprise_admin','active',false) returning id`);
      const l = await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${enterpriseId},${ownerId},${label},'13900000000','natural') returning id`);
      return { enterpriseId, ownerId, adminId: String(a!.id), leadId: String(l!.id) };
    });
    const { enterpriseId, ownerId, adminId, leadId } = fixture;
    const projects = new ConstructionService({ enterpriseId, adminId });
    const projectName = '【模拟】首发并发核对';
    const project = await projects.execute('create', { leadId, name: projectName, managerId: adminId, rooms: ['厨房'] }, randomUUID());
    const projectId = String(project.id);
    await projects.execute('update', { projectId, expectedVersion: Number(project.version), name: projectName, status: 'active', customerAccess: true }, randomUUID());
    const actor: ActorContext = {
      enterpriseId, principal: { kind: 'user', userId: ownerId }, contextVersion: 1,
      customerServiceRequired: true, capabilities: ['assistant.chat.self'],
      entry: { kind: 'identity', staffProfileLeadId: leadId },
    };
    const conversations = new ConversationService(actor);
    const followups = new FollowupService({ ...actor, capabilities: ['assistant.followup.self'] });
    const binding = await followups.open(randomUUID(), projectId);
    const cid = String((await conversations.create(randomUUID())).id);
    const clientMessageId = randomUUID();
    const content = { version: 1, blocks: [{ type: 'text', text: '我家厨房下周想贴木纹砖。师傅开工前一般怎么安排，有哪些事需要我先确认？' }] };
    let followupRead: Promise<PromiseSettledResult<Awaited<ReturnType<FollowupService['list']>>>[]> | undefined;

    const [send] = await Promise.allSettled([withTenantTransaction(enterpriseId, async tx => {
      // Hold the same settings lock as a normal send. Start the competing
      // follow-up read and wait until PostgreSQL confirms it is queued on it.
      await new AssistantRepository(tx, actor).settings(true);
      const { pid } = (await one<{ pid: number }>(tx, sql`select pg_backend_pid() as pid`))!;
      followupRead = Promise.allSettled([followups.list()]);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const waiter = await withPlatformTransaction(check => one<{ waiting: boolean }>(check, sql`
          select exists(select 1 from pg_stat_activity
            where ${pid}::integer = any(pg_blocking_pids(pid))
              and query like 'select * from app.assistant_enterprise_settings where%') as waiting`));
        waiting = waiter?.waiting === true;
        if (!waiting) await delay(40);
      }
      assert.ok(waiting, 'the follow-up read must contend with the first send');
      return new ConversationService(actor, tx).send(cid, clientMessageId, content);
    })]);
    const [followup] = await (followupRead || Promise.resolve([]));
    if (send.status === 'rejected') throw send.reason;
    if (followup?.status === 'rejected') throw followup.reason;
    assert.ok(followup?.value.items.some(item => item.bindingId === binding.bindingId));
    assert.ok(send.value.messageId && send.value.runId);
    const saved = await withTenantTransaction(enterpriseId, tx => one(tx, sql`
      select automatic_field_sources from app.assistant_renovation_profiles where enterprise_id=${enterpriseId} and lead_id=${leadId}`));
    assert.ok(Object.values(saved?.automatic_field_sources || {}).some(source =>
      (source as { messageId: string }).messageId === send.value.messageId));
    assert.deepEqual(await conversations.send(cid, clientMessageId, content), send.value);

    await withTenantTransaction(enterpriseId, tx => tx.execute(sql`update app.leads set archived_at=now() where id=${leadId}`));
    await assert.rejects(followups.list(), /assistant_resource_not_found/);
    await assert.rejects(conversations.detail(cid), /assistant_resource_not_found/);
  } finally {
    try {
      if (fixture) {
        const { enterpriseId, ownerId } = fixture;
        await withPlatformTransaction(async tx => {
          await deleteConstructionData(tx, BigInt(enterpriseId));
          await deleteAssistantData(tx, BigInt(enterpriseId));
          await tx.execute(sql`delete from app.leads where enterprise_id=${enterpriseId}`);
          await tx.execute(sql`delete from app.admin_users where enterprise_id=${enterpriseId}`);
          await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`);
          await tx.execute(sql`delete from app.users where id=${ownerId}`);
        });
      }
    } finally { await closePostgresPool(); }
  }
});
