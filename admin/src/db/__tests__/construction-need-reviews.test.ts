import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { PlanCustomerService, deliverPlans, projectPlans } from '@/lib/construction/site-plans';
import { projectSiteIssues, readSiteIssue } from '@/lib/construction/site-issues';
import { queryNeedIssues } from '@/lib/construction/need-issues';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';

const prefix = 'need-review-' + randomUUID();
const eids: string[] = [], aids: string[] = [], uids: string[] = [], members: string[] = [];
let pid: string, cid: string, leadId: string, issueId: string, drawingId: string, planId: string, evidenceId: string;
let owner: ConstructionService, boss: SiteChatService, designer: SiteChatService, worker: SiteChatService;
let privateChat: ConversationService, customer: PlanCustomerService;
const act = (action: string, body: Row) => owner.execute(action, body, randomUUID());
const pv = async () => Number(((await owner.execute('detail', { projectId: pid })).project as Row).version);
const say = (text: string, key = randomUUID()) => privateChat.send(cid, key, { version: 1, blocks: [{ type: 'text', text }] }, siteWatchInterceptor);
const command = async (service: SiteChatService, text: string, mediaIds: string[] = [], key = randomUUID()) => service.send(pid,
  { text, mediaIds, versions: (await service.read(pid)).versions }, key);
const issueView = () => withTenantTransaction(eids[0], tx => readSiteIssue(tx, eids[0], pid, issueId));
const ownerIssues = async () => (await withTenantTransaction(eids[0], tx => queryNeedIssues(tx, privateChat.actor, cid))).data;
const uploaded = async (service: SiteChatService, color: string) => String((await service.upload(pid, randomUUID(),
  await sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer())).id);

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + n},${prefix + n},'active') returning id`))!.id); eids.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${eid},true,100,12000000,1000000000,30)`);
      aids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${eid},${prefix + '-owner' + n},'test-only','enterprise_admin','active',false,${'合成负责人' + n}) returning id`))!.id));
    }
    for (const [index, role] of ['designer', 'construction_staff', 'construction_staff'].entries())
      members.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${eids[0]},${prefix + '-member' + index},'test-only',${role},'active',false,${['合成设计师', '合成师傅', '合成外协'][index]}) returning id`))!.id));
    uids.push(String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id));
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uids[0]},${prefix})`);
  });
  owner = new ConstructionService({ enterpriseId: eids[0], adminId: aids[0] });
  boss = new SiteChatService(owner.actor);
  designer = new SiteChatService({ enterpriseId: eids[0], adminId: members[0] });
  worker = new SiteChatService({ enterpriseId: eids[0], adminId: members[1] });
  leadId = String((await withTenantTransaction(eids[0], tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eids[0]},${uids[0]},'合成需求业主','13900000001','natural') returning id`)))!.id);
  pid = String((await act('create', { leadId, name: '需求核对工地', managerId: aids[0], rooms: ['书房', '主卧'] })).id);
  await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[0], role: 'designer', active: true, workLabel: '设计' });
  await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[1], role: 'worker', active: true, workLabel: '水电' });
  privateChat = new ConversationService({ enterpriseId: eids[0], principal: { kind: 'user', userId: uids[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } });
  cid = String((await privateChat.create(randomUUID())).id);
  customer = new PlanCustomerService(privateChat.actor, cid);
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of eids) { await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
      await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.enterprises where id=${eid}`); }
    for (const uid of uids) { await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`); await tx.execute(sql`delete from app.users where id=${uid}`); }
  }); } finally { await closePostgresPool(); }
});

test('an explicitly shared owner need becomes one durable design-review item assigned to the only designer', async () => {
  const text = '共享需求核对工地·书房需求：书桌靠窗，主要用电脑和台灯，希望插座位置方便使用。';
  const sent = await say(text); assert.equal(sent.runId, null);
  const issues = await withTenantTransaction(eids[0], tx => projectSiteIssues(tx, eids[0], pid));
  assert.equal(issues.length, 1);
  issueId = issues[0].issueId;
  assert.equal(issues[0].sourceKind, 'need');
  assert.equal(issues[0].roomName, '书房');
  assert.equal(issues[0].status, 'awaiting_owner');
  assert.equal(issues[0].ownerName, '合成设计师');
  assert.match(issues[0].text, /书桌靠窗，主要用电脑和台灯/);
  assert.match(issues[0].text, /当前负责人：合成设计师/);
  // The item is discoverable from the project detail the designer opens.
  const asOwner = await owner.execute('detail', { projectId: pid });
  assert.equal((asOwner.issues as Row[]).length, 1);
  assert.equal(String((asOwner.issues as Row[])[0].issueId), issueId);
  assert.equal((asOwner.issues as Row[])[0].sourceKind, 'need');
  assert.equal(String((asOwner.issues as Row[])[0].ownerName), '合成设计师');
});

test('a repeated or updated share refreshes the same item and never creates a second design-review matter', async () => {
  await say('共享需求核对工地·书房需求：书桌靠窗，电脑、台灯，另加手机充电。', randomUUID());
  const issues = await withTenantTransaction(eids[0], tx => projectSiteIssues(tx, eids[0], pid));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueId, issueId);
  assert.ok(issues[0].revision > 1);
  assert.match(issues[0].text, /手机充电/);
  const opened = await withTenantTransaction(eids[0], tx => one(tx, sql`select count(*)::int n from app.domain_event_outbox
    where enterprise_id=${eids[0]} and type='construction.site.issue.opened.v1' and payload->>'sourceKind'='need'
      and payload->>'projectId'=${pid}`));
  assert.equal(Number(opened!.n), 1);
});

test('the owner can follow the real review status without seeing internal replies or evidence', async () => {
  let data = await ownerIssues();
  const review = data.find(item => item.kind === 'need_review'); assert.ok(review);
  assert.equal(review.waitingFor, 'designer');
  assert.match(review.value, /已转给合成设计师核对，等待处理/);
  await command(designer, `回复事项${issueId}：插座位置需结合图纸与现场尺寸核对，标高由设计确认。`);
  assert.equal((await issueView())!.status, 'awaiting_review');
  data = await ownerIssues();
  const updated = data.find(item => item.kind === 'need_review'); assert.ok(updated);
  assert.equal(updated.waitingFor, 'team');
  assert.match(updated.value, /已有处理回复，团队核对中/);
  assert.doesNotMatch(JSON.stringify(updated), /标高由设计确认|汇总|证据/);
});

test('drawing check and formal plan keep exact versions; the unconfirmed plan is not an effective construction instruction', async () => {
  await new AssistantMediaService(privateChat.actor).upload(cid, randomUUID(),
    await sharp({ create: { width: 96, height: 72, channels: 3, background: '#d7e3d8' } }).png().toBuffer(), 'image', '');
  await say('共享需求核对工地·书房点位图：书桌靠窗插座位置，须结合现场尺寸核对。');
  drawingId = await withTenantTransaction(eids[0], tx => one(tx, sql`select id::text from app.domain_event_outbox
    where enterprise_id=${eids[0]} and type='construction.material.shared.v1' and payload->>'projectId'=${pid}
      and payload->>'roomId'=(select id::text from app.construction_rooms where enterprise_id=${eids[0]} and project_id=${pid} and name='书房')
      and payload->>'kind'='drawing' order by id desc limit 1`)).then(row => String(row!.id));
  // A newly shared drawing changes the room snapshot; the designer explicitly
  // re-binds the same matter before checking the new version.
  await command(designer, `重新核对事项${issueId}：采用当前共享图纸`);
  await command(designer, `核对事项${issueId}图纸${drawingId}`);
  await command(designer, `回复事项${issueId}：已按当前图纸与业主原话核对，准备发布明确版本。`);
  const planMedia = await uploaded(designer, '#cef4e5');
  const text = `发布方案事项${issueId}\n标题：书房书桌靠窗插座定位\n差异：保留书桌靠窗，电脑与台灯分位，具体数量、高度和回路以本版图纸与现场核对为准。\n费用变化：+0.00元\n工期变化：+0天`;
  const published = await command(designer, text, [planMedia]); planId = String(published.planId); assert.ok(planId);
  const plans = await withTenantTransaction(eids[0], tx => projectPlans(tx, eids[0], pid));
  assert.equal(plans.length, 1);
  assert.equal((plans[0] as Row).status, 'pending_customer');
  // Owner has not decided: the item is still waiting for the customer, not for construction.
  assert.equal((await issueView())!.status, 'awaiting_review');
  await deliverPlans();
  let ownerView = (await ownerIssues()).find(item => item.kind === 'formal_plan'); assert.ok(ownerView);
  assert.equal(ownerView.status, 'awaiting_customer');
  const plan = await customer.read(planId);
  await customer.decide(planId, 'preview', { expectedRevision: plan.revision }, randomUUID());
  const previewed = await customer.read(planId);
  await customer.decide(planId, 'approve', { expectedRevision: previewed.revision }, randomUUID());
  assert.equal((await customer.read(planId)).status, 'approved');
  ownerView = (await ownerIssues()).find(item => item.kind === 'formal_plan'); assert.ok(ownerView);
  assert.equal(ownerView.status, 'approved');
});

test('worker feedback is linked to the approved plan; evidence stays unverified until the manager resolves it', async () => {
  const media = await uploaded(worker, '#d9c9b0');
  const sent = await worker.send(pid, { text: '主卧底盒已经安装完成，书房位置还需要核对。书房插座底盒安装完成。', mediaIds: [media] }, randomUUID());
  const room = ((await boss.read(pid)).rooms as Row[]).find(r => r.name === '书房')!;
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房插座底盒', roomId: String(room.id), completed: '插座底盒安装完成', pending: '', coordination: '', note: '主卧底盒已完成，书房仍需核对。' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 90, outputTokens: 40 } }));
  evidenceId = String(sent.recordId);
  const versions = (await worker.read(pid)).versions as { records: Record<string, number> };
  await worker.mutate(pid, evidenceId, 'publish', { expectedVersion: versions.records[evidenceId], audience: 'internal' }, randomUUID());
  await command(designer, `落实事项${issueId}方案${planId}记录${evidenceId}：书房插座底盒按已确认版本安装完成。`);
  assert.equal((await issueView())!.status, 'implemented');
  const ownerView = (await ownerIssues()).find(item => item.kind === 'need_review'); assert.ok(ownerView);
  assert.match(ownerView.value, /团队已提交处理/);
  // Implementation is not acceptance: only a manager resolution reaches the original consultation.
  await command(boss, `解决事项${issueId}\n结论：书房插座定位按已确认版本落实。\n回传：书房插座已按确认版本完成，现场原件可查看。\n回传原件：是`);
  await deliverSiteResults();
  const results = await ownerIssues();
  const returned = results.find(item => item.kind === 'team_result'); assert.ok(returned);
  assert.match(returned.value, /已正式解决/);
  assert.match(returned.value, /不代表工程验收/);
});
