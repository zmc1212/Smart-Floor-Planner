import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { sharedMaterials } from '@/lib/construction/site-materials';
import { PlanCustomerService, deliverPlans } from '@/lib/construction/site-plans';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { queryMaterials, materialSnapshotAvailable } from '@/lib/assistant/agent/materials';
import type { SynthesisSource } from '@/lib/assistant/agent/synthesis';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';

const prefix = 'synthetic-team-materials-' + randomUUID(), tenants: string[] = [], users: string[] = [], admins: string[] = [];
let eid = '';
const call = (name: string, args: unknown): ModelTurnOutput => ({ text: '', toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }],
  usage: { inputTokens: 30, outputTokens: 30 }, finishReason: 'tool_calls', providerRequestId: null });
before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) tenants.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));
    eid = tenants[0];
    for (const [i, role] of ['enterprise_admin','designer','construction_staff'].entries()) admins.push(String((await one(tx, sql`insert into app.admin_users
      (enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eid},${prefix+i},'unusable-synthetic',${role},'active',false,${'合成核对员工'+i}) returning id`))!.id));
  });
  await withTenantTransaction(eid, tx => tx.execute(sql`insert into app.assistant_enterprise_settings
    (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
    values(${eid},true,1000,12000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb)`));
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const e of tenants) { await deleteConstructionData(tx, BigInt(e)); await deleteAssistantData(tx, BigInt(e));
      await tx.execute(sql`delete from app.leads where enterprise_id=${e}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${e}`);
      await tx.execute(sql`delete from app.enterprises where id=${e}`); }
    for (const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`);
  }); } finally { await closePostgresPool(); }
});
async function fixture() {
  const uid = String((await withPlatformTransaction(tx => one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`)))!.id); users.push(uid);
  await withPlatformTransaction(tx => tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix+uid})`));
  const leadId = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eid},${uid},'合成核对业主','13800000000','natural') returning id`)))!.id);
  const owner = new ConstructionService({ enterpriseId: eid, adminId: admins[0] });
  const pid = String((await owner.execute('create', { leadId, name: '合成核对工地', managerId: admins[0], rooms: ['书房','厨房'] }, randomUUID())).id);
  for (const [i, role] of ['designer','worker'].entries()) await owner.execute('member', { projectId: pid,
    expectedVersion: Number(((await owner.execute('detail', { projectId: pid })).project as Row).version), adminId: admins[i+1], role, active: true, workLabel: '' }, randomUUID());
  const boss = new SiteChatService(owner.actor), designer = new SiteChatService({ enterpriseId: eid, adminId: admins[1] }), worker = new SiteChatService({ enterpriseId: eid, adminId: admins[2] });
  const actor = { enterpriseId: eid, principal: { kind: 'user' as const, userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead' as const, id: leadId } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id), customer = new PlanCustomerService(actor, cid);
  const say = (text: string) => chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] }, siteWatchInterceptor);
  const query = (room = '书房', target = cid) => withTenantTransaction(eid, tx => queryMaterials(tx, actor, target, { leadId: '', room }));
  await say('共享书房需求：靠窗双人办公，电脑和台灯，具体尺寸待核对。');
  const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#e3ece7' } }).png().toBuffer();
  await new AssistantMediaService(actor).upload(cid, randomUUID(), bytes, 'image', '');
  await say('共享书房点位图：客户参考图，图内尺寸尚未核实。');
  const sent = await worker.send(pid, { text: '书房底盒还没固定，PRIVATE_INTERNAL_REPLY 等设计师核对位置。', mediaIds: [] }, randomUUID());
  const roomId = String(((await boss.read(pid)).rooms as Row[]).find(r => r.name === '书房')!.id);
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '合成书房进展', roomId, completed: '', pending: '底盒没固定', coordination: '设计师核对', note: '' }),
    toolCalls: [], usage: { inputTokens: 30, outputTokens: 30 }, finishReason: 'stop', providerRequestId: null }));
  const command = async (staff: SiteChatService, text: string, mediaIds: string[] = []) => staff.send(pid, { text, mediaIds, versions: (await staff.read(pid)).versions }, randomUUID());
  const issueId = String((await command(boss, '跟进记录' + sent.recordId)).issueId);
  await command(designer, '接手事项' + issueId); await command(designer, '回复事项' + issueId + '：PRIVATE_UNRETURNED_REPLY 现场尺寸另核对。');
  const drawing = (await withTenantTransaction(eid, tx => sharedMaterials(tx, eid, pid, roomId))).sources.find(s => s.kind === 'drawing')!;
  const check = () => command(designer, `核对事项${issueId}图纸${drawing.id}`);
  const forward = async () => { await command(boss, `回传事项${issueId}：图纸已按本项目书房核对关联，现场尺寸仍待复核。`); await deliverSiteResults(); };
  const publish = async (difference = '按双人办公增设设备位，现场尺寸和最终安装位置仍待核对。', cost = 500) => {
    const mediaId = String((await designer.upload(pid, randomUUID(), bytes)).id);
    return String((await command(designer, `发布方案事项${issueId}\n标题：合成书房点位方案\n差异：${difference}\n费用变化：+${cost}.00元\n工期变化：+2天`, [mediaId])).planId);
  };
  const decide = async (versionId: string, action: string, reason?: string) => customer.decide(versionId, action,
    { expectedRevision: (await customer.read(versionId)).revision, ...(reason ? { reason } : {}) }, randomUUID());
  const answer = async (change?: () => Promise<unknown>, tool = 'query_materials') => {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '结合书房核对关联和正式版本解释，现在能直接固定底盒吗？' }] });
    const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
    await processAgentAnswer(lease!, { model: async (messages, _tools, turn) => {
      if (!turn) return call(tool, tool === 'query_materials' ? { leadId: '', room: '书房' } : { query: '书房点位核对' });
      const sources = messages.filter(m => m.role === 'tool').flatMap(m => JSON.parse(m.content).synthesisSources || []) as SynthesisSource[];
      const plan = sources.find(s => s.material?.ref.type === 'formal_plan'); assert.ok(plan);
      const review = sources.find(s => s.material?.ref.type === 'team_review'); assert.ok(review);
      if (change) await change();
      return call('final_response', { kind: 'synthesis', segments: [{ basis: 'evidence', text: '当前正式版本仍待你决定，团队核对的是参考图关联，具体点位还要结合现场条件。',
        citations: [plan, review].map(s => ({ sourceId: s.sourceId, quote: s.text.split('\n')[0] })) }, { basis: 'uncertainty', text: '现场尺寸与实际落实依据仍需核实。', citations: [] }] });
    } });
    return chat.run(lease!.runId);
  };
  return { uid, leadId, pid, roomId, actor, chat, cid, customer, say, query, command, boss, designer, drawing, issueId, check, forward, publish, decide, answer };
}
const available = (s: Awaited<ReturnType<typeof queryMaterials>>) => withTenantTransaction(eid, tx => materialSnapshotAvailable(tx, eid, s));

test('PPT23 private reply and drawing check do not grant the customer an internal conversation', async () => {
  const x = await fixture(); await x.check();
  assert.ok(!(await x.query()).data.sources.some(s => s.ref.type === 'team_review'));
  await x.forward(); const s = await x.query(), review = s.data.sources.find(s => s.ref.type === 'team_review')!;
  assert.equal(review.review?.drawingGrantId, x.drawing.id); assert.equal(review.review?.issueId, x.issueId);
  assert.equal(review.basis, 'returned_drawing_review'); assert.ok(review.sourceMessageId);
  assert.match(review.text, /核对关联/); assert.doesNotMatch(JSON.stringify(s), /PRIVATE_/);
  assert.doesNotMatch(s.data.missing.join('；'), /当前参考图核对关联/);
  assert.equal((await x.query('厨房')).data.sources.length, 0);
});
test('same owner/home but a different consultation and cross-tenant/customer cannot inherit review or formal versions', async () => {
  const x = await fixture(); await x.check(); await x.forward(); await x.publish(); await deliverPlans();
  const other = String((await x.chat.create(randomUUID())).id); assert.equal((await x.query('书房', other)).data.sources.length, 0);
  await assert.rejects(withTenantTransaction(tenants[1], tx => queryMaterials(tx, { ...x.actor, enterpriseId: tenants[1] }, x.cid, { leadId: '', room: '书房' })));
  const y = await fixture(); await assert.rejects(withTenantTransaction(eid, tx => queryMaterials(tx, y.actor, x.cid, { leadId: '', room: '书房' })));
});
test('formal source needs actual original-consultation delivery and retains exact version, decision, original hash and distinct authority', async () => {
  const x = await fixture(); await x.check(); await x.forward(); const id = await x.publish();
  assert.ok(!(await x.query()).data.sources.some(s => s.ref.type === 'formal_plan'));
  await deliverPlans(); const s = await x.query(), p = s.data.sources.find(s => s.ref.type === 'formal_plan')!;
  assert.equal(p.ref.id, id); assert.equal(p.formal?.number, 1); assert.equal(p.formal?.decision, 'pending_customer');
  assert.equal(p.formal?.authority, 'enterprise_published_version'); assert.equal(p.formal?.imagePixels, false);
  assert.equal(p.formal?.mediaHash.length, 64); assert.ok(p.mediaIds.length === 1 && p.hash && p.ref.version && p.sourceMessageId);
  assert.match(p.text, /\+500\.00元/); assert.ok(s.data.sources.some(s => s.original?.authority === 'customer_reference'));
});
test('defer, preview and exact approval change the source snapshot but never mark the issue implemented or closed', async () => {
  const x = await fixture(); await x.check(); await x.forward(); const id = await x.publish(); await deliverPlans();
  const a = await x.query(); await x.decide(id, 'defer'); const b = await x.query(); assert.equal(await available(a), false);
  assert.equal(b.data.sources.find(s => s.ref.type === 'formal_plan')!.formal?.decision, 'deferred');
  await x.decide(id, 'preview'); await x.decide(id, 'approve'); const c = await x.query(); assert.equal(await available(b), false);
  assert.equal(c.data.sources.find(s => s.ref.type === 'formal_plan')!.formal?.decision, 'approved');
  assert.equal(((await x.boss.read(x.pid)).items as Row[]).some(i => (i.issue as Row | null)?.status === 'awaiting_review'), true);
});
test('new formal version never inherits old consent; withdrawing latest cannot revive an older approved version', async () => {
  const x = await fixture(); await x.check(); await x.forward(); const first = await x.publish(); await deliverPlans();
  await x.decide(first, 'preview'); await x.decide(first, 'approve'); const old = await x.query();
  const second = await x.publish('改为独立设备位，仍待客户核对该差异。', 800); await deliverPlans();
  const current = await x.query(), p = current.data.sources.find(s => s.ref.type === 'formal_plan')!;
  assert.equal(await available(old), false); assert.equal(p.ref.id, second); assert.equal(p.formal?.previousVersionId, first);
  assert.equal(p.formal?.decision, 'pending_customer'); assert.equal(p.formal?.number, 2); assert.doesNotMatch(JSON.stringify(current), /\+500\.00元/);
  await x.command(x.designer, '撤回方案' + second + '：差异需重核');
  assert.ok(!(await x.query()).data.sources.some(s => s.ref.type === 'formal_plan')); assert.equal(await available(current), false);
});
test('customer intent, selected team excerpt and conflicting formal proposal remain separate original sources', async () => {
  const x = await fixture(); await x.check(); await x.forward(); await x.publish('改为单人办公，取消台灯设备位，需核对是否符合需求。'); await deliverPlans();
  const s = await x.query(); assert.match(s.data.sources.find(s => s.ref.type === 'shared_need')!.text, /双人办公.*台灯/);
  assert.match(s.data.sources.find(s => s.ref.type === 'formal_plan')!.text, /单人办公.*取消台灯/);
  assert.match(s.data.sources.find(s => s.ref.type === 'team_review')!.text, /现场尺寸仍待复核/);
});
for (const mutation of ['drawing','need','issue','publisher','media','membership','participant'] as const) {
  test('XK07/08 current review/formal source and prior derived answer are fenced after ' + mutation, async () => {
    const x = await fixture(); await x.check(); await x.forward(); const id = await x.publish(); await deliverPlans();
    const s = await x.query(), run = await x.answer(); assert.equal(run.status, 'succeeded', JSON.stringify(run));
    if (mutation === 'drawing') await x.say('撤回共享资料' + x.drawing.id);
    if (mutation === 'need') await x.say('共享书房需求：改为本人办公，台灯保留。');
    if (mutation === 'issue') await x.command(x.boss, '取消事项' + x.issueId + '：需要重核');
    await withTenantTransaction(eid, async tx => {
      if (mutation === 'publisher') await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid} and id=${admins[1]}`);
      if (mutation === 'media') await tx.execute(sql`update app.construction_site_media set source_hash=repeat('b',64) where enterprise_id=${eid} and id=${s.data.sources.find(s => s.ref.id === id)!.mediaIds[0]}`);
      if (mutation === 'membership') await tx.execute(sql`update app.construction_members set active=false where enterprise_id=${eid} and project_id=${x.pid} and admin_id=${admins[1]}`);
      if (mutation === 'participant') await tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now() where enterprise_id=${eid} and conversation_id=${x.cid} and user_id=${x.uid}`);
    });
    assert.equal(await available(s), false);
    if (mutation !== 'participant') assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === run.outputMessageId)!.available, false);
    else await assert.rejects(x.chat.messages(x.cid));
    // Shared synthetic staff are restored for the next fixture, never real users.
    if (mutation === 'publisher') await withTenantTransaction(eid, tx => tx.execute(sql`update app.admin_users set status='active' where enterprise_id=${eid} and id=${admins[1]}`));
  });
}
test('explicit and knowledge-bound paths persist distinct review/formal citations and survive normal reentry', async () => {
  for (const tool of ['query_materials','search_knowledge']) {
    const x = await fixture(); await x.check(); await x.forward(); await x.publish(); await deliverPlans(); const run = await x.answer(undefined, tool);
    assert.equal(run.status, 'succeeded', JSON.stringify(run)); const message = (await x.chat.messages(x.cid)).items.find(m => m.id === run.outputMessageId)!;
    assert.equal(message.available, true); assert.match(JSON.stringify(message), /团队明确回传的图纸关联核对/); assert.match(JSON.stringify(message), /精确正式方案版本与客户决定/);
    const step = await withTenantTransaction(eid, tx => one(tx, sql`select source_refs from app.assistant_run_steps where enterprise_id=${eid} and run_id=${run.id} and kind='agent_synthesis_context'`));
    const sources = (step!.source_refs as { sources: SynthesisSource[] }).sources;
    for (const type of ['team_review','formal_plan']) assert.ok(sources.some(s => s.material?.ref.type === type));
  }
});
test('a new customer decision during generation and human handoff fence late model output', async () => {
  const x = await fixture(); await x.check(); await x.forward(); const id = await x.publish(); await deliverPlans();
  const run = await x.answer(() => x.decide(id, 'defer')); assert.notEqual(run.status, 'succeeded'); assert.equal(run.outputMessageId, null);
  const human = await x.answer(() => new HandoffService(x.actor).customerWrite(x.cid, randomUUID(), { action: 'request' }));
  assert.equal(human.outputMessageId, null); assert.equal((await x.chat.detail(x.cid)).mode, 'handoff_requested');
});
