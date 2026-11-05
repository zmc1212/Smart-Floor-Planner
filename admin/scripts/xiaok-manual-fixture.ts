/** Retained, labelled manual-test data in an explicitly selected development
 * enterprise. No model dispatch, customer approval, real-account edits or cleanup.
 * Reentry uses the persisted manifest and original operation keys/bodies. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { PublicMaterialService } from '@/lib/construction/public-service';
import { PublicCustomerService } from '@/lib/construction/public-customer';
import { PublicSiteCatalog } from '@/lib/construction/public-read';
import { PortfolioService } from '@/lib/portfolio/service';
import { PortfolioCatalog } from '@/lib/portfolio/catalog';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { ServiceOrderService } from '@/lib/construction/service-order';
import { parseFormalSurveyLayout, adaptSurveyGraphToRooms } from '@/lib/survey-graph';
import { grantMaterial } from '@/lib/construction/site-materials';
import { executeSiteIssue, parseSiteVersions, readSiteIssue } from '@/lib/construction/site-issues';
import { executePlanCommand, readPlan } from '@/lib/construction/site-plans';
import type { ActorContext } from '@/lib/assistant/contracts';

const admin = path.resolve(process.cwd()), root = path.resolve(admin, '..');
loadEnvConfig(admin, true);
const flag = (name: string) => process.argv.find(v => v.startsWith('--' + name + '='))?.slice(name.length + 3);
const eid = flag('enterprise-id'), uid = flag('customer-id');
const output = path.resolve(flag('output') || path.join(root, 'tmp/xiaok-manual-fixture-20261030'));
const tag = 'xiaok-manual-1454-v1', prefix = '合成手测';
const manifestFile = path.join(output, 'manifest.json'), credentialsFile = path.join(output, 'accounts.private.json');
type FixtureState = {
  tag: string;
  enterpriseId: string;
  customerId: string;
  createdAt: string;
  keys: Record<string, string>;
  inputs: Record<string, Row>;
  // staff() persists an ID string; other once() slots keep their own result type.
  results: Record<string, unknown> & Record<`staff.${string}`, string>;
  complete: boolean;
  current?: string;
  userContextVersions?: Record<string, number>;
  foundationReady?: boolean;
  dataset?: Row;
  error?: { step?: string; code: unknown; message: string; at: string };
};
type FixtureCredentials = {
  enterpriseId: string;
  note: string;
  accounts: Record<string, {
    username: string;
    password: string;
    role: string;
    name: string;
    developmentPhonePlaceholder?: string;
    phoneNote?: string;
  }>;
};
type ProjectDetail = { project: { version: number } };
type WorkDetail = { work: { version: number } };
type KnowledgeCreated = { document: { id: unknown; title: unknown }; draft: { id: unknown } };
let state: FixtureState, credentials: FixtureCredentials;
let lock: pg.Client | undefined;
function save() { fs.writeFileSync(manifestFile, JSON.stringify(state, null, 2)); }
function key(slot: string) { if (!state.keys[slot]) { state.keys[slot] = randomUUID(); save(); } return state.keys[slot] as string; }
async function once<T>(slot: string, fn: () => Promise<T>): Promise<T> {
  if (Object.hasOwn(state.results, slot)) return state.results[slot] as T;
  state.current = slot; save();
  const result = await fn(); state.results[slot] = result; save();
  console.log(JSON.stringify({ step: slot, prepared: true })); return result;
}
async function write<T>(slot: string, input: Row, fn: (body: Row, requestKey: string) => Promise<T>): Promise<T> {
  if (!state.inputs[slot]) { state.inputs[slot] = input; save(); }
  return once(slot, () => fn(state.inputs[slot], key(slot)));
}
const customer = (userId: string, leadId?: string): ActorContext => ({ enterpriseId: eid!, principal: { kind: 'user', userId }, contextVersion: Number(state?.userContextVersions?.[userId] || 1),
  capabilities: ['assistant.chat.self'], ...(leadId ? { entry: { kind: 'lead', id: leadId } } : {}) });

function layout(widthMm: number, heightMm: number) {
  const xs = [0, widthMm * .6, widthMm], ys = [0, heightMm * .4, heightMm], names = ['客厅', '书房', '主卧', '次卧'];
  const nodes = ys.flatMap((yMm, y) => xs.map((xMm, x) => ({ id: `n${x}${y}`, xMm, yMm })));
  const walls: Row[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) walls.push({ id: `h${x}${y}`, startNodeId: `n${x}${y}`, endNodeId: `n${x + 1}${y}`, lengthMm: xs[x + 1] - xs[x], thicknessMm: 120, use: 'room-boundary' });
  for (let x = 0; x < 3; x++) for (let y = 0; y < 2; y++) walls.push({ id: `v${x}${y}`, startNodeId: `n${x}${y}`, endNodeId: `n${x}${y + 1}`, lengthMm: ys[y + 1] - ys[y], thicknessMm: 120, use: 'room-boundary' });
  const spaces = [0, 1].flatMap(y => [0, 1].map(x => ({ id: `space${x}${y}`, name: names[y * 2 + x], closed: true,
    wallIds: [`h${x}${y}`, `v${x + 1}${y}`, `h${x}${y + 1}`, `v${x}${y}`] })));
  return { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'f1', floors: [{ id: 'f1', name: '一层', ceilingHeightMm: 2700, nodes, walls, openings: [], spaces }] } };
}
async function staff(code: string, role: string, name: string) {
  const username = 'xiaok_manual_1454_' + code;
  if (!credentials.accounts[code]) {
    credentials.accounts[code] = { username, password: 'XkDemo-' + randomBytes(12).toString('base64url'), role, name };
    fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2));
    execFileSync('icacls.exe', [credentialsFile, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(F)', 'SYSTEM:(F)', 'Administrators:(F)'], { windowsHide: true, stdio: 'ignore' });
  }
  return once('staff.' + code, async () => withPlatformTransaction(async tx => {
    const existing = await one(tx, sql`select id,enterprise_id,role,display_name from app.admin_users where username=${username}`);
    if (existing) { assert.equal(String(existing.enterprise_id), eid); assert.equal(existing.role, role); assert.equal(existing.display_name, name); return String(existing.id); }
    const hash = await bcrypt.hash(credentials.accounts[code].password, 10);
    return String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name,construction_trades)
      values(${eid},${username},${hash},${role},'active',false,${name},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(role === 'construction_staff' ? [code === 'worker' ? '水电' : '现场协调'] : [])}::jsonb))) returning id`))!.id);
  }));
}
async function staffPhone(code: string, adminId: string, index: number) {
  // Development-only fixture numbers satisfy the existing staff identity data
  // contract. They are not verified phones, SMS destinations or dial targets.
  const phone = '1990000145' + index;
  return once('staff-phone.' + code, () => withPlatformTransaction(async tx => {
    const admin = await one(tx, sql`select id,user_id,phone,display_name from app.admin_users where id=${adminId} and enterprise_id=${eid} and username=${'xiaok_manual_1454_' + code} for update`);
    assert.ok(admin && String(admin.display_name).startsWith(prefix));
    if (admin.user_id) {
      assert.notEqual(String(admin.user_id), uid, 'Never alter the real tester identity');
      const user = await one(tx, sql`select id,nickname,phone from app.users where id=${String(admin.user_id)} for update`);
      assert.ok(user && String(user.nickname).startsWith(prefix));
      assert.ok(!user.phone || user.phone === phone, 'Keep an explicitly edited phone intact');
      const collision = await one(tx, sql`select id from app.users where phone=${phone} and id<>${String(user.id)} limit 1`); assert.ok(!collision);
      await tx.execute(sql`update app.users set phone=${phone} where id=${String(user.id)}`);
    }
    const collision = await one(tx, sql`select id from app.admin_users where phone=${phone} and id<>${adminId} limit 1`); assert.ok(!collision);
    assert.ok(!admin.phone || admin.phone === phone, 'Keep an explicitly edited staff phone intact');
    await tx.execute(sql`update app.admin_users set phone=${phone} where id=${adminId} and enterprise_id=${eid}`);
    credentials.accounts[code].developmentPhonePlaceholder = phone;
    credentials.accounts[code].phoneNote = '开发占位号，未做真实手机号授权；不用于短信或拨号。';
    fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2));
    return { adminId, syntheticUserId: admin.user_id ? String(admin.user_id) : null, developmentPhonePlaceholder: phone };
  }));
}
async function lead(slot: string, userId: string, name: string, measurerId: string) {
  return once('lead.' + slot, async () => withTenantTransaction(eid!, async tx => {
    const old = await one(tx, sql`select id from app.leads where enterprise_id=${eid} and customer_user_id=${userId} and name=${name} and community_name=${name}`);
    if (old) return String(old.id);
    return String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,community_name,source,measurer_id)
      values(${eid},${userId},${name},'',${name},'natural',${measurerId}) returning id`))!.id);
  }));
}
async function formalPlan(slot: string, leadId: string, width: number, height: number) {
  return once('floorplan.' + slot, async () => {
    const data = layout(width, height), parsed = parseFormalSurveyLayout(data); assert.ok(parsed, 'Formal v4 fixture must parse');
    const rooms = adaptSurveyGraphToRooms(parsed!); assert.ok(rooms.length >= 4, 'Fixture must expose four closed rooms');
    return withTenantTransaction(eid!, async tx => {
      const id = String((await one(tx, sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data)
        values(${eid},${uid},${prefix + slot + '屋·正式主户型'},'manual','completed',${JSON.stringify(data)}::jsonb) returning id`))!.id);
      await tx.execute(sql`update app.leads set primary_floor_plan_id=${id} where enterprise_id=${eid} and id=${leadId} and customer_user_id=${uid}`);
      return { id, leadId, rooms: rooms.map(r => ({ id: r.id, name: r.name })), areaSquareMeters: width * height / 1e6 };
    });
  });
}
async function createProject(slot: string, leadId: string, managerId: string, members: Record<string, string>, stage: string, owner: ConstructionService) {
  const result = await write('project.' + slot, { leadId, name: prefix + slot + '工地·小K全流程', managerId, rooms: ['客厅', '书房', '主卧', '次卧'] }, (b, k) => owner.execute('create', b, k));
  const id = String(result.id);
  for (const [role, adminId] of Object.entries(members)) {
    const detail = await owner.execute('detail', { projectId: id }) as ProjectDetail;
    await write('member.' + slot + '.' + role, { projectId: id, expectedVersion: detail.project.version, adminId, role, active: true, workLabel: prefix + '·' + role }, (b, k) => owner.execute('member', b, k));
  }
  const detail = await owner.execute('detail', { projectId: id }) as ProjectDetail;
  await write('stage.' + slot, { projectId: id, expectedVersion: detail.project.version, stageKey: stage, note: '合成手测起始节点，不是实际施工或验收记录。', sendReminder: false }, (b, k) => owner.execute('progress', b, k));
  return id;
}
async function record(slot: string, projectId: string, adminId: string, bytes: Buffer, publish: boolean) {
  const site = new SiteChatService({ enterpriseId: eid!, adminId });
  const media = await once('record-media.' + slot, () => site.upload(projectId, key('record-media.' + slot), bytes));
  const sent = await write('record-source.' + slot, { text: '【合成手测】书房示例线管已布置，底盒位置和窗边书桌插座仍待核对。图片为测试素材，不是实际客户工地。', mediaIds: [String(media.id)] }, (b, k) => site.send(projectId, b as never, k));
  const rid = String(sent.recordId), detail = await site.read(projectId), room = (detail.rooms as Row[]).find(r => r.name === '书房');
  const raw = await withTenantTransaction(eid!, tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${rid}`));
  const edited = await write('record-edit.' + slot, { expectedVersion: Number(raw!.version), data: { title: prefix + '·书房水电点位', roomId: room?.id || null, completed: '测试示例：线管布置完成', pending: '窗边书桌插座位置待核对', coordination: '请测试设计师核对点位示意与使用需求', note: '仅供小K全流程手测；不代表工程验收、真实报价或工期承诺。' } }, (b, k) => site.mutate(projectId, rid, 'edit', b, k));
  if (publish) {
    const reviewer = new SiteChatService({ enterpriseId: eid!, adminId: state.results['staff.manager'] });
    await write('record-publish.' + slot, { expectedVersion: edited.version, audience: 'customer' }, (b, k) => reviewer.mutate(projectId, rid, 'publish', b, k));
  }
  return { recordId: rid, mediaId: String(media.id), roomId: String(room?.id || ''), published: publish };
}
async function publicMaterial(slot: string, projectId: string, sourceRecord: Row, ownerId: string, customerId: string, conversationId: string, publish: boolean) {
  const service = new PublicMaterialService({ enterpriseId: eid!, adminId: ownerId }), detail = await service.read(projectId);
  const source = (detail.sourceItems as Row[]).find(s => s.id === sourceRecord.recordId); assert.ok(source);
  let current = await write('public-save.' + slot, { expectedRevision: detail.revision, material: { name: prefix + slot + '工地·西陵区', cityCode: '420500', district: '西陵区', sources: [{ kind: source.kind, id: source.id, sourceHash: source.sourceHash, text: source.text }], photos: [{ recordId: sourceRecord.recordId, mediaId: sourceRecord.mediaId, masks: [] }] } }, (b, k) => service.save(projectId, b, k));
  current = await write('public-submit.' + slot, { versionId: current.versionId, expectedRevision: current.revision }, (b, k) => service.mutate(projectId, 'submit', b, k));
  if (publish) {
    assert.notEqual(customerId, uid, 'Never fabricate approval for the real tester');
    const decisions = new PublicCustomerService(customer(customerId), conversationId);
    for (const action of ['preview', 'approve']) current = await write('public-' + action + '.' + slot, { versionId: current.versionId, expectedRevision: current.revision }, (b, k) => decisions.decide(String(current.id), action, b, k));
    current = await write('public-publish.' + slot, { versionId: current.versionId, expectedRevision: current.revision }, (b, k) => service.mutate(projectId, 'publish', b, k));
  }
  return current;
}
async function conversation(slot: string, userId: string, leadId: string) {
  const result = await once('conversation.' + slot, () => new ConversationService(customer(userId, leadId)).create(key('conversation.' + slot)));
  await once('conversation-title.' + slot, () => withTenantTransaction(eid!, tx => tx.execute(sql`update app.assistant_conversations set title=${prefix + slot + '屋·人工测试'} where enterprise_id=${eid} and id=${String(result.id)} returning id`)));
  return String(result.id);
}
/** Explicitly labelled fixture provenance. These preparation sources are not
 * model output, customer journey evidence or approval of a customer decision. */
async function prepareDecision(leadId: string, projectId: string, sourceRecord: Row, designerId: string) {
  const cid = await conversation('甲·方案决定起点', uid!, leadId), actor = customer(uid!, leadId);
  const grant = await once('decision.need-grant', () => withTenantTransaction(eid!, async tx => {
    const repo = new AssistantRepository(tx, actor), c = await repo.conversation(cid);
    const inputId = key('decision.need-source');
    const source = await one(tx, sql`select * from app.assistant_messages where enterprise_id=${eid} and conversation_id=${cid} and client_message_id=${inputId}`)
      || await appendMessage(tx, actor, cid, { author: 'user', clientMessageId: inputId,
        content: { version: 1, blocks: [{ type: 'text', text: '【合成手测初始化】甲屋书房希望保留靠窗书桌与孩子阅读角，先核对插座位置再施工。本条为本次测试数据准备请求创建的合成需求，仅共享给合成手测甲工地书房成员，不是实际装修委托。' }] } });
    return grantMaterial(tx, actor, c, source, { project_id: projectId, room_id: sourceRecord.roomId, room_name: '书房', project_name: prefix + '甲工地·小K全流程' }, 'need',
      '【合成手测】书房希望保留靠窗书桌与孩子阅读角，插座位置需测试设计师核对并提交方案；不是实际施工要求。', null);
  }));
  const site = new SiteChatService({ enterpriseId: eid!, adminId: designerId });
  const action = async (slot: string, cmd: Row, text: string) => once(slot, async () => {
    const versions = parseSiteVersions((await site.read(projectId)).versions);
    return site.withWriteScope(projectId, async (tx, c, _p, permission) => {
      const clientId = key(slot + '.source');
      const source = await one(tx, sql`select * from app.assistant_messages where enterprise_id=${eid} and conversation_id=${String(c.id)} and client_message_id=${clientId}`)
        || await appendMessage(tx, site.actor, String(c.id), { author: 'admin', clientMessageId: clientId, purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text }] } });
      const previous = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='construction.site.issue.progress.v1' and correlation_id=${String(source.id)} limit 1`);
      if (previous && cmd.action !== 'open') return readSiteIssue(tx, eid!, projectId, String(cmd.target));
      return executeSiteIssue(tx, site.actor, projectId, String(source.id), cmd as never, versions, permission.manage);
    });
  });
  const opened = await action('decision.issue-open', { action: 'open', target: sourceRecord.recordId, value: '合成手测：核对书房窗边插座与阅读角的使用需求' }, '【合成手测初始化】请建立书房插座点位核对事项，作为手测方案起点。');
  await action('decision.issue-claim', { action: 'claim', target: opened!.issueId, value: '' }, '【合成手测初始化】测试设计师接手本书房事项。');
  const issue = await action('decision.issue-reply', { action: 'reply', target: opened!.issueId, value: '合成手测：已核对本次共享需求，提交插座位置示例方案供测试业主决定；并未施工或验收。' }, '【合成手测初始化】测试设计师准备插座示例方案，等待测试业主决定。');
  const picture = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#fbf8ef"/><text x="80" y="90" font-size="40" fill="#1c5944">合成手测 · 书房插座示意 V1</text><rect x="180" y="170" width="800" height="520" fill="none" stroke="#3d5750" stroke-width="12"/><path d="M400 170h350" stroke="#7db6c8" stroke-width="25"/><rect x="390" y="250" width="360" height="140" fill="#d6bf96"/><text x="480" y="335" font-size="32">靠窗书桌</text><rect x="820" y="470" width="100" height="150" fill="#d8e4d0"/><text x="540" y="520" font-size="30">阅读角</text><circle cx="760" cy="240" r="24" fill="#e2a14a"/><text x="800" y="250" font-size="28">插座示意</text><text x="100" y="780" font-size="30" fill="#a15b3c">仅用于人工测试，非施工图；未核验现场尺寸，不可据此施工。</text><text x="100" y="830" font-size="28" fill="#687269">测试差异：书桌右侧预留插座；测试费用 +100 元 / 工期 +1 天</text></svg>')).png().toBuffer();
  const media = await once('decision.plan-media', () => site.upload(projectId, key('decision.plan-media'), picture));
  const published = await once('decision.plan-publish', async () => {
    const versions = parseSiteVersions((await site.read(projectId)).versions);
    return site.withWriteScope(projectId, async (tx, c, _p, permission) => {
      const clientId = key('decision.plan-source');
      const source = await one(tx, sql`select * from app.assistant_messages where enterprise_id=${eid} and conversation_id=${String(c.id)} and client_message_id=${clientId}`)
        || await appendMessage(tx, site.actor, String(c.id), { author: 'admin', clientMessageId: clientId, purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: '【合成手测初始化】发布书房插座示例方案V1。测试差异：书桌右侧预留插座；示例费用增加100元、工期增加1天，仅供明确版本决定测试，不是真实报价或施工许可。' }] } });
      const old = await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and type='construction.plan.published.v1' and payload->>'sourceMessageId'=${String(source.id)} limit 1`);
      if (old) return { id: String(old.id) };
      return executePlanCommand(tx, site.actor, projectId, String(source.id), { action: 'publish', issueId: issue!.issueId, title: prefix + '·书房插座示例方案V1', difference: '合成手测：书桌右侧预留插座，其他需求保持；仅示意，非正式施工图。', costDeltaCents: 10000, scheduleDeltaDays: 1 }, [String(media.id)], versions, permission.manage);
    });
  });
  const plan = await site.withReadScope(projectId, tx => readPlan(tx, eid!, String(published.id)));
  assert.ok(plan); assert.equal(plan.status, 'pending_customer');
  return { conversationId: cid, grantId: grant.id, issueId: issue!.issueId, planId: String(published.id), planNumber: plan.number, planStatus: plan.status, mediaId: String(media.id) };
}
async function main() {
  assert.equal(eid, '1454', 'This retained fixture is explicitly scoped to 微云1454'); assert.equal(uid, '645', 'Use the verified current tester645');
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname)); assert.equal(target.port, '5432'); assert.equal(target.pathname, '/smart_floor_planner');
  fs.mkdirSync(output, { recursive: true });
  state = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { tag, enterpriseId: eid, customerId: uid, createdAt: new Date().toISOString(), keys: {}, inputs: {}, results: {}, complete: false };
  assert.equal(state.tag, tag); assert.equal(state.enterpriseId, eid); assert.equal(state.customerId, uid);
  credentials = fs.existsSync(credentialsFile) ? JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) : { enterpriseId: eid, note: '仅合成手测员工账号；当前业主账号与真实员工密码未改。', accounts: {} };
  lock = new pg.Client({ connectionString: target.toString(), connectionTimeoutMillis: 5000 }); await lock.connect();
  assert.equal((await lock.query("select pg_try_advisory_lock(hashtext('xiaok_manual_fixture_1454')) acquired")).rows[0].acquired, true, 'Fixture setup is already running');
  const enterprise = await withPlatformTransaction(tx => one(tx, sql`select id,name,status from app.enterprises where id=${eid}`));
  assert.equal(enterprise?.name, '微云'); assert.equal(enterprise?.status, 'active');
  const tester = await withPlatformTransaction(tx => one(tx, sql`select id,context_version from app.users where id=${uid}`)); assert.ok(tester);
  state.userContextVersions = { ...(state.userContextVersions || {}), [uid!]: Number(tester.context_version) };
  const currentOwner = await withPlatformTransaction(tx => one(tx, sql`select id from app.admin_users where enterprise_id=${eid} and role='enterprise_admin' and status='active' and not must_change_password order by id limit 1`)); assert.ok(currentOwner);
  const ownerId = String(currentOwner.id), owner = new ConstructionService({ enterpriseId: eid!, adminId: ownerId });
  if (!process.argv.includes('--seed-development')) { console.log(JSON.stringify({ dryRun: true, enterprise, customerId: uid, manifestExists: fs.existsSync(manifestFile), alreadyComplete: state.complete })); return; }
  save();
  const designerA = await staff('designer_a', 'designer', prefix + '设计师·林木');
  const designerB = await staff('designer_b', 'designer', prefix + '设计师·简禾');
  const managerId = await staff('manager', 'construction_staff', prefix + '项目经理·周工');
  const workerId = await staff('worker', 'construction_staff', prefix + '施工员工·陈师傅');
  const observerId = await staff('observer', 'construction_staff', prefix + '观察成员');
  const measurerId = await staff('measurer', 'measurer', prefix + '量房顾问');
  for (const [index, [code, id]] of [['designer_a', designerA], ['designer_b', designerB], ['manager', managerId], ['worker', workerId], ['observer', observerId], ['measurer', measurerId]].entries()) await staffPhone(code, id, index);
  if (state.complete) { state.current = 'ready-for-human-testing'; delete state.error; save(); console.log(JSON.stringify({ alreadyComplete: true, retained: true, manifest: manifestFile })); return; }
  const syntheticOwner = await once('synthetic-owner', () => withPlatformTransaction(async tx => {
    const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + '公开样板业主'},1) returning id`))!;
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(user.id)},${tag + '-public-owner'})`); return String(user.id);
  }));
  const leadA = await lead('甲', uid!, prefix + '甲屋·90㎡旧房', measurerId), leadB = await lead('乙', uid!, prefix + '乙屋·120㎡新房', measurerId);
  const publicLead = await lead('公开样板', syntheticOwner, prefix + '公开样板屋', measurerId);
  const planA = await formalPlan('甲', leadA, 10000, 9000), planB = await formalPlan('乙', leadB, 12000, 10000);
  const members = { designer: designerA, worker: workerId, observer: observerId };
  const projectA = await createProject('甲', leadA, managerId, members, 'utilities', owner);
  const projectB = await createProject('乙', leadB, managerId, { designer: designerB, worker: workerId }, 'masonry_carpentry', owner);
  const publicProject = await createProject('公开样板', publicLead, managerId, { designer: designerA, worker: workerId }, 'utilities', owner);
  const cidA = await conversation('甲', uid!, leadA), cidB = await conversation('乙', uid!, leadB), cidPublicOwner = await conversation('公开样板', syntheticOwner, publicLead);
  const sitePhoto = fs.readFileSync(path.join(root, 'design-references/xiaok-s04-site-records-v1/site-photo.jpg'));
  const rA = await record('甲-已发布', projectA, workerId, sitePhoto, true);
  const rDraft = await record('甲-待核对', projectA, workerId, sitePhoto, false);
  const rB = await record('乙-已发布', projectB, workerId, sitePhoto, true);
  const rPublic = await record('公开样板', publicProject, workerId, sitePhoto, true);
  const publicSite = await publicMaterial('公开样板', publicProject, rPublic, ownerId, syntheticOwner, cidPublicOwner, true);
  const consent = await publicMaterial('甲-待业主决定', projectA, rA, ownerId, uid!, cidA, false);
  const assets = path.join(root, 'design-references/designer-portfolio-publishing-v1/redesign-proposal/long-page-v1/assets');
  const specs = [
    { authorId: designerA, title: prefix + '·90㎡原木客厅', style: '原木风', image: 'oak-living.jpg', area: 90, layout: '三居', template: 'gallery' },
    { authorId: designerA, title: prefix + '·120㎡现代客厅', style: '现代简约', image: 'modern-living.jpg', area: 120, layout: '三居', template: 'gallery' },
    { authorId: designerB, title: prefix + '·80㎡奶油卧室', style: '奶油风', image: 'cream-bedroom.jpg', area: 80, layout: '两居', template: 'notebook' },
    { authorId: designerB, title: prefix + '·110㎡原木新家', style: '原木风', image: 'oak-living.jpg', area: 110, layout: '三居', template: 'notebook' },
  ];
  const managerPortfolio = new PortfolioService({ enterpriseId: eid!, adminId: ownerId }), works: Row[] = [];
  for (const [index, spec] of specs.entries()) {
    const service = new PortfolioService({ enterpriseId: eid!, adminId: spec.authorId }), slot = 'work.' + index;
    const work = await write(slot + '.create', {}, (b, k) => service.execute('create', b, k)), workId = String(work.id);
    const bytes = await sharp(path.join(assets, spec.image)).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
    const uploaded = await write(slot + '.upload', { workId, expectedVersion: 1, imageBase64: bytes.toString('base64') }, (b, k) => service.execute('upload', b, k));
    const content = { title: spec.title, description: '合成手测演示作品，供小K风格讨论、作者主页、作品偏好与真人接待测试。不是微云实际客户案例、报价或交付承诺。',
      primaryStyle: spec.style, secondaryStyles: [], cityCode: '420500', cityName: '宜昌市', district: '西陵区', communityId: null,
      area: spec.area, rooms: spec.layout === '两居' ? '2室2厅' : '3室2厅', layoutTypes: [spec.layout], authorRole: '主创设计',
      source: '项目已有独立合成室内图，仅作合成手测', authorization: '合成手测账户使用项目演示素材，非真实业主案例', rightsUntil: null,
      highlights: ['合成手测·采光与动线讨论', '合成手测·收纳需求比较'], materials: ['演示木饰面', '演示浅色墙面'],
      palette: [{ name: '演示米白', hex: '#f2ede4' }, { name: '演示暖木', hex: '#c8a97e' }], tours: [],
      images: [{ assetId: String(uploaded.assetId), kind: 'render', aiGenerated: true, showroom: false, caption: '合成手测效果图，非真实交付', space: index === 2 ? '主卧' : '客厅' }],
      coverAssetId: String(uploaded.assetId), showOnProfile: true, recommendable: true };
    await write(slot + '.save', { workId, expectedVersion: 1, content }, (b, k) => service.execute('save', b, k));
    let detail = await service.execute('detail', { workId }) as WorkDetail;
    await write(slot + '.submit', { workId, expectedVersion: detail.work.version }, (b, k) => service.execute('submit', b, k));
    detail = await service.execute('detail', { workId }) as WorkDetail;
    await write(slot + '.publish', { workId, expectedVersion: detail.work.version }, (b, k) => managerPortfolio.execute('publish', b, k));
    works.push({ workId, authorId: spec.authorId, title: spec.title, style: spec.style, template: spec.template });
  }
  for (const [authorId, template, label] of [[designerA, 'gallery', '林木'], [designerB, 'notebook', '简禾']]) {
    const authored = works.filter(w => w.authorId === authorId), service = new PortfolioService({ enterpriseId: eid!, adminId: authorId });
    await write('profile.' + authorId, { authorId, expectedVersion: 0, content: { template, bio: '合成手测设计顾问' + label + '，仅用于体验作品推荐与接待流程，不代表真实履历或资质。',
      cities: [{ code: '420500', name: '宜昌市', districts: [] }], styles: authored.map(w => w.style), layoutSpecialties: ['两居', '三居'], featuredWorkIds: authored.map(w => w.workId) } }, (b, k) => service.execute('saveProfile', b, k));
  }
  const knowledge = new KnowledgeService({ enterpriseId: eid!, adminId: ownerId });
  const knowledgeDrafts: Row[] = [];
  for (const [slot, audience, title, body] of [
    ['public', 'customer_public', prefix + '·书房使用说明', '【合成测试资料，不用于实际施工】\n书房长时间使用屏幕时，应先了解采光方向与使用习惯，再讨论书桌方向和遮光方式。靠窗是布置意向，不代表已核对现场尺寸或批准插座点位。本说明不提供实际户型尺寸、现场完成状态、报价或工期承诺。'],
    ['internal', 'staff_internal', prefix + '·内部核对流程', '【合成测试资料，仅员工内部手测】\n测试设计师先核对本项目已共享的需求与图纸，再提交方案给测试业主决定。客户同意、现场落实、事项关闭和工程验收分别核对。此文不对外提供，不是企业实际承诺。'],
  ]) {
    const created = await write('knowledge.' + slot, { title, audience, sourceType: 'manual_text', category: '合成手测专用', body }, (b, k) => knowledge.execute('create', b, k)) as KnowledgeCreated;
    knowledgeDrafts.push({ documentId: String(created.document.id), versionId: String(created.draft.id), title, audience, status: 'draft' });
  }
  for (const doc of knowledgeDrafts) {
    const slot = 'knowledge-ready.' + doc.documentId;
    const input = { documentId: doc.documentId, versionId: doc.versionId, expectedVersion: 1, expectedEditVersion: 1 };
    const job = await write(slot + '.index', input, (b, k) => knowledge.execute('index', b, k));
    await once(slot + '.ready', async () => {
      for (let attempt = 0; attempt < 90; attempt++) {
        const state = await knowledge.execute('job', { jobId: job.jobId });
        if (state.status === 'succeeded') return { jobId: String(job.jobId), indexed: true };
        if (['failed', 'cancelled', 'unknown'].includes(String(state.status))) throw Error('Test knowledge index job ' + job.jobId + ': ' + state.status + '/' + state.last_error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw Error('Test knowledge index job is still pending: ' + job.jobId);
    });
    await write(slot + '.publish', input, (b, k) => knowledge.execute('publish', b, k));
    doc.status = 'published';
  }
  const extraDraft = await write('knowledge.draft', { title: prefix + '·点位调整流程草稿', audience: 'customer_public', sourceType: 'manual_text', category: '合成手测专用',
    body: '【合成测试草稿，不用于实际施工】\n进入泥木阶段后应结合已发布现场记录，核实原点位是否已经实施。客户同意方案、现场落实、正式解决和关闭分别记录。本草稿留给人工编辑、索引及发布测试；未发布前不应成为客户答复依据。' }, (b, k) => knowledge.execute('create', b, k)) as KnowledgeCreated;
  knowledgeDrafts.push({ documentId: String(extraDraft.document.id), versionId: String(extraDraft.draft.id), title: String(extraDraft.document.title), audience: 'customer_public', status: 'draft' });
  const orders = new ServiceOrderService({ enterpriseId: eid!, adminId: ownerId });
  const order = await write('service-order.create', { cameraCount: 2, retentionDays: 3, serviceDays: 30, note: '合成手测服务订单，金额仅供报价/确认/安装验收流程测试，无真实设备或支付。' }, (b, k) => orders.create(projectA, b, k));
  const quoted = await write('service-order.quote', { expectedVersion: order.version, lines: [{ label: '合成手测·两路设备服务示例', amountCents: 10000 }], depositCents: 20000, note: '测试报价100元、押金200元，非真实报价或付款；留待人工确认。' }, (b, k) => orders.quote(projectA, String(order.id), b, k));
  const decisionStart = await prepareDecision(leadA, projectA, rA, designerA);
  const publicRead = await new PublicSiteCatalog(eid!).list('420500', '西陵区'); assert.ok(publicRead.items.some(item => item.id === String(publicSite.id)));
  const recommendations = await new PortfolioCatalog(customer(uid!, leadA), cidA).recommend({ cityCode: '420500' }); assert.equal(recommendations.items.filter(i => [designerA, designerB].includes(i.authorId)).length, 2);
  state.dataset = { ownerId, testerUserId: uid, employees: { designerA, designerB, managerId, workerId, observerId, measurerId },
    ownHomes: [{ label: '甲', leadId: leadA, floorPlanId: planA.id, projectId: projectA, conversationId: cidA, publishedRecord: rA, draftRecord: rDraft }, { label: '乙', leadId: leadB, floorPlanId: planB.id, projectId: projectB, conversationId: cidB, publishedRecord: rB }],
    publicSample: { leadId: publicLead, projectId: publicProject, syntheticCustomerId: syntheticOwner, ...publicSite }, pendingOwnerConsent: consent, works, knowledgeDrafts, decisionStart, serviceOrder: { projectId: projectA, ...quoted } };
  state.foundationReady = true; state.complete = true; state.current = 'ready-for-human-testing'; delete state.error; save();
  console.log(JSON.stringify({ complete: true, enterprise: '微云', retained: true, ownHomes: 2, publicSites: 1, pendingOwnerConsents: 1, pendingCustomerPlans: 1, publishedWorks: works.length, employeeAccounts: 6,
    knowledgePublished: 2, knowledgeDrafts: 1, agentModelCalls: 0, knowledgeEmbeddingJobs: 2, manifest: manifestFile, credentialsFile }));
}
main().catch(error => { const safe = { code: error.cause?.code || error.code, message: error.cause?.message || String(error).replace(/\$2[aby]\$[^\s,]+/g, '[redacted test password hash]') }; if (state) { state.error = { step: state.current, ...safe, at: new Date().toISOString() }; save(); } console.error(safe); process.exitCode = 1; })
  .finally(async () => { if (lock) await lock.end(); await closePostgresPool(); });
