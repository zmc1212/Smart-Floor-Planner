import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { ConstructionService } from '@/lib/construction/service';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { sharedMaterials, sharedMaterialMedia } from '@/lib/construction/site-materials';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { queryMaterials, materialSnapshotAvailable } from '@/lib/assistant/agent/materials';
import { businessSynthesisSources, type SynthesisSource } from '@/lib/assistant/agent/synthesis';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';

const prefix = 'synthetic-shared-projection-' + randomUUID(), tenants: string[] = [], users: string[] = [];
let eid = '', aid = '';
const call = (name: string, args: unknown): ModelTurnOutput => ({ text: '', toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }],
  usage: { inputTokens: 20, outputTokens: 20 }, finishReason: 'tool_calls', providerRequestId: null });
before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) tenants.push(String((await one(tx, sql`insert into app.enterprises(name,code,status)
      values(${prefix+n},${prefix+n},'active') returning id`))!.id));
    eid = tenants[0];
    aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password)
      values(${eid},${prefix},'unusable-synthetic','enterprise_admin','active',false) returning id`))!.id);
  });
  await withTenantTransaction(eid, tx => tx.execute(sql`insert into app.assistant_enterprise_settings
    (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
    values(${eid},true,1000,12000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb)`));
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const e of tenants) { await deleteConstructionData(tx, BigInt(e)); await deleteAssistantData(tx, BigInt(e));
      await tx.execute(sql`delete from app.leads where enterprise_id=${e}`);
      await tx.execute(sql`delete from app.admin_users where enterprise_id=${e}`); await tx.execute(sql`delete from app.enterprises where id=${e}`); }
    for (const u of users) await tx.execute(sql`delete from app.users where id=${u}`);
  }); } finally { await closePostgresPool(); }
});
async function fixture() {
  const uid = await withPlatformTransaction(async tx => {
    const u = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id); users.push(u);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${u},${prefix+u})`); return u;
  });
  const leadId = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eid},${uid},'合成原件投影业主','13800000000','natural') returning id`)))!.id);
  const owner = new ConstructionService({ enterpriseId: eid, adminId: aid });
  const pid = String((await owner.execute('create', { leadId, name: '合成原件投影工地', managerId: aid, rooms: ['书房','厨房'] }, randomUUID())).id);
  const roomId = String((await withTenantTransaction(eid, tx => one(tx, sql`select id from app.construction_rooms where enterprise_id=${eid} and project_id=${pid} and name='书房'`)))!.id);
  const actor = { enterpriseId: eid, principal: { kind: 'user' as const, userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead' as const, id: leadId } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id), media = new AssistantMediaService(actor);
  const say = (text: string, target = cid) => chat.send(target, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] }, siteWatchInterceptor);
  const query = (room = '书房', target = cid) => withTenantTransaction(eid, tx => queryMaterials(tx, actor, target, { leadId: '', room }));
  const share = async (text = '靠窗双人办公，电脑和台灯，具体位置待核对。') => {
    await say('共享书房需求：' + text);
    return (await withTenantTransaction(eid, tx => sharedMaterials(tx, eid, pid, roomId))).sources.find(s => s.kind === 'need')!;
  };
  const drawing = async (text = '书桌插座参考图，须结合现场尺寸核对。') => {
    const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#d7e3d8' } }).png().toBuffer();
    const mid = String((await media.upload(cid, randomUUID(), bytes, 'image', '')).id);
    await say('共享书房点位图：' + text);
    const source = (await withTenantTransaction(eid, tx => sharedMaterials(tx, eid, pid, roomId))).sources.find(s => s.kind === 'drawing')!;
    return { mid, source };
  };
  const answer = async (change?: () => Promise<unknown>, tool = 'query_materials') => {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '结合当前书房需求和点位图说明，底盒能直接固定吗？' }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAgentAnswer(lease, { model: async (messages, _tools, turn) => {
      if (!turn) return call(tool, tool === 'query_materials' ? { leadId: '', room: '书房' } : { query: '书房办公与点位核对' });
      const sources = messages.filter(m => m.role === 'tool').flatMap(m => JSON.parse(m.content).synthesisSources || []) as SynthesisSource[];
      const s = sources.find(s => s.material?.ref.type === 'shared_need'); assert.ok(s, 'actual tool must carry original grant');
      if (change) await change();
      return call('final_response', { kind: 'synthesis', segments: [{ basis: 'evidence', text: '已提供靠窗双人办公的需求，底盒位置仍需结合现场条件核对。', citations: [{ sourceId: s.sourceId, quote: s.text }] },
        { basis: 'uncertainty', text: '图内细节与实际尺寸仍需设计师核实。', citations: [] }] });
    } });
    return chat.run(lease.runId);
  };
  return { uid, leadId, pid, roomId, actor, owner, chat, cid, media, say, query, share, drawing, answer };
}
const available = (snapshot: Awaited<ReturnType<typeof queryMaterials>>) => withTenantTransaction(eid, tx => materialSnapshotAvailable(tx, eid, snapshot));

test('PPT23 exact same-consultation need and drawing originals have grant, message, room and media hash provenance', async () => {
  const x = await fixture(), need = await x.share(), { mid, source } = await x.drawing(), s = await x.query();
  const n = s.data.sources.find(s => s.ref.type === 'shared_need')!, d = s.data.sources.find(s => s.ref.type === 'shared_drawing')!;
  assert.equal(n.ref.id, need.id); assert.equal(n.sourceMessageId, need.sourceMessageId); assert.equal(n.text, need.text);
  assert.deepEqual(d.mediaIds, [mid]); assert.equal(d.original?.mediaHash, source.mediaHash); assert.equal(d.original?.imagePixels, false);
  assert.equal(d.roomId, x.roomId); assert.equal(d.projectId, x.pid); assert.equal(d.original?.conversationId, x.cid);
  assert.ok(s.data.sources.every(s => s.hash && s.ref.version && s.audience === 'customer_self'));
  assert.doesNotMatch(s.data.missing.join('；'), /有效原话需求|当前有效点位图/); assert.match(s.data.missing.join('；'), /图内细节/);
  assert.equal(await available(s), true);
  assert.deepEqual((await x.media.read(x.cid, mid)).data, (await withTenantTransaction(eid, tx => sharedMaterialMedia(tx, eid, x.pid, source.id, mid))).data);
  assert.equal((await x.query('厨房')).data.sources.filter(s => s.ref.type.startsWith('shared_')).length, 0);
});
test('unshared private text and uploads never become shared references', async () => {
  const x = await fixture();
  await withTenantTransaction(eid, tx => appendMessage(tx, x.actor, x.cid, { author: 'user', clientMessageId: randomUUID(), content: { version: 1, blocks: [{ type: 'text', text: 'PRIVATE_UNSHARED 原话不能作为项目共享资料' }] } }));
  await x.drawing();
  const y = await fixture(); await y.share('PRIVATE_OTHER_CUSTOMER');
  assert.doesNotMatch(JSON.stringify(await x.query()), /PRIVATE_UNSHARED|PRIVATE_OTHER_CUSTOMER/);
  await assert.rejects(withTenantTransaction(tenants[1], tx => queryMaterials(tx, { ...x.actor, enterpriseId: tenants[1] }, x.cid, { leadId: '', room: '书房' })), /assistant_resource_not_found/);
  await assert.rejects(withTenantTransaction(eid, tx => queryMaterials(tx, y.actor, x.cid, { leadId: '', room: '书房' })), /assistant_resource_not_found/);
});
test('a different consultation of the same customer and home cannot read or inherit a shared grant', async () => {
  const x = await fixture(); await x.share(); const other = String((await x.chat.create(randomUUID())).id);
  assert.equal((await x.query('书房', other)).data.sources.length, 0);
  await x.say('共享书房需求：OTHER_CONSULTATION 私聊新需求', other);
  assert.equal((await x.query()).data.sources.length, 0, 'no fallback to replaced grant in the original consultation');
  assert.doesNotMatch(JSON.stringify(await x.query()), /OTHER_CONSULTATION/);
});
test('replacement invalidates history and revoking the latest need never revives an old grant', async () => {
  const x = await fixture(); await x.share(); const first = await x.query(), run = await x.answer(); assert.equal(run.status, 'succeeded');
  const newer = await x.share('独立办公桌，保留台灯。'); assert.equal(await available(first), false);
  assert.equal((await x.chat.messages(x.cid)).items.find(m => m.id === run.outputMessageId)!.available, false);
  assert.equal((await x.query()).data.sources.filter(s => s.ref.type === 'shared_need').length, 1);
  await x.say('撤回共享资料' + newer.id); assert.equal((await x.query()).data.sources.length, 0);
});
test('replacing and withdrawing drawings invalidates original media references without restoring the older image', async () => {
  const x = await fixture(); const old = await x.drawing(), snapshot = await x.query(), current = await x.drawing('新参考图，尚需核实。');
  assert.equal(await available(snapshot), false);
  await assert.rejects(withTenantTransaction(eid, tx => sharedMaterialMedia(tx, eid, x.pid, old.source.id, old.mid)), /construction_not_found/);
  await x.say('撤回共享资料' + current.source.id);
  assert.equal((await x.query()).data.sources.filter(s => s.ref.type === 'shared_drawing').length, 0);
});
for (const mutation of ['hash','deleted','source','message','purpose','participant','lead','project','room'] as const) {
  test('XK07/08 saved original snapshot fails closed after ' + mutation + ' changes', async () => {
    const x = await fixture(); await x.share(); const d = await x.drawing(), snapshot = await x.query();
    await withTenantTransaction(eid, async tx => {
      if (mutation === 'hash') await tx.execute(sql`update app.assistant_media set source_hash=repeat('a',64) where enterprise_id=${eid} and id=${d.mid}`);
      if (mutation === 'deleted') await tx.execute(sql`update app.assistant_media set deleted_at=now(),data=null where enterprise_id=${eid} and id=${d.mid}`);
      if (mutation === 'source') await tx.execute(sql`update app.assistant_media set source_ref='{}'::jsonb where enterprise_id=${eid} and id=${d.mid}`);
      if (mutation === 'message') await tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"原消息内容变更"}]}'::jsonb where enterprise_id=${eid} and id=${d.source.sourceMessageId}`);
      if (mutation === 'purpose') await tx.execute(sql`update app.assistant_conversations set purpose='project_collaboration' where enterprise_id=${eid} and id=${x.cid}`);
      if (mutation === 'participant') await tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now() where enterprise_id=${eid} and conversation_id=${x.cid} and user_id=${x.uid}`);
      if (mutation === 'lead') await tx.execute(sql`update app.leads set archived_at=now() where enterprise_id=${eid} and id=${x.leadId}`);
      if (mutation === 'project') await tx.execute(sql`update app.construction_projects set customer_access=false where enterprise_id=${eid} and id=${x.pid}`);
      if (mutation === 'room') await tx.execute(sql`update app.construction_rooms set name='更名书房' where enterprise_id=${eid} and id=${x.roomId}`);
    });
    assert.equal(await available(snapshot), false);
  });
}
test('explicit and knowledge-bound tools expose matching per-original citation IDs and persisted source metadata', async () => {
  for (const tool of ['query_materials','search_knowledge']) {
    const x = await fixture(); await x.share(); await x.drawing(); const run = await x.answer(undefined, tool);
    assert.equal(run.status, 'succeeded', JSON.stringify(run));
    const saved = await withTenantTransaction(eid, tx => one(tx, sql`select source_refs,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${run.id} and kind='agent_synthesis_context'`));
    assert.ok((saved!.source_refs as { sources: SynthesisSource[] }).sources.some(s => s.material?.ref.type === 'shared_drawing'));
    const message = (await x.chat.messages(x.cid)).items.find(m => m.id === run.outputMessageId)!;
    assert.equal(message.available, true); assert.match(JSON.stringify(message), /客户共享需求原话（书房）/);
    assert.doesNotMatch(JSON.stringify(message), /本轮依据：[^。]*正式户型/);
  }
});
test('grant withdrawal during a model turn fences late synthesis and human mode suppresses late replies', async () => {
  const x = await fixture(), grant = await x.share();
  const run = await x.answer(() => x.say('撤回共享资料' + grant.id));
  assert.notEqual(run.status, 'succeeded'); assert.equal(run.outputMessageId, null);
  const y = await fixture(); await y.share();
  const human = await y.answer(() => new HandoffService(y.actor).customerWrite(y.cid, randomUUID(), { action: 'request' }));
  assert.equal(human.outputMessageId, null); assert.equal((await y.chat.detail(y.cid)).mode, 'handoff_requested');
  assert.equal(Number((await withTenantTransaction(eid, tx => one(tx, sql`select count(*) n from app.construction_site_records where enterprise_id=${eid}`)))!.n), 0, 'read/synthesis never creates records');
});
test('per-original metadata and footer distinguish customer reference from a formal plan or published record', async () => {
  const x = await fixture(); await x.share(); await x.drawing();
  const snapshot = await x.query(), sources = businessSynthesisSources('run:0:0', snapshot);
  assert.equal(new Set(sources.map(s => s.sourceId)).size, sources.length);
  assert.equal(sources.filter(s => s.material).length, 2);
  assert.ok(sources.filter(s => s.material).every(s => s.text === s.material!.text && s.material!.original?.authority === 'customer_reference'));
  assert.doesNotMatch(sources.map(s => s.title).join('；'), /正式户型|已发布现场记录/);
});
