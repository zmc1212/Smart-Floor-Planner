import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { sharedMaterials } from '@/lib/construction/site-materials';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import type { ActorContext } from '@/lib/assistant/contracts';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';

/** Labelled synthetic data, only in the existing isolated development database. */
export class D4SharingFixture {
  readonly prefix = 'synthetic-d4-sharing-' + randomUUID();
  readonly enterpriseIds: string[] = [];
  readonly userIds: string[] = [];
  readonly ownerIds: string[] = [];
  readonly memberIds: string[] = [];
  readonly platformIds: string[] = [];
  projectId = ''; otherProjectId = ''; leadId = ''; conversationId = ''; roomId = '';
  get eid() { return this.enterpriseIds[0]; }
  get actor(): ActorContext { return { enterpriseId: this.eid, principal: { kind: 'user', userId: this.userIds[0] }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: this.leadId } }; }
  get chat() { return new ConversationService(this.actor); }
  get owner() { return new ConstructionService({ enterpriseId: this.eid, adminId: this.ownerIds[0] }); }
  site(adminId = this.ownerIds[0]) { return new SiteChatService({ enterpriseId: this.eid, adminId }); }
  async create(config: Row = { runtime: 'langgraph-v1', providerKey: 'synthetic-no-dispatch', model: 'synthetic-no-dispatch', tools: true, imageInput: false, probeVersion: 'd4-sharing' }) {
    const target = new URL(resolvePostgresRuntimeConfig().connectionString);
    assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
    assert.equal(target.port, process.env.XIAOK_ISOLATED_POSTGRES_PORT || '55432');
    assert.equal(target.pathname, '/xiaok_embedding_eval');
    await withPlatformTransaction(async tx => {
      for (const role of ['admin', 'super_admin']) this.platformIds.push(String((await one(tx, sql`insert into app.admin_users(username,password_hash,role,status,must_change_password,display_name)
        values(${this.prefix + role},'unusable-synthetic',${role},'active',false,${'测试管理者' + role}) returning id`))!.id));
      for (let i = 0; i < 2; i++) {
        const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · D4自然共享',${this.prefix + i},'active') returning id`))!.id);
        this.enterpriseIds.push(eid);
        await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
          values(${eid},true,100,12000000,100000000,30,${JSON.stringify(config)}::jsonb)`);
        this.ownerIds.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
          values(${eid},${this.prefix + i},'unusable-synthetic','enterprise_admin','active',false,'测试负责人') returning id`))!.id));
      }
      for (const [i, role] of ['designer', 'construction_staff', 'construction_staff'].entries()) this.memberIds.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${this.eid},${this.prefix + 'member' + i},'unusable-synthetic',${role},'active',false,${['测试设计师','测试师傅','测试观察员'][i]}) returning id`))!.id));
      for (let i = 0; i < 2; i++) {
        const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${this.prefix + i},1) returning id`))!.id);
        this.userIds.push(uid); await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${this.prefix + i})`);
      }
    });
    this.leadId = String((await withTenantTransaction(this.eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${this.eid},${this.userIds[0]},'测试专用 · 自然共享业主','13000000000','manual') returning id`)))!.id);
    for (const name of ['测试工地甲', '测试工地乙']) {
      const p = await this.owner.execute('create', { leadId: this.leadId, name, managerId: this.ownerIds[0], rooms: ['书房','客厅'] }, randomUUID());
      if (!this.projectId) this.projectId = String(p.id); else this.otherProjectId = String(p.id);
    }
    for (const [i, aid] of this.memberIds.entries()) await this.member(aid, ['designer','worker','observer'][i], true);
    this.roomId = String(((await this.site().read(this.projectId)).rooms as Row[]).find(r => r.name === '书房')!.id);
    this.conversationId = String((await this.chat.create(randomUUID())).id);
    await withTenantTransaction(this.eid, tx => appendMessage(tx, this.actor, this.conversationId, { author: 'user', clientMessageId: randomUUID(),
      content: { version: 1, blocks: [{ type: 'text', text: 'PRIVATE_DO_NOT_SHARE 家人作息与个人隐私，不能给项目团队。' }] } }));
  }
  async member(adminId: string, role: string, active: boolean) {
    const version = Number(((await this.owner.execute('detail', { projectId: this.projectId })).project as Row).version);
    return this.owner.execute('member', { projectId: this.projectId, expectedVersion: version, adminId, role, active, workLabel: '' }, randomUUID());
  }
  send(text: string, key = randomUUID()) { return this.chat.send(this.conversationId, key, { version: 1, blocks: [{ type: 'text', text }] }, siteWatchInterceptor); }
  sources() { return withTenantTransaction(this.eid, tx => sharedMaterials(tx, this.eid, this.projectId, this.roomId)); }
  /** Engineering setup for read/final-answer regressions, not a model journey.
   * Uses the original domain writers; the injected record extractor makes no
   * provider request and reports zero external tokens. */
  async prepareReturnedIssue(drawingGrantId: string, input: { open: string; reply: string; return: string }) {
    const worker = this.site(this.memberIds[1]), designer = this.site(this.memberIds[0]);
    const picture = await sharp({ create: { width: 96, height: 72, channels: 3, background: '#c9dfd0' } }).png().toBuffer();
    const media = await worker.upload(this.projectId, randomUUID(), picture);
    const sent = await worker.send(this.projectId, { text: '书房底盒今天还没固定，等待核对位置。', mediaIds: [String(media.id)] }, randomUUID());
    const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
    await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '测试专用 · 底盒待核对', roomId: this.roomId, completed: '线管铺好', pending: '底盒还没固定', coordination: '现场核准桌子摆位', note: '' }),
      toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } }));
    const draft = ((await this.site().read(this.projectId)).items as Row[]).find(i => (i.record as Row)?.id === String(sent.recordId))!.record as Row;
    const published = await this.site().mutate(this.projectId, String(sent.recordId), 'publish', { expectedVersion: Number(draft.version), audience: 'customer' }, randomUUID());
    const say = async (service: SiteChatService, text: string) => service.send(this.projectId, { text, mediaIds: [], versions: (await service.read(this.projectId)).versions }, randomUUID());
    const opened = await say(worker, '跟进记录' + sent.recordId + '：PRIVATE_INTERNAL_REQUEST ' + input.open), issueId = String(opened.issueId);
    await say(designer, '接手事项' + issueId); await say(designer, '核对事项' + issueId + '图纸' + drawingGrantId);
    await say(designer, '回复事项' + issueId + '：PRIVATE_INTERNAL_REPLY ' + input.reply);
    await say(this.site(), '回传事项' + issueId + '：' + input.return); await deliverSiteNotifications();
    return { recordId: String(sent.recordId), issueId, recordRunId: String(sent.runId), publishedVersion: published.version, externalModelCalls: 0 };
  }
  snapshot() { return withTenantTransaction(this.eid, async tx => ({
    fixture: { enterpriseIds: this.enterpriseIds, userIds: this.userIds, ownerIds: this.ownerIds, memberIds: this.memberIds, platformIds: this.platformIds,
      projectId: this.projectId, otherProjectId: this.otherProjectId, conversationId: this.conversationId, leadId: this.leadId, roomId: this.roomId },
    runs: await rows(tx, sql`select id::text,status,error_code,output_message_id::text,policy_snapshot from app.assistant_runs where enterprise_id=${this.eid} order by id`),
    steps: await rows(tx, sql`select run_id::text,step_seq,kind,capability_name,status,input_summary,private_checkpoint from app.assistant_run_steps where enterprise_id=${this.eid} order by run_id,step_seq`),
    events: await rows(tx, sql`select id::text,type,aggregate_id,payload from app.domain_event_outbox where enterprise_id=${this.eid} and type like 'construction.material.%' order by id`),
  })); }
  async cleanup() {
    await withPlatformTransaction(async tx => {
      for (const eid of this.enterpriseIds) {
        await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
        await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
        await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);
        await tx.execute(sql`delete from app.enterprises where id=${eid}`);
      }
      for (const uid of this.userIds) { await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`); await tx.execute(sql`delete from app.users where id=${uid}`); }
      for (const aid of this.platformIds) await tx.execute(sql`delete from app.admin_users where id=${aid}`);
    });
  }
}
