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

const prefix = 'schedule-review-' + randomUUID();
const eids: string[] = [], aids: string[] = [], uids: string[] = [], members: string[] = [];
let pid: string, cid: string, leadId: string, issueId: string, drawingId: string, planId: string, proofRecordId: string;
let owner: ConstructionService, boss: SiteChatService, designer: SiteChatService, worker: SiteChatService;
let privateChat: ConversationService, customer: PlanCustomerService;
const act = (action: string, body: Row) => owner.execute(action, body, randomUUID());
const pv = async () => Number(((await owner.execute('detail', { projectId: pid })).project as Row).version);
const say = (text: string, key = randomUUID()) => privateChat.send(cid, key, { version: 1, blocks: [{ type: 'text', text }] }, siteWatchInterceptor);
const command = async (service: SiteChatService, text: string, mediaIds: string[] = [], key = randomUUID()) => service.send(pid,
  { text, mediaIds, versions: (await service.read(pid)).versions }, key);
const issueView = () => withTenantTransaction(eids[0], tx => readSiteIssue(tx, eids[0], pid, issueId));
const groups = async () => (await act('detail', { projectId: pid })).issueGroups as Row;
const groupCount = async (key: string) => ((await groups())[key] as Row[]).length;
const recordVersion = async (service: SiteChatService, rid: string) =>
  ((await service.read(pid)).versions as { records: Record<string, number> }).records[rid];
const uploaded = async (service: SiteChatService, color: string) => String((await service.upload(pid, randomUUID(),
  await sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer())).id);
/** Asia/Shanghai calendar day, so plan dates do not depend on the test runner timezone. */
const day = (offset: number) => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
async function roomId(name: string, projectId = pid) {
  const row = await withTenantTransaction(eids[0], tx => one(tx, sql`select id::text from app.construction_rooms
    where enterprise_id=${eids[0]} and project_id=${projectId} and name=${name}`));
  assert.ok(row); return String(row!.id);
}
async function publishRecord(service: SiteChatService, text: string, media: string) {
  const sent = await service.send(pid, { text, mediaIds: [media] }, randomUUID());
  return sent;
}

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
    values(${eids[0]},${uids[0]},'合成进度业主','13900000002','natural') returning id`)))!.id);
  pid = String((await act('create', { leadId, name: '进度整改工地', managerId: aids[0], rooms: ['书房', '主卧'] })).id);
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

test('a project without an effective plan is never reported as normal', async () => {
  const view = await act('schedule', { projectId: pid });
  assert.equal(view.available, false);
  assert.equal((view.overall as Row).color, 'gray');
  assert.equal(view.valid, false);
  assert.match(String(view.text), /未排期不能视为正常/);
  assert.match(String(view.text), /尚未发布施工进度计划/);
});

test('the plan version turns real records and stage moves into 提前 / 正常 / 落后 / 待核实 without inferring whole-project completion', async () => {
  const staged = await act('stages', {});
  const custom = [...(staged.stages as Row[]), { key: 'custom_check', name: '专项验收', visitReminder: false, visitReason: '', watchPoints: '' }];
  await act('saveStages', { expectedVersion: staged.version, stages: custom });
  // 书房水电已过期无证据；主卧油漆有当阶段完成记录；泥木未开始；专项验收随后撤节点。
  const published = await act('saveSchedule', { projectId: pid, expectedVersion: 0, title: '进度整改工地总计划', note: '按房间与阶段排期',
    nodes: [
      { key: 'study_utilities', stageKey: 'utilities', roomId: await roomId('书房'), plannedStart: day(-8), plannedEnd: day(-3) },
      { key: 'bedroom_painting', stageKey: 'painting', roomId: await roomId('主卧'), plannedStart: day(-5), plannedEnd: day(10) },
      { key: 'masonry_future', stageKey: 'installation', roomId: null, plannedStart: day(5), plannedEnd: day(15) },
      // 计划期内但没有任何现场记录：只能待核实，不能判为正常。
      { key: 'study_wall', stageKey: 'painting', roomId: await roomId('书房'), plannedStart: day(-2), plannedEnd: day(6) },
      { key: 'custom_check', stageKey: 'custom_check', roomId: null, plannedStart: day(1), plannedEnd: day(4) },
    ] });
  assert.equal(published.version, 1);
  await act('progress', { projectId: pid, expectedVersion: await pv(), stageKey: 'painting', note: '主卧油漆进场', sendReminder: false });

  const bedroom = await publishRecord(worker, '主卧墙面底漆今天已经完成。', await uploaded(worker, '#e8dccb'));
  const bedroomLease = await claimJob(); assert.equal(bedroomLease?.runId, bedroom.runId);
  await processSiteRecord(bedroomLease!, async () => ({ text: JSON.stringify({ title: '主卧墙面底漆', roomId: await roomId('主卧'),
    completed: '墙面底漆完成', pending: '', coordination: '', note: '' }), toolCalls: [], finishReason: 'stop', providerRequestId: null,
    usage: { inputTokens: 70, outputTokens: 30 } }));
  const bedroomRecord = String(bedroom.recordId);
  await worker.mutate(pid, bedroomRecord, 'publish', { expectedVersion: await recordVersion(worker, bedroomRecord), audience: 'internal' }, randomUUID());

  // A stage that is removed after publication leaves an unverifiable node, not a normal one.
  const kept = (await act('stages', {})).stages as Row[];
  await act('saveStages', { expectedVersion: (await act('stages', {})).version, stages: kept.filter(s => s.key !== 'custom_check') });

  const view = await act('schedule', { projectId: pid });
  const nodes = view.nodes as Row[];
  const color = (key: string) => (nodes.find(node => node.key === key) as Row).color;
  assert.equal(color('study_utilities'), 'red');
  assert.equal(color('bedroom_painting'), 'green');
  assert.equal(color('masonry_future'), 'yellow');
  assert.equal(color('study_wall'), 'gray');
  assert.equal(color('custom_check'), 'gray');
  assert.deepEqual(view.counts, { green: 1, yellow: 1, red: 1, gray: 2 });
  assert.ok((view.gaps as Row[]).some(gap => gap.kind === 'node_no_evidence'));
  assert.equal((view.overall as Row).color, 'red');
  assert.equal(view.valid, false);
  assert.ok((view.gaps as Row[]).some(gap => gap.kind === 'stage_unavailable'));
  assert.match(String(view.text), /单个房间完成不等于整个项目完成/);
  // The room record proves only its own stage; it cannot close the utilities node.
  assert.equal((nodes.find(node => node.key === 'study_utilities') as Row).actual, null);
  // A boss can ask the same projection why a node is behind; the answer must not invent a cause.
  const asked = await command(boss, '书房进度为什么落后了？');
  const answer = ((await boss.read(pid)).items as Row[]).find(item => String((item.message as Row).id) === String(asked.messageId))?.response as Row;
  assert.match(String(answer?.text), /已落后/);
  assert.match(String(answer?.text), /没有新记录不会自动判定正常/);
  assert.match(String(answer?.text), /不编造原因/);
});

test('a shared owner need is reviewed, planned and approved before any rectification starts', async () => {
  await say('共享进度整改工地·书房需求：书桌靠窗，插座需要方便电脑和台灯使用。');
  const issues = await withTenantTransaction(eids[0], tx => projectSiteIssues(tx, eids[0], pid));
  issueId = issues[0].issueId;
  assert.equal(issues[0].sourceKind, 'need');
  assert.equal((await issueView())!.status, 'awaiting_owner');
  await new AssistantMediaService(privateChat.actor).upload(cid, randomUUID(),
    await sharp({ create: { width: 96, height: 72, channels: 3, background: '#d7e3d8' } }).png().toBuffer(), 'image', '');
  await say('共享进度整改工地·书房点位图：书桌靠窗插座位置，须结合现场尺寸核对。');
  drawingId = await withTenantTransaction(eids[0], tx => one(tx, sql`select id::text from app.domain_event_outbox
    where enterprise_id=${eids[0]} and type='construction.material.shared.v1' and payload->>'projectId'=${pid}
      and payload->>'kind'='drawing' order by id desc limit 1`)).then(row => String(row!.id));
  await command(designer, `重新核对事项${issueId}：采用当前共享图纸`);
  await command(designer, `核对事项${issueId}图纸${drawingId}`);
  await command(designer, `回复事项${issueId}：已按业主原话核对，准备发布明确版本。`);
  const planMedia = await uploaded(designer, '#cef4e5');
  const published = await command(designer, `发布方案事项${issueId}\n标题：书房书桌插座定位\n差异：保留书桌靠窗，电脑与台灯分位。\n费用变化：+0.00元\n工期变化：+0天`, [planMedia]);
  planId = String(published.planId);
  assert.equal((await withTenantTransaction(eids[0], tx => projectPlans(tx, eids[0], pid))).length, 1);
  await deliverPlans();
  const plan = await customer.read(planId);
  await customer.decide(planId, 'preview', { expectedRevision: plan.revision }, randomUUID());
  await customer.decide(planId, 'approve', { expectedRevision: (await customer.read(planId)).revision }, randomUUID());
  assert.equal((await customer.read(planId)).status, 'approved');
});

test('confirm, assign and rectify keep one business status; the worker return never closes the issue', async () => {
  await command(boss, `确认事项${issueId}`);
  let view = (await issueView())!;
  assert.equal(view.confirmed, true);
  assert.equal(view.classification, 'awaiting_rectification');
  assert.equal(await groupCount('awaitingRectification'), 1);

  await command(boss, `转交事项${issueId}给合成师傅`);
  assert.equal((await issueView())!.ownerName, '合成师傅');
  await command(worker, `开始整改事项${issueId}：安排底盒复位与补漆`);
  view = (await issueView())!;
  assert.equal(view.status, 'rectifying');
  assert.equal(view.classification, 'rectifying');
  assert.equal(await groupCount('rectifying'), 1);

  const photo = await uploaded(worker, '#cfd8c3');
  const record = await publishRecord(worker, '书房插座底盒今天已经整改完成，已补漆。', photo);
  const lease = await claimJob(); assert.equal(lease?.runId, record.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房插座整改', roomId: await roomId('书房'),
    completed: '插座底盒复位并补漆完成', pending: '', coordination: '', note: '' }), toolCalls: [], finishReason: 'stop',
    providerRequestId: null, usage: { inputTokens: 80, outputTokens: 35 } }));
  proofRecordId = String(record.recordId);
  await worker.mutate(pid, proofRecordId, 'publish', { expectedVersion: await recordVersion(worker, proofRecordId), audience: 'internal' }, randomUUID());
  await command(worker, `回复事项${issueId}：底盒已复位并补漆，现场记录${proofRecordId}含整改照片。`);
  assert.equal((await issueView())!.status, 'awaiting_review');
  // The manager may disclose the bounded state to the original consultation,
  // which still does not close anything; only a review can.
  await command(boss, `回传事项${issueId}：底盒已复位并补漆，整改照片见现场记录，待复核。`);
  view = (await issueView())!;
  assert.equal(view.status, 'awaiting_review');
  assert.equal(view.classification, 'awaiting_review');
  assert.notEqual(view.status, 'closed');
  assert.equal(await groupCount('awaitingReview'), 1);
});

test('only a manager review resolves and closes; the boss then sees the fixed list and the owner sees the authorized result', async () => {
  // 确认、整改、回复和回传都会推进事项修订，原方案 V1 随即失效；须按当前
  // 现场情况重新发布并经业主同意的 V2 才能落实，不能沿用旧的批准。
  planId = String((await command(boss, `发布方案事项${issueId}\n标题：书房书桌插座定位（复核版）\n差异：保留书桌靠窗，电脑与台灯分位，补漆范围收口。\n费用变化：+0.00元\n工期变化：+0天`,
    [await uploaded(boss, '#dcedf7')])).planId);
  await deliverPlans();
  await customer.decide(planId, 'preview', { expectedRevision: (await customer.read(planId)).revision }, randomUUID());
  await customer.decide(planId, 'approve', { expectedRevision: (await customer.read(planId)).revision }, randomUUID());
  assert.equal((await customer.read(planId)).status, 'approved');
  await command(worker, `落实事项${issueId}方案${planId}记录${proofRecordId}：书房插座按已确认版本完成整改。`);
  assert.equal((await issueView())!.status, 'implemented');
  assert.notEqual((await issueView())!.status, 'closed');
  await command(boss, `解决事项${issueId}\n结论：书房插座按已确认版本完成整改。\n回传：插座复位补漆完成，回传原件可查。\n回传原件：是`);
  assert.equal((await issueView())!.status, 'resolved');
  await command(boss, `关闭事项${issueId}\n结论：已复核整改前后证据，符合确认版本。\n回传：书房插座整改完成并复核通过。\n回传原件：是`);
  assert.equal((await issueView())!.status, 'closed');
  assert.equal((await issueView())!.classification, 'closed');

  const detail = await act('detail', { projectId: pid });
  const fixed = (detail.issueGroups as Row).fixed as Row[];
  assert.ok(fixed.some(item => item.issueId === issueId));
  assert.equal(((detail.issueGroups as Row).awaitingReview as Row[]).length, 0);

  await deliverSiteResults();
  const results = (await withTenantTransaction(eids[0], tx => queryNeedIssues(tx, privateChat.actor, cid))).data;
  const returned = results.find(item => item.kind === 'team_result'); assert.ok(returned);
  assert.match(returned.value, /已正式关闭/);
  assert.doesNotMatch(JSON.stringify(returned), /底盒复位与补漆|内部|方案原件/);
});

test('a misreport can be excluded with a reason and reopened without keeping the old conclusion', async () => {
  const media = await uploaded(worker, '#d9d9d9');
  const sent = await publishRecord(worker, '书房墙面今天发现有色差。', media);
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房墙面色差', roomId: await roomId('书房'),
    completed: '墙面修补', pending: '有色差', coordination: '', note: '' }), toolCalls: [], finishReason: 'stop',
    providerRequestId: null, usage: { inputTokens: 60, outputTokens: 20 } }));
  const recordId = String(sent.recordId);
  await worker.mutate(pid, recordId, 'publish', { expectedVersion: await recordVersion(worker, recordId), audience: 'internal' }, randomUUID());
  await command(boss, `跟进记录${recordId}：核对墙面色差是否属于施工问题。`);
  const issues = await withTenantTransaction(eids[0], tx => projectSiteIssues(tx, eids[0], pid));
  const second = issues.find(item => item.issueId !== issueId)!;
  await command(boss, `确认事项${second.issueId}`);
  await command(boss, `排除事项${second.issueId}：照片为灯光色温造成的AI识别误差，现场无色差，非施工质量问题。`);
  const view = await withTenantTransaction(eids[0], tx => readSiteIssue(tx, eids[0], pid, second.issueId));
  assert.equal(view!.classification, 'dismissed');
  assert.equal(view!.status, 'dismissed');
  const groupsNow = await groups();
  assert.ok((groupsNow.excluded as Row[]).some(item => item.issueId === second.issueId));
  assert.doesNotMatch(JSON.stringify(groupsNow), /灯光色温/);
  await command(boss, `恢复事项${second.issueId}：重新核实现场色差`);
  const reopened = await withTenantTransaction(eids[0], tx => readSiteIssue(tx, eids[0], pid, second.issueId));
  assert.equal(reopened!.classification, 'awaiting_verification');
  assert.equal(reopened!.confirmed, false);
});

test('status and evidence survive a fresh read, and another enterprise can never read them', async () => {
  const fresh = new ConstructionService({ enterpriseId: eids[0], adminId: aids[0] });
  const detail = await fresh.execute('detail', { projectId: pid });
  const closed = (detail.issueGroups as Row).fixed as Row[];
  assert.ok(closed.some(item => item.issueId === issueId && item.classification === 'closed'));
  const schedule = await fresh.execute('schedule', { projectId: pid });
  assert.equal((schedule.nodes as Row[]).find(node => node.key === 'bedroom_painting')!.color, 'green');
  const evidence = await withTenantTransaction(eids[0], tx => one(tx, sql`select payload from app.domain_event_outbox
    where enterprise_id=${eids[0]} and type='construction.site.issue.result.v1' and aggregate_id=${issueId} order by id desc limit 1`));
  assert.ok(evidence);
  await assert.rejects(new ConstructionService({ enterpriseId: eids[1], adminId: aids[1] }).execute('detail', { projectId: pid }),
    (error: Row) => String(error.code || '').includes('construction_'));
});

test('a project with no designer leaves the shared need unassigned instead of inventing an owner', async () => {
  const otherLead = String((await withTenantTransaction(eids[0], tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eids[0]},${uids[0]},'合成无设计师业主','13900000003','natural') returning id`)))!.id);
  const other = String((await act('create', { leadId: otherLead, name: '无设计师工地', managerId: aids[0], rooms: ['次卧'] })).id);
  const otherChat = new ConversationService({ enterpriseId: eids[0], principal: { kind: 'user', userId: uids[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: otherLead } });
  const otherCid = String((await otherChat.create(randomUUID())).id);
  await otherChat.send(otherCid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '共享无设计师工地·次卧需求：床头两侧都要插座。' }] }, siteWatchInterceptor);
  const issues = await withTenantTransaction(eids[0], tx => projectSiteIssues(tx, eids[0], other));
  const item = issues.find(issue => issue.projectId === other)!;
  assert.ok(item);
  assert.ok(!item.ownerId);
  assert.equal(item.confirmed, false);
  assert.equal(item.classification, 'awaiting_verification');
  // Confirmation is allowed, but rectification cannot start without an
  // effective responsible person.
  const v1 = (await boss.read(other)).versions as Row;
  await boss.send(other, { text: `确认事项${item.issueId}`, mediaIds: [], versions: v1 }, randomUUID());
  const v2 = (await boss.read(other)).versions as Row;
  await assert.rejects(boss.send(other, { text: `开始整改事项${item.issueId}：安排处理`, mediaIds: [], versions: v2 }, randomUUID()),
    (error: Row) => String(error.code) === 'site_review_required');
});