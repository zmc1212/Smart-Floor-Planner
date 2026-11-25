import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '../transaction';
import { one, rows, type Row } from '../repositories/assistant-repository';
import { MiniProgramIdentityRepository } from '../repositories/miniprogram-identity-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getDefaultMenuKeys } from '@/lib/admin-user-roles';
import { ConstructionService } from '@/lib/construction/service';
import { ensureFollowupBinding, enqueueReport } from '@/lib/construction/report-store';
import { deliverConstructionReports, processConstructionReport } from '@/lib/construction/report-worker';
import { FollowupService } from '@/lib/construction/followup-service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { appendMessage, cancelRuns } from '@/lib/assistant/core/conversation';
import { AssistantError, type ActorContext } from '@/lib/assistant/contracts';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { pollChannel, recipientState, startChannel } from '@/lib/assistant/wechat/channels';
import { queueWechatReports } from '@/lib/assistant/wechat/reports';
import { tickWechatChannel } from '@/lib/assistant/wechat/worker';
import { weixinOrigin, type WeixinAccount, type WeixinDeliveryClient, type WeixinInbound } from '@/lib/assistant/wechat/ilink';
import { manageMainPublication } from '@/lib/xiaok-v1/main-publication';
import { stageIds } from '@/lib/xiaok-v1/stages';
import { ConstructionReportService } from '@/lib/construction/report-service';
import { xiaokTestDatabase } from './xiaok-test-database';

type RoleAudience = 'customer' | 'worker' | 'designer' | 'boss';
type RoleClient = {
  client: WeixinDeliveryClient & {
    login(): Promise<{ code: string; display: string }>;
    status(): Promise<{ state: 'confirmed'; origin: string; bot: string; peer: string; token: string }>;
    updates(): Promise<{ cursor: string; messages: WeixinInbound[] }>;
    reply(account: WeixinAccount, context: string, id: string, text: string): Promise<void>;
  };
  input: WeixinInbound[];
  sent: string[];
  peer: string;
};

function staffActor(eid: string, adminId: string, userId: string): ActorContext {
  return { enterpriseId: eid, principal: { kind: 'admin', adminId }, contextVersion: 1,
    capabilities: ['assistant.followup.self'],
    entry: { miniProgramUserId: userId, miniProgramContextVersion: 1, staffUserId: userId } };
}

function customerActor(eid: string, userId: string): ActorContext {
  return { enterpriseId: eid, principal: { kind: 'user', userId }, contextVersion: 1,
    capabilities: ['assistant.followup.self'] };
}

/** Isolated DB acceptance for the four personal-WeChat report audiences. */
test('主小K个人微信四端角色、多工地报告与租户隔离', { skip: !process.env.XIAOK_MAIN_WECHAT_FIXTURE }, async t => {
  xiaokTestDatabase();
  t.after(closePostgresPool);
  const eid = '1454';
  const label = '合成微信四端-' + randomUUID().slice(0, 8);
  const managers = await withPlatformTransaction(tx => rows(tx, sql`select a.id,a.username,e.code from app.admin_users a
    join app.enterprises e on e.id=a.enterprise_id where a.username in ('fixture-owner','fixture-other') order by a.enterprise_id`));
  assert.equal(managers[0].code, 'wechat-fixture-1454');
  assert.equal(managers[1].code, 'wechat-fixture-1455');
  const ownerId = String(managers[0].id);
  const publish = async (enabled: boolean) => {
    const previous = await manageMainPublication(eid, ownerId);
    return manageMainPublication(eid, ownerId, { expectedVersion: previous.version, enabled, reports: true, stages: [...stageIds] });
  };
  await publish(true);

  const fixture = await withPlatformTransaction(async tx => {
    const users = await rows(tx, sql`insert into app.users(enterprise_id,nickname,phone,role,context_version)
      values(1454,${label + '业主'},'13910000001','user',1),(1454,${label + '第二业主'},'13910000002','user',1),
        (1454,${label + '施工经理'},'13910000003','user',1),(1454,${label + '设计师'},'13910000004','user',1),
        (1454,${label + '企业老板'},'13910000005','user',1) returning id`);
    const staff = async (role: string, name: string, userId: string) => {
      const menus = JSON.stringify(getDefaultMenuKeys(role));
      return String((await one(tx, sql`insert into app.admin_users
        (enterprise_id,user_id,username,password_hash,role,status,must_change_password,menu_permissions,display_name)
        values(1454,${userId},${label + name},'local-test-only',${role},'active',false,
          ARRAY(select jsonb_array_elements_text(${menus}::jsonb)),${label + name}) returning id`))!.id);
    };
    return {
      customerUser: String(users[0].id), secondCustomerUser: String(users[1].id),
      managerUser: String(users[2].id), designerUser: String(users[3].id), bossUser: String(users[4].id),
      manager: await staff('construction_staff', '施工经理', String(users[2].id)),
      designer: await staff('designer', '设计师', String(users[3].id)),
      boss: await staff('enterprise_admin', '企业老板', String(users[4].id)),
    };
  });
  const manage = new ConstructionService({ enterpriseId: eid, adminId: fixture.boss });
  const lead1 = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads
    (enterprise_id,customer_user_id,name,phone,source) values(1454,${fixture.customerUser},${label + '业主'},'15910000001','natural') returning id`))!.id));
  const lead2 = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads
    (enterprise_id,customer_user_id,name,phone,source) values(1454,${fixture.secondCustomerUser},${label + '第二业主'},'15910000002','natural') returning id`))!.id));
  const first = await manage.execute('create', { leadId: lead1, name: label + '云栖花园', managerId: fixture.manager, rooms: ['厨房'] }, randomUUID());
  const second = await manage.execute('create', { leadId: lead2, name: label + '滨江府', managerId: fixture.manager, rooms: ['客厅'] }, randomUUID());
  const project1Id = String(first.id), project2Id = String(second.id);
  const extraLeads = await withTenantTransaction(eid, tx => rows(tx, sql`insert into app.leads
    (enterprise_id,customer_user_id,name,phone,source) values
      (1454,${fixture.secondCustomerUser},${label + '老板工地业主'},'15910000003','natural'),
      (1454,${fixture.secondCustomerUser},${label + '施工工地业主'},'15910000004','natural'),
      (1454,${fixture.secondCustomerUser},${label + '设计工地业主'},'15910000005','natural') returning id`));
  // Project 3 is boss-only, project 4 is worker-only, and project 5 is
  // designer-only. This makes a boss-wide digest distinguishable from staff
  // membership digests instead of merely duplicating two shared projects.
  const third = await manage.execute('create', { leadId: String(extraLeads[0].id), name: label + '老板专属工地', managerId: fixture.boss, rooms: ['书房'] }, randomUUID());
  const fourth = await manage.execute('create', { leadId: String(extraLeads[1].id), name: label + '施工专属工地', managerId: fixture.manager, rooms: ['阳台'] }, randomUUID());
  const fifth = await manage.execute('create', { leadId: String(extraLeads[2].id), name: label + '设计专属工地', managerId: fixture.boss, rooms: ['卧室'] }, randomUUID());
  const project3Id = String(third.id), project4Id = String(fourth.id), project5Id = String(fifth.id);
  for (const projectId of [project1Id, project2Id, project3Id, project4Id, project5Id]) {
    const project = (await manage.execute('detail', { projectId })).project as Row;
    await manage.execute('progress', { projectId, expectedVersion: project.version, stageKey: 'utilities', note: '合成水电施工', sendReminder: false }, randomUUID());
  }
  await withTenantTransaction(eid, tx => tx.execute(sql`insert into app.construction_members
    (enterprise_id,project_id,admin_id,role,active,work_label)
    values(1454,${project1Id},${fixture.designer},'designer',true,'方案设计'),(1454,${project2Id},${fixture.designer},'designer',true,'方案设计'),
      (1454,${project5Id},${fixture.designer},'designer',true,'方案设计')
    on conflict(enterprise_id,project_id,admin_id) do update set role='designer',active=true,work_label='方案设计'`));
  const writeFact = async (projectId: string, roomName: string, completed: string, authorId = fixture.manager) => {
    const signed = new SiteChatService({ enterpriseId: eid, adminId: authorId });
    const source = await signed.withWriteScope(projectId, async (tx, conversation) => {
      const message = await appendMessage(tx, signed.actor, String(conversation.id), { author: 'admin', clientMessageId: randomUUID(),
        purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: completed }] } });
      const room = (await one(tx, sql`select id from app.construction_rooms where enterprise_id=1454 and project_id=${projectId}
        and name=${roomName} limit 1`))!;
      const record = (await one(tx, sql`insert into app.construction_site_records
        (enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data,room_id,room_name_snapshot)
        values(1454,${projectId},${String(conversation.id)},${String(message.id)},${authorId},'draft',
          ${JSON.stringify({ title: roomName + '施工', completed, pending: '', coordination: '', note: '', roomId: String(room.id) })}::jsonb,
          ${String(room.id)},${roomName}) returning *`))!;
      await recordVersion(tx, eid, record, authorId, 'organized');
      return record;
    });
    await signed.mutate(projectId, String(source.id), 'publish', { expectedVersion: source.version, audience: 'customer' }, randomUUID());
    return String(source.id);
  };
  const fact1 = label + '云栖花园厨房线管已铺设。';
  const fact2 = label + '滨江府客厅水电点位已复核。';
  const fact3 = label + '老板专属工地书房水电已开工。';
  const fact4 = label + '施工专属工地阳台点位已确认。';
  const fact5 = label + '设计专属工地卧室方案已交底。';
  const source1 = await writeFact(project1Id, '厨房', fact1);
  const source2 = await writeFact(project2Id, '客厅', fact2);
  const source3 = await writeFact(project3Id, '书房', fact3, fixture.boss);
  const source4 = await writeFact(project4Id, '阳台', fact4);
  const source5 = await writeFact(project5Id, '卧室', fact5, fixture.boss);
  const openidPrefix = 'synthetic-xiaok-roles-' + randomUUID().replaceAll('-', '');
  await withPlatformTransaction(async tx => {
    const identities = new MiniProgramIdentityRepository(tx);
    for (const [suffix, userId] of [['customer', fixture.customerUser], ['worker', fixture.managerUser],
      ['designer', fixture.designerUser], ['boss', fixture.bossUser]] as const)
      await identities.attachWechatIdentity({ userId: BigInt(userId), openid: `${openidPrefix}-${suffix}` });
  });
  const externalUser = await withPlatformTransaction(tx => one(tx, sql`insert into app.users(enterprise_id,nickname,role)
    values(1455,${label + '外企业业主'},'user') returning id`));
  assert.ok(externalUser);
  const externalLeadId = await withPlatformTransaction(async tx => String((await one(tx, sql`insert into app.leads
    (enterprise_id,customer_user_id,name,phone,source) values(1455,${String(externalUser.id)},${label + '外企业业主'},'15920000001','natural') returning id`))!.id));
  const otherManage = new ConstructionService({ enterpriseId: '1455', adminId: String(managers[1].id) });
  const externalProject = await otherManage.execute('create', { leadId: externalLeadId, name: label + '外企业工地', managerId: String(managers[1].id), rooms: ['客厅'] }, randomUUID());
  const externalProjectId = String(externalProject.id);
  const overflowProjects = await withTenantTransaction(eid, tx => rows(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name)
    select 1454,${lead1},${label + '超限工地-'} || n::text from generate_series(1,21) n returning id`));
  const actors = {
    customer: customerActor(eid, fixture.customerUser),
    worker: staffActor(eid, fixture.manager, fixture.managerUser),
    designer: staffActor(eid, fixture.designer, fixture.designerUser),
    boss: staffActor(eid, fixture.boss, fixture.bossUser),
  } satisfies Record<RoleAudience, ActorContext>;
  const bindings = await withTenantTransaction(eid, async tx => ({
    customer: await ensureFollowupBinding(tx, eid, { kind: 'user', id: fixture.customerUser, audience: 'customer', projectId: project1Id }),
    worker: await ensureFollowupBinding(tx, eid, { kind: 'admin', id: fixture.manager, audience: 'worker' }),
    designer: await ensureFollowupBinding(tx, eid, { kind: 'admin', id: fixture.designer, audience: 'designer' }),
    boss: await ensureFollowupBinding(tx, eid, { kind: 'admin', id: fixture.boss, audience: 'boss' }),
  }));
  const bindingIds = Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, String(value.id)])) as Record<RoleAudience, string>;
  const requested = {
    customer: { actor: actors.customer, bindingId: bindingIds.customer, projectId: null },
    worker: { actor: actors.worker, bindingId: bindingIds.worker, projectId: null },
    designer: { actor: actors.designer, bindingId: bindingIds.designer, projectId: null },
    boss: { actor: actors.boss, bindingId: bindingIds.boss, projectId: null },
  } as const;
  const roleClients = new Map<RoleAudience, RoleClient>();
  const channelIds = {} as Record<RoleAudience, string>;
  let bossMedia: 'image' | 'upload-failure' | 'rejected' | 'unknown' | 'scope-change' = 'image';
  let imageSends = 0;
  const bossImages: Buffer[] = [];
  let customerMedia: 'image' | 'rejected' = 'image';
  let customerImageAttempts = 0;
  let customerImageSends = 0;
  const customerImages: Buffer[] = [];
  const verifyRoleChannel = async (audience: RoleAudience) => {
    const suffix = randomUUID().slice(0, 6), bot = `role-${audience}-${suffix}`, peer = `peer-${audience}-${suffix}`;
    const input: WeixinInbound[] = [], sent: string[] = [];
    const roleClient: RoleClient = { input, sent, peer, client: {
      async login() { return { code: randomUUID(), display: `https://example.test/${bot}` }; },
      async status() { return { state: 'confirmed', origin: weixinOrigin, bot, peer, token: `session-${suffix}` }; },
      async updates() { return { cursor: randomUUID(), messages: input.splice(0) }; },
      async reply(account: WeixinAccount, context: string, _id: string, text: string) { assert.equal(account.peer, peer); assert.ok(context); sent.push(text); },
    } };
    if (audience === 'boss') {
      let pendingImage: Buffer;
      roleClient.client.uploadImage = async (account, image) => {
        assert.equal(account.peer, peer);
        assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        if (bossMedia === 'upload-failure') throw new Error('test upload failure');
        pendingImage = image;
        if (bossMedia === 'scope-change') {
          await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_projects set status='archived'
            where enterprise_id=${eid} and id=${project5Id}`));
        }
        return { type: 2, image_item: { media: { encrypt_query_param: 'fixture-image', aes_key: 'fixture', encrypt_type: 1 }, mid_size: image.length } };
      };
      roleClient.client.replyImage = async (account, context, _id, image) => {
        imageSends++;
        assert.equal(account.peer, peer);
        assert.ok(context);
        assert.equal(image.image_item.mid_size, pendingImage.length);
        if (bossMedia === 'rejected') throw new AssistantError('wechat_provider_rejected', 502);
        if (bossMedia === 'unknown') throw new Error('test acknowledgement timeout');
        bossImages.push(pendingImage);
      };
    }
    roleClients.set(audience, roleClient);
    const recipient = audience === 'customer' ? { ...requested.customer, projectId: project1Id } : requested[audience];
    const scope = { enterpriseId: eid, stage: 'main' as const, recipient };
    const pending = await startChannel(scope, roleClient.client);
    assert.ok(pending);
    const scannerScope = audience === 'boss' ? { enterpriseId: eid, stage: 'main' as const, adminId: ownerId } : scope;
    const scanner = audience === 'boss' ? await startChannel(scannerScope, roleClient.client) : pending;
    assert.ok(scanner);
    await pollChannel(scannerScope, scanner.id, undefined, roleClient.client);
    let state = (await recipientState(requested[audience])).channel;
    assert.ok(state?.command);
    await withTenantTransaction(eid, async tx => {
      await tx.execute(sql`update app.assistant_wechat_channels set poll_after=now()+interval '1 hour' where enterprise_id=${eid} and status='connected'`);
      await tx.execute(sql`update app.assistant_wechat_channels set poll_after=now() where enterprise_id=${eid} and id=${scanner.id}`);
    });
    input.push({ key: randomUUID(), text: state.command!, context: `verified-${audience}` });
    assert.equal(await tickWechatChannel(eid, roleClient.client), true);
    state = (await recipientState(requested[audience])).channel;
    assert.ok(state?.verified);
    assert.equal(state.id, scanner.id);
    channelIds[audience] = state.id;
    if (audience === 'customer') {
      assert.equal(state.scope, 'project');
      const legacy = await recipientState(requested.customer, { kind: 'preferences', daily: true, weekly: false },
        { id: state.id, version: state.version });
      assert.ok(legacy.channel?.daily);
      const expected = { id: legacy.channel.id, version: legacy.channel.version };
      state = (await recipientState(requested.customer, { kind: 'upgrade' }, expected)).channel;
      assert.equal(state?.id, scanner.id);
      assert.ok(state?.verified);
      await assert.rejects(recipientState(requested.customer, { kind: 'upgrade' }, expected), /version_conflict/);
    }
    assert.equal(state?.scope, 'role');
    assert.equal(state?.daily, false);
    assert.equal(state?.weekly, false);
    const preferences = await recipientState(requested[audience], { kind: 'preferences', daily: true, weekly: true }, { id: state!.id, version: state!.version });
    assert.equal(preferences.channel?.scope, 'role');
    assert.equal(preferences.channel?.daily, true);
    assert.equal(preferences.channel?.weekly, true);
  };
  for (const audience of ['customer', 'worker', 'designer', 'boss'] as const) await verifyRoleChannel(audience);

  const cutoff = new Date(Date.now() + 5000);
  await withTenantTransaction(eid, tx => tx.execute(sql`insert into app.construction_report_settings
      (enterprise_id,enabled,next_daily_at,next_weekly_at,audiences,project_ids)
      values(1454,true,now()+interval '1 day',now()+interval '7 days','["customer","worker","designer","boss"]'::jsonb,
        ${JSON.stringify([project1Id, project2Id, project3Id, project4Id, project5Id])}::jsonb)
      on conflict(enterprise_id) do update set enabled=true,project_ids=excluded.project_ids,audiences=excluded.audiences`));
  type Destination = { audience: RoleAudience; kind: 'daily' | 'weekly' };
  async function generateReports(destinations: Destination[], end: Date) {
    const generated = await withTenantTransaction(eid, async tx => {
      const settings = (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`))!;
      const refs = [];
      for (const { audience, kind } of destinations) {
        const start = new Date(end.getTime() - (kind === 'daily' ? 1 : 7) * 86400000);
        const result = await enqueueReport(tx, eid, bindings[audience], settings, { kind, start, end, cutoff: end, scheduledAt: end });
        assert.ok(result);
        refs.push({ audience, kind, reportId: result.reportId, revision: result.revision, runId: result.runId });
      }
      return refs;
    });
    for (const report of generated) {
      const lease = await claimJob({ enterpriseId: eid, runId: report.runId });
      assert.ok(lease);
      await processConstructionReport(lease);
    }
    assert.equal(await deliverConstructionReports(eid), generated.length);
    return generated;
  }
  const audiences = ['customer', 'worker', 'designer', 'boss'] as const;
  const reports = await generateReports(audiences.flatMap(audience =>
    (['daily', 'weekly'] as const).map(kind => ({ audience, kind }))), cutoff);

  const factsByAudience = {} as Record<RoleAudience, string[]>;
  const expectedProjects: Record<RoleAudience, string[]> = {
    customer: [project1Id], worker: [project1Id, project2Id, project4Id],
    designer: [project1Id, project2Id, project5Id], boss: [project1Id, project2Id, project3Id, project4Id, project5Id],
  };
  for (const audience of ['customer', 'worker', 'designer', 'boss'] as const) {
    const report = reports.find(item => item.audience === audience && item.kind === 'weekly')!;
    const detail = await new FollowupService(actors[audience]).detail(bindingIds[audience], report.reportId, report.revision) as Row;
    assert.equal(detail.available, true);
    const projectIds = ((detail.facts as Row).projects as Row[]).map(project => String(project.id));
    factsByAudience[audience] = projectIds;
    assert.deepEqual(projectIds, expectedProjects[audience]);
    assert.ok(!projectIds.includes(externalProjectId));
  }
  await withTenantTransaction(eid, tx => queueWechatReports(tx, eid));
  const queuedRoleEvents = await withTenantTransaction(eid, tx => rows(tx, sql`select e.id,e.channel_id,e.role_delivery_key,e.report_kind,e.report_id,
      c.recipient_audience,c.project_id,c.recipient_version from app.assistant_wechat_events e
      join app.assistant_wechat_channels c on c.enterprise_id=e.enterprise_id and c.id=e.channel_id
      where e.enterprise_id=${eid} and e.proactive and e.role_delivery_key is not null order by e.id`));
  assert.equal(queuedRoleEvents.length, 8);
  assert.equal(new Set(queuedRoleEvents.map(event => String(event.role_delivery_key))).size, queuedRoleEvents.length);
  for (const audience of ['customer', 'worker', 'designer', 'boss'] as const)
    assert.equal(queuedRoleEvents.filter(event => event.recipient_audience === audience).length, 2);

  const tickRole = async (audience: RoleAudience) => {
    const client = roleClients.get(audience)!;
    await withTenantTransaction(eid, async tx => {
      await tx.execute(sql`update app.assistant_wechat_channels set poll_after=now()+interval '1 hour' where enterprise_id=${eid} and status='connected'`);
      await tx.execute(sql`update app.assistant_wechat_channels set poll_after=now() where enterprise_id=${eid} and id=${channelIds[audience]}`);
    });
    return tickWechatChannel(eid, client.client);
  };
  for (const audience of ['customer', 'worker', 'designer', 'boss'] as const) {
    const before = roleClients.get(audience)!.sent.length;
    for (let attempt = 0; attempt < 8; attempt++) {
      const pending = await withTenantTransaction(eid, tx => one(tx, sql`select id from app.assistant_wechat_events
        where enterprise_id=${eid} and channel_id=${channelIds[audience]} and proactive and status<>'sent'`));
      if (!pending) break;
      await tickRole(audience);
    }
    const pending = await withTenantTransaction(eid, tx => one(tx, sql`select id from app.assistant_wechat_events
      where enterprise_id=${eid} and channel_id=${channelIds[audience]} and proactive and status<>'sent'`));
    assert.equal(pending, undefined);
    const textCount = audience === 'boss' ? 1 : 2;
    assert.equal(roleClients.get(audience)!.sent.length, before + textCount);
    const messages = roleClients.get(audience)!.sent.slice(-textCount);
    assert.ok(messages.every(text => text.includes('日报') || text.includes('周报')));
    assert.ok(messages.every(text => text.includes('完整报告可在小程序')));
    if (audience === 'boss') assert.ok(messages.some(text => text.includes('共5个工地')));
    if (audience === 'customer') assert.ok(messages.every(text => text.includes(fact1)));
    if (audience !== 'customer') assert.ok(messages.some(text => text.includes(fact1)) && messages.some(text => text.includes(fact2)));
  }
  assert.equal(imageSends, 1);
  assert.equal(bossImages.length, 1);
  assert.equal(bossImages[0].readUInt32BE(16), 780);

  // Keep the original four-role text regression intact. The owner transport
  // gains image methods only after that regression so older single-site
  // fixtures without uploadImage remain text-only.
  const customerClient = roleClients.get('customer')!;
  let pendingCustomerImage: Buffer | undefined;
  customerClient.client.uploadImage = async (account, image) => {
    assert.equal(account.peer, customerClient.peer);
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    customerImageAttempts++;
    pendingCustomerImage = image;
    return { type: 2, image_item: { media: { encrypt_query_param: 'fixture-customer-image', aes_key: 'fixture', encrypt_type: 1 }, mid_size: image.length } };
  };
  customerClient.client.replyImage = async (account, context, _id, image) => {
    assert.equal(account.peer, customerClient.peer);
    assert.ok(context);
    assert.ok(pendingCustomerImage);
    assert.equal(image.image_item.mid_size, pendingCustomerImage.length);
    if (customerMedia === 'rejected') throw new AssistantError('wechat_provider_rejected', 502);
    customerImageSends++;
    customerImages.push(pendingCustomerImage);
  };

  const customerImageStart = new Date(cutoff.getTime() + 60 * 1000);
  const customerImageReports = await generateReports([
    { audience: 'customer', kind: 'daily' }, { audience: 'customer', kind: 'weekly' },
  ], customerImageStart);
  reports.push(...customerImageReports);
  const customerDaily = customerImageReports.find(item => item.kind === 'daily')!;
  const customerWeekly = customerImageReports.find(item => item.kind === 'weekly')!;
  const expectedCustomerImage = await new FollowupService(actors.customer).reportImage(
    bindingIds.customer, customerWeekly.reportId, customerWeekly.revision, project1Id);
  assert.equal(Buffer.from(expectedCustomerImage).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  await withTenantTransaction(eid, tx => queueWechatReports(tx, eid));
  const customerBeforeText = customerClient.sent.length;
  const customerBeforeAttempts = customerImageAttempts;
  const customerBeforeImageSends = customerImageSends;
  for (let attempt = 0; attempt < 4; attempt++) {
    const pending = await withTenantTransaction(eid, tx => one(tx, sql`select id from app.assistant_wechat_events
      where enterprise_id=${eid} and channel_id=${channelIds.customer} and proactive and status<>'sent'`));
    if (!pending) break;
    await tickRole('customer');
  }
  const customerImageEvents = await withTenantTransaction(eid, tx => rows(tx, sql`select report_id::text as report_id,status
    from app.assistant_wechat_events where enterprise_id=${eid} and channel_id=${channelIds.customer}
      and proactive and report_id in (${customerDaily.reportId},${customerWeekly.reportId}) order by report_id`));
  assert.deepEqual(customerImageEvents.map(event => event.status), ['sent', 'sent']);
  assert.equal(customerImageAttempts - customerBeforeAttempts, 1);
  assert.equal(customerImageSends - customerBeforeImageSends, 1);
  assert.equal(customerClient.sent.length - customerBeforeText, 1);
  const customerDailyText = customerClient.sent.at(-1)!;
  assert.match(customerDailyText, /^日报（/u);
  assert.ok(customerDailyText.includes(fact1));
  assert.deepEqual(Buffer.from(customerImages.at(-1)!), Buffer.from(expectedCustomerImage));
  await tickRole('customer');
  assert.equal(customerImageAttempts - customerBeforeAttempts, 1, 'customer weekly image duplicated');
  assert.equal(customerImageSends - customerBeforeImageSends, 1, 'customer weekly image reply duplicated');
  assert.equal(customerClient.sent.length - customerBeforeText, 1, 'customer daily text duplicated');

  // An explicit provider rejection must fall back to the saved owner text;
  // retrying the worker must not resend either the image or the fallback.
  customerMedia = 'rejected';
  try {
    const [customerFallback] = await generateReports([{ audience: 'customer', kind: 'weekly' }],
      new Date(customerImageStart.getTime() + 86400000));
    reports.push(customerFallback);
    const beforeText = customerClient.sent.length;
    const beforeAttempts = customerImageAttempts;
    const beforeImageSends = customerImageSends;
    await tickRole('customer');
    const fallbackEvent = await withTenantTransaction(eid, tx => one(tx, sql`select status from app.assistant_wechat_events
      where enterprise_id=${eid} and channel_id=${channelIds.customer} and report_id=${customerFallback.reportId} and proactive`));
    assert.equal(fallbackEvent?.status, 'sent');
    assert.equal(customerImageAttempts - beforeAttempts, 1);
    assert.equal(customerImageSends - beforeImageSends, 0);
    assert.equal(customerClient.sent.length - beforeText, 1);
    const fallbackText = customerClient.sent.at(-1)!;
    assert.match(fallbackText, /^周报（/u);
    assert.ok(fallbackText.includes(fact1));
    await tickRole('customer');
    assert.equal(customerImageAttempts - beforeAttempts, 1, 'customer rejected image duplicated');
    assert.equal(customerImageSends - beforeImageSends, 0, 'customer rejected image unexpectedly delivered');
    assert.equal(customerClient.sent.length - beforeText, 1, 'customer fallback text duplicated');
  } finally {
    customerMedia = 'image';
  }

  const reportManager = new ConstructionReportService({ enterpriseId: eid, adminId: fixture.boss });
  const reportSettings = await reportManager.settings();
  assert.throws(() => reportManager.configure({ expectedVersion: Number(reportSettings.version || 0), enabled: true,
    dailyTime: '20:00', weeklyTime: '08:00', projectIds: overflowProjects.map(project => String(project.id)), stageKeys: [],
    stageEnabled: true, weeklyDay: 1, audiences: ['customer', 'worker', 'designer', 'boss'], inactivePolicy: 'pause_inactive' }, randomUUID()),
    /construction_report_scope_too_large/);
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_report_settings
    set project_ids=${JSON.stringify(overflowProjects.map(project => String(project.id)))}::jsonb where enterprise_id=${eid}`));
  const overflowPlan = await reportManager.plan();
  assert.equal(overflowPlan.projectLimitExceeded, true);
  assert.ok(!overflowPlan.projects.some(project => project.id === externalProjectId));
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_report_settings
    set project_ids=${JSON.stringify([project1Id, project2Id, project3Id, project4Id, project5Id])}::jsonb where enterprise_id=${eid}`));

  const designerState = (await recipientState(requested.designer)).channel!;
  await recipientState(requested.designer, { kind: 'preferences', daily: false, weekly: true }, { id: designerState.id, version: designerState.version });
  const eventCountBefore = await withTenantTransaction(eid, tx => one(tx, sql`select count(*)::int as count from app.assistant_wechat_events
    where enterprise_id=${eid} and channel_id=${channelIds.designer} and proactive`));
  await withTenantTransaction(eid, tx => queueWechatReports(tx, eid));
  const eventCountAfter = await withTenantTransaction(eid, tx => one(tx, sql`select count(*)::int as count from app.assistant_wechat_events
    where enterprise_id=${eid} and channel_id=${channelIds.designer} and proactive`));
  assert.equal(Number(eventCountAfter?.count), Number(eventCountBefore?.count));
  const nextLead = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads
    (enterprise_id,customer_user_id,name,phone,source) values(1454,${fixture.secondCustomerUser},${label + '下一期工地'},'15910000006','natural') returning id`))!.id));
  const nextProject = await manage.execute('create', { leadId: nextLead, name: label + '下一期工地', managerId: fixture.boss, rooms: ['厨房'] }, randomUUID());
  const nextProjectId = String(nextProject.id);
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_report_settings
    set project_ids=project_ids || ${JSON.stringify([nextProjectId])}::jsonb where enterprise_id=${eid}`));
  const nextReports = await generateReports([
    { audience: 'boss', kind: 'daily' }, { audience: 'designer', kind: 'daily' }, { audience: 'designer', kind: 'weekly' },
  ], new Date(cutoff.getTime() + 86400000));
  reports.push(...nextReports);
  const [bossDaily, designerDaily, designerWeekly] = nextReports;
  const designerInApp = await new FollowupService(actors.designer).detail(bindingIds.designer, designerDaily.reportId, designerDaily.revision) as Row;
  assert.equal(designerInApp.deliveryState, 'delivered');
  await withTenantTransaction(eid, tx => queueWechatReports(tx, eid));
  const nextEvents = await withTenantTransaction(eid, tx => rows(tx, sql`select report_id::text as report_id from app.assistant_wechat_events
    where enterprise_id=${eid} and role_delivery_key is not null and report_id in (${bossDaily.reportId},${designerDaily.reportId},${designerWeekly.reportId})`));
  assert.deepEqual(nextEvents.map(event => event.report_id).sort(), [bossDaily.reportId, designerWeekly.reportId].sort());
  await tickRole('boss');
  const bossDigest = roleClients.get('boss')!.sent.at(-1)!;
  assert.ok(bossDigest.includes('共6个工地') && bossDigest.includes('下一期工地'));
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_members set active=false
    where enterprise_id=${eid} and project_id=${project2Id} and admin_id=${fixture.designer}`));
  const designerAfterRevoke = await new FollowupService(actors.designer).detail(bindingIds.designer, designerWeekly.reportId, designerWeekly.revision) as Row;
  assert.deepEqual(((designerAfterRevoke.facts as Row).projects as Row[]).map(project => String(project.id)), [project1Id, project5Id]);
  await tickRole('designer');
  const designerDigest = roleClients.get('designer')!.sent.at(-1)!;
  assert.ok(designerDigest.includes('共2个工地') && designerDigest.includes('设计专属工地') && !designerDigest.includes('滨江府'));
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_members set active=true
    where enterprise_id=${eid} and project_id=${project2Id} and admin_id=${fixture.designer}`));
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_projects set customer_access=false where enterprise_id=${eid} and id=${project1Id}`));
  await assert.rejects(recipientState(requested.customer), /(not_found|forbidden|context_changed)/);
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_projects set customer_access=true where enterprise_id=${eid} and id=${project1Id}`));
  await assert.rejects(recipientState({ ...requested.boss, actor: { ...actors.boss, enterpriseId: '1455' } }), /(not_found|forbidden|context_changed)/);

  const scenarios = [
    { mode: 'upload-failure', status: 'sent', images: 0, texts: 1 },
    { mode: 'rejected', status: 'sent', images: 1, texts: 1 },
    { mode: 'unknown', status: 'unknown', images: 1, texts: 0 },
    { mode: 'scope-change', status: 'sent', images: 0, texts: 1 },
  ] as const;
  const bossSent = roleClients.get('boss')!.sent;
  for (const [index, scenario] of scenarios.entries()) {
    const [report] = await generateReports([{ audience: 'boss', kind: 'weekly' }], new Date(cutoff.getTime() + (index + 2) * 86400000));
    reports.push(report);
    const beforeImages: number = imageSends;
    const beforeTexts = bossSent.length;
    bossMedia = scenario.mode;
    try {
      await tickRole('boss');
      const status = await withTenantTransaction(eid, tx => one(tx, sql`select status from app.assistant_wechat_events
        where enterprise_id=${eid} and channel_id=${channelIds.boss} and report_id=${report.reportId} and proactive`));
      assert.equal(status?.status, scenario.status, scenario.mode);
      assert.equal(imageSends - beforeImages, scenario.images, scenario.mode);
      assert.equal(bossSent.length - beforeTexts, scenario.texts, scenario.mode);
      if (scenario.texts) {
        const text = bossSent.at(-1)!;
        assert.match(text, /企业工地周报/u);
        assert.match(text, /下一期工地/u);
        if (scenario.mode === 'scope-change') assert.doesNotMatch(text, /设计专属工地/u);
      }
      await tickRole('boss');
      assert.equal(imageSends - beforeImages, scenario.images, `${scenario.mode} duplicate image`);
      assert.equal(bossSent.length - beforeTexts, scenario.texts, `${scenario.mode} duplicate text`);
    } finally {
      if (scenario.mode === 'scope-change') await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_projects set status='active'
        where enterprise_id=${eid} and id=${project5Id}`));
    }
  }

  // Body composition is not needed by the Stable role driver: facts and the
  // delivered report are already durable. Cancel only its queued background
  // jobs so this fixture does not leave an idle-queue guard behind.
  await withTenantTransaction(eid, async tx => {
    for (const report of reports) {
      const task = await one(tx, sql`select a.id,a.conversation_id from app.construction_report_versions v
        join app.assistant_runs a on a.enterprise_id=v.enterprise_id and a.id=v.body_run_id
        where v.enterprise_id=${eid} and v.report_id=${report.reportId} and v.revision=${report.revision}
          and a.status='queued' and a.purpose='construction.report.compose'`);
      if (task) await cancelRuns(tx, actors[report.audience], String(task.conversation_id), String(task.id));
    }
  });

  const output = process.env.XIAOK_WECHAT_QA_OUTPUT;
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'boss-weekly-notebook.png'), bossImages[0]);
    if (customerImages[0]) writeFileSync(join(output, 'customer-weekly-notebook.png'), customerImages[0]);
    const finalStates = {} as Record<RoleAudience, Record<string, unknown>>;
    for (const audience of ['customer', 'worker', 'designer', 'boss'] as const)
      finalStates[audience] = ((await recipientState(requested[audience])).channel || {}) as Record<string, unknown>;
    writeFileSync(join(output, 'role-fixture.json'), JSON.stringify({
      enterpriseId: eid, label, publication: (await manageMainPublication(eid, ownerId)).version,
      roles: (['customer', 'worker', 'designer', 'boss'] as const).map(audience => ({
        audience, actor: actors[audience], bindingId: bindingIds[audience], projectId: audience === 'customer' ? project1Id : null, leadId: lead1,
        mini: audience === 'customer'
          ? { uid: fixture.customerUser, role: 'user', mode: 'customer', contextVersion: 1 }
          : { uid: audience === 'worker' ? fixture.managerUser : audience === 'designer' ? fixture.designerUser : fixture.bossUser,
            role: audience === 'worker' ? 'construction_staff' : audience === 'designer' ? 'designer' : 'enterprise_admin', mode: 'staff',
            staffId: audience === 'worker' ? fixture.manager : audience === 'designer' ? fixture.designer : fixture.boss, contextVersion: 1 },
        channelId: channelIds[audience], channel: finalStates[audience], reportProjectIds: factsByAudience[audience],
      })),
      projects: [
        { id: project1Id, leadId: lead1, name: label + '云栖花园', sourceId: source1 },
        { id: project2Id, leadId: lead2, name: label + '滨江府', sourceId: source2 },
        { id: project3Id, leadId: String(extraLeads[0].id), name: label + '老板专属工地', sourceId: source3 },
        { id: project4Id, leadId: String(extraLeads[1].id), name: label + '施工专属工地', sourceId: source4 },
        { id: project5Id, leadId: String(extraLeads[2].id), name: label + '设计专属工地', sourceId: source5 },
      ],
      externalProjects: [{ enterpriseId: '1455', id: externalProjectId, leadId: externalLeadId, name: label + '外企业工地' }],
      reports: reports.map(report => ({ ...report, bindingId: bindingIds[report.audience] })),
    }, null, 2));
  }
});
