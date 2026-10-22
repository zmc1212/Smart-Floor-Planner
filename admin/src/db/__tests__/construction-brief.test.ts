import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { waitingFact } from '@/lib/construction/brief';
import type { IssueView } from '@/lib/construction/site-issues';
import { currentRecord } from '@/lib/construction/site-issues';

test('brief distinguishes replies, exact plan decisions and formal execution without inferring deadlines or approval', () => {
  const base = { sourceAvailable: true, status: 'awaiting_review', ownerId: '1', ownerName: '设计师' } as IssueView;
  assert.equal(waitingFact(base).label, '待核对');
  assert.equal(waitingFact(base, { status: 'pending_customer', id: '2' }).waitingFor, '客户');
  assert.equal(waitingFact(base, { status: 'approved', id: '2' }).label, '待现场落实');
  for (const [status, label] of [['implemented','待管理核对'],['resolved','待关闭'],['closed','已关闭']]) assert.equal(waitingFact({ ...base, status }, { status: 'approved', id: '2' }).label, label);
  assert.equal(waitingFact({ ...base, status: 'invalidated' }, { status: 'approved', id: '2' }).label, '待重新核对');
  assert.equal(waitingFact({ ...base, sourceAvailable: false, status: 'cancelled' }).label, '已取消');
});

test('two-site brief reads real writes, follows the same issue, refreshes, reenters and revokes within project/tenant/management scope', async () => {
  const u = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(u.port, '55432'); assert.equal(u.pathname, '/xiaok_embedding_eval');
  const prefix = 'synthetic-ops-01-' + randomUUID(), eids: string[] = [], aids: string[] = []; let uid = '';
  try {
    await withPlatformTransaction(async tx => {
      for (let i = 0; i < 2; i++) eids.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));
      for (const eid of eids) await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,200,12000000,1000000000,30)`);
      for (const [i,role] of ['enterprise_admin','construction_staff','designer','admin','super_admin'].entries()) aids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${i > 2 ? null : eids[0]},${prefix+i},'unusable-test-only',${role},'active',false,${['合成老板','合成经理','合成设计师','合成平台管理','合成超管'][i]}) returning id`))!.id));
      uid = String((await one(tx, sql`insert into app.users(nickname) values(${prefix}) returning id`))!.id);
    });
    const eid = eids[0], owner = new ConstructionService({ enterpriseId: eid, adminId: aids[0] });
    const manager = new ConstructionService({ enterpriseId: eid, adminId: aids[1] }), boss = new SiteChatService(owner.actor);
    const staff = new SiteChatService(manager.actor), designer = new SiteChatService({ enterpriseId: eid, adminId: aids[2] });
    const leadId = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},${prefix},'13800000000','natural') returning id`)))!.id);
    const pids: string[] = [], rids: string[] = [], iids: string[] = [];
    const change = async (pid: string, aid: string, role: string, active: boolean) => owner.execute('member', { projectId: pid, expectedVersion: ((await owner.execute('detail', { projectId: pid })).project as Row).version, adminId: aid, role, active, workLabel: '' }, randomUUID());
    const send = async (s: SiteChatService, pid: string, text: string, key = randomUUID()) => s.send(pid, { text, mediaIds: [], versions: (await s.read(pid)).versions }, key);
    for (let i = 0; i < 2; i++) {
      const pid = String((await owner.execute('create', { leadId, name: '合成工地' + i, managerId: aids[1], rooms: ['书房'] }, randomUUID())).id); pids.push(pid);
      await change(pid, aids[2], 'designer', true);
      const view = await boss.read(pid), roomId = String((view.rooms as Row[])[0].id);
      const sent = await send(staff, pid, i ? '今天书房底盒还没固定，等设计师核对位置。' : '今天书房现场已完成记录，安装时间还没确认。');
      const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
      await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '合成现场反馈', roomId, completed: '', pending: i ? '底盒待核对' : '安装时间待确认', coordination: '等待设计师回复', note: '' }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 30 } }));
      const rid = String(sent.recordId); rids.push(rid);
      const record = await withTenantTransaction(eid, tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${rid}`));
      await boss.mutate(pid, rid, 'publish', { expectedVersion: Number(record!.version), audience: 'internal' }, randomUUID());
      const iid = String((await send(staff, pid, '跟进记录' + rid + '：请核对实际安排，不推断异常。')).issueId); iids.push(iid);
      await send(boss, pid, '转交事项' + iid + '给合成设计师');
      if (i) await send(designer, pid, '回复事项' + iid + '：已经回复核对意见，仍需管理者核对。');
    }
    const brief = await manager.execute('brief'), items = brief.items as Row[];
    assert.equal(items.length, 2);
    assert.equal(((items.find(p => p.projectId === pids[0])!.issues as Row[])[0]).label, '待回复');
    assert.equal(((items.find(p => p.projectId === pids[1])!.issues as Row[])[0]).label, '待核对');
    assert.ok(items.every(p => p.latestRecord && (p.issues as Row[]).every(i => i.deadline === null)));
    assert.ok(items.every(p => (p.latestRecord as Row).authorName === '合成经理'), 'record attribution must identify its author, not the manager who published it');
    for (const aid of [aids[0], aids[3], aids[4]]) assert.equal(((await new ConstructionService({ enterpriseId: eid, adminId: aid }).execute('brief')).items as Row[]).length, 2);
    assert.equal(((await new ConstructionService(designer.staff).execute('brief')).items as Row[]).length, 0);
    assert.equal(((await new ConstructionService({ enterpriseId: eids[1], adminId: aids[3] }).execute('brief')).items as Row[]).length, 0);
    for (let trial = 0; trial < 2; trial++) {
      const result = await send(staff, pids[0], '事项' + iids[0] + '现在在等谁？为什么？');
      assert.equal(result.runId, null, 'fact query must not enter the failed advice-generation path');
      const reread = await new SiteChatService(manager.actor).read(pids[0]);
      const answer = (reread.items as Row[]).find(i => (i.message as Row).id === result.messageId)!.response as Row;
      assert.match(String(answer.text), /合成设计师/); assert.match(String(answer.text), /安装时间还没确认/); assert.doesNotMatch(String(answer.text), /底盒/);
    }
    const before = (await manager.execute('brief')).version;
    await send(designer, pids[0], '回复事项' + iids[0] + '：已回复安排，尚待团队核对。');
    const updated = await manager.execute('brief'); assert.notEqual(updated.version, before);
    assert.equal(((updated.items as Row[]).find(p => p.projectId === pids[0])!.issues as Row[])[0].label, '待核对');
    assert.equal((await new ConstructionService(manager.actor).execute('brief')).version, updated.version);
    // Preserve the existing last-manager safeguard while revoking this viewer.
    await change(pids[0], aids[0], 'manager', true);
    await change(pids[0], aids[1], 'manager', false);
    assert.deepEqual((await manager.execute('brief')).items && ((await manager.execute('brief')).items as Row[]).map(p => p.projectId), [pids[1]]);
    await assert.rejects(staff.read(pids[0]), /construction|assistant_resource_not_found|forbidden/);
    await change(pids[0], aids[1], 'manager', true);
    const original = await withTenantTransaction(eid, tx => one(tx, sql`select source_message_id from app.construction_site_records where enterprise_id=${eid} and id=${rids[0]}`));
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_site_records set source_message_id=null where enterprise_id=${eid} and id=${rids[0]}`));
    assert.equal(((await manager.execute('brief')).items as Row[]).find(p => p.projectId === pids[0])!.latestRecord, null);
    await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_site_records set source_message_id=${String(original!.source_message_id)} where enterprise_id=${eid} and id=${rids[0]}`));
    const record = await withTenantTransaction(eid, tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${rids[0]}`));
    await boss.mutate(pids[0], rids[0], 'withdraw', { expectedVersion: Number(record!.version), reason: '合成来源撤回' }, randomUUID());
    const revoked = (await manager.execute('brief')).items as Row[], revokedProject = revoked.find(p => p.projectId === pids[0])!;
    assert.equal(revokedProject.latestRecord, null); assert.equal((revokedProject.issues as Row[])[0].label, '待重新核对');
    assert.doesNotMatch(JSON.stringify(revokedProject), /安装时间还没确认/);
    const withdrawn = await withTenantTransaction(eid, tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${rids[0]}`));
    await boss.mutate(pids[0], rids[0], 'edit', { expectedVersion: Number(withdrawn!.version), data: { title: '合成项目总记录', roomId: null, completed: '', pending: '总进度待核对', coordination: '', note: '' } }, randomUUID());
    await boss.mutate(pids[0], rids[0], 'publish', { expectedVersion: Number(withdrawn!.version) + 1, audience: 'internal' }, randomUUID());
    assert.equal((((await manager.execute('brief')).items as Row[]).find(p => p.projectId === pids[0])!.latestRecord as Row).title, '合成项目总记录');
    assert.equal(await withTenantTransaction(eid, tx => currentRecord(tx, eid, pids[0], rids[0])), null, 'formal matter source still requires a room');
  } finally {
    await withPlatformTransaction(async tx => {
      for (const eid of eids) { await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid)); await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`); }
      for (const aid of aids.slice(3)) await tx.execute(sql`delete from app.admin_users where id=${aid}`);
      if (uid) await tx.execute(sql`delete from app.users where id=${uid}`);
    });
    await closePostgresPool();
  }
});
