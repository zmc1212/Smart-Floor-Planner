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
import { sharedMaterials, materialCommand } from '@/lib/construction/site-materials';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { queryNeedIssues } from '@/lib/construction/need-issues';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { projectSiteIssues } from '@/lib/construction/site-issues';

const prefix = 'shared-material-'  + randomUUID();
const eids: string[] = [], aids: string[] = [], uids: string[] = [], platformIds: string[] = [];
let pid: string, otherPid: string, rid: string, mid: string, cid: string, drawingId: string, needId: string, diagramId: string;
let privateChat: ConversationService;
let derivedMessageId = '';
let olderDerivedMessageId = '';
let owner: ConstructionService, boss: SiteChatService, worker: SiteChatService, designer: SiteChatService;
const members: string[] = [];
const act = (action: string, body: Row) => owner.execute(action, body, randomUUID());
const pv = async () => Number(((await owner.execute('detail', { projectId: pid })).project as Row).version);
const item = async (messageId: string) => ((await boss.read(pid, undefined, 100)).items as Row[]).find(i => String((i.message as Row).id) === messageId)!;
const counts = () => withTenantTransaction(eids[0], tx => one(tx, sql`select
  (select count(*) from app.construction_site_records where enterprise_id=${eids[0]}) records,
  (select count(*) from app.assistant_runs where enterprise_id=${eids[0]}) runs`));
const command = async (service: SiteChatService, text: string, key = randomUUID(), versions?: Row) => service.send(pid,
  { text, mediaIds: [], versions: versions || (await service.read(pid)).versions }, key);
const issue = async () => (await withTenantTransaction(eids[0], tx => projectSiteIssues(tx, eids[0], pid)))[0];

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (const role of ['admin','super_admin']) platformIds.push(String((await one(tx,sql`insert into app.admin_users(username,password_hash,role,status,must_change_password,display_name)
      values(${prefix+role},'test-only',${role},'active',false,${'合成'+role}) returning id`))!.id));
    for (let n = 0; n < 2; n++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id); eids.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${eid},true,100,12000000,1000000000,30)`);
      aids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${eid},${prefix+n},'test-only','enterprise_admin','active',false,'合成负责人') returning id`))!.id));
    }
    for (const [index, role] of ['construction_staff','designer','construction_staff'].entries()) members.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eids[0]},${prefix+'staff'+index},'test-only',${role},'active',false,${['合成师傅','合成设计师','合成观察员'][index]}) returning id`))!.id));
    uids.push(String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id));
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uids[0]},${prefix})`);
  });
  owner = new ConstructionService({ enterpriseId: eids[0], adminId: aids[0] });
  boss = new SiteChatService(owner.actor); worker = new SiteChatService({ enterpriseId: eids[0], adminId: members[0] }); designer = new SiteChatService({ enterpriseId: eids[0], adminId: members[1] });
  const leadId = String((await withTenantTransaction(eids[0], tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eids[0]},${uids[0]},'合成业主','13982000091','natural') returning id`)))!.id);
  for (const name of ['本期合成工地','隔离反例工地']) {
    const p = await act('create', { leadId, name, managerId: aids[0], rooms: ['书房','客厅'] });
    if (!pid) pid = String(p.id); else otherPid = String(p.id);
  }
  for (let n = 0; n < 3; n++) await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[n], role: ['worker','designer','observer'][n], active: true, workLabel: '' });
  privateChat = new ConversationService({ enterpriseId: eids[0], principal: { kind: 'user', userId: uids[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } });
  const privateConversation = await privateChat.create(randomUUID()); cid = String(privateConversation.id);
  await withTenantTransaction(eids[0], tx => appendMessage(tx, privateChat.actor, String(privateConversation.id), { author:'user', clientMessageId:randomUUID(),
    content: { version:1, blocks:[{type:'text',text:'PRIVATE_NEED_DO_NOT_SHARE 书房双人办公的私人生活需求'}] } }));
  const bytes = await sharp({ create: { width: 48, height: 40, channels: 3, background: '#b7b09c' } }).png().toBuffer();
  mid = String((await worker.upload(pid, randomUUID(), bytes)).id);
  const source = await worker.send(pid, { text: '书房线管今天铺好了，底盒还没固定，等设计师核对位置。', mediaIds: [mid] }, randomUUID()); rid = String(source.recordId);
  const room = ((await boss.read(pid)).rooms as Row[]).find(r => r.name === '书房')!;
  const lease = await claimJob(); assert.equal(lease?.runId, source.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房施工进展', roomId: String(room.id), completed: '线管铺好了', pending: '底盒还没固定', coordination: '等设计师核对位置', note: '' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 120, outputTokens: 60 } }));
});

after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of eids) { await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
      await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`); }
    for (const uid of uids) { await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`); await tx.execute(sql`delete from app.users where id=${uid}`); }
    for (const aid of platformIds) await tx.execute(sql`delete from app.admin_users where id=${aid}`);
  }); } finally { await closePostgresPool(); }
});

const say = (text: string, key = randomUUID()) => privateChat.send(cid, key, { version: 1, blocks: [{ type: 'text', text }] }, siteWatchInterceptor);
const roomSources = async () => {
  const room = ((await boss.read(pid)).rooms as Row[]).find(r => r.name === '书房')!;
  return withTenantTransaction(eids[0], tx => sharedMaterials(tx, eids[0], pid, String(room.id)));
};
const bodyText = (m: Row) => ((m.content as { blocks: { text?: string; fallbackText?: string }[] }).blocks).map(b => b.text || b.fallbackText || '').join('\n');
const customerResults = async () => (await privateChat.messages(cid, undefined, 100)).items.filter(m => /项目团队回传/.test(bodyText(m)));

test('PPT23 S01 reception consent is not a project-wide material grant', async () => {
  const h = new HandoffService(privateChat.actor);
  await h.customerWrite(cid, randomUUID(), { action: 'request', consent: true, recipientId: members[1] });
  const staff = new HandoffService({ ...designer.actor, capabilities: ['assistant.handoff.staff'] });
  await staff.staffWrite(cid, randomUUID(), { action: 'claim' });
  assert.ok((await staff.staffRead(cid)).messages.length);
  const r = await command(designer, '书房底盒待核对，帮我找对应图纸和需求');
  const response = (await item(String(r.messageId))).response as Row;
  assert.match(String(response.text), /缺项/); assert.doesNotMatch(String(response.text), /PRIVATE_NEED_DO_NOT_SHARE/);
  assert.equal((await roomSources()).sources.length, 0);
});

test('explicit customer excerpt is persisted/idempotent and scoped to the one named project and room', async () => {
  assert.equal(materialCommand('能不能共享书房需求：靠窗办公？'), null);
  await assert.rejects(say('共享书房需求：未说明是哪一个同名项目'), /construction_material_scope_required/);
  const key = randomUUID(), raw = '共享本期合成工地·书房需求：靠窗书桌，偶尔双人办公；电脑、显示器、台灯和手机充电。';
  const first = await say(raw, key); assert.equal(first.runId, null);
  assert.deepEqual(await say(raw, key), first);
  const sources = (await roomSources()).sources; assert.equal(sources.length, 1);
  needId = sources[0].id; assert.equal(sources[0].sourceMessageId, first.messageId); assert.equal(sources[0].conversationId, cid);
  assert.match(sources[0].sourceHash, /^[a-f0-9]{64}$/);
  assert.ok((await privateChat.messages(cid)).items.some(m => bodyText(m).includes('资料' + needId)));
  await assert.rejects(say('共享本期合成工地·书房点位图：尚未发图'), /construction_material_image_required/);
});

test('the immediately preceding real uploaded drawing is shared as an exact original, never a v4 plan substitution', async () => {
  const bytes = await sharp({ create: { width: 96, height: 72, channels: 3, background: '#d7e3d8' } }).png().toBuffer();
  diagramId = String((await new AssistantMediaService(privateChat.actor).upload(cid, randomUUID(), bytes, 'image', '')).id);
  await say('共享本期合成工地·书房点位图：V2书桌插座点位，须结合现场尺寸核对。');
  drawingId = (await roomSources()).sources.find(s => s.kind === 'drawing')!.id;
  const original = await new AssistantMediaService(privateChat.actor).read(cid, diagramId);
  const shared = await designer.materialMedia(pid, drawingId, diagramId);
  assert.equal(shared.mime, original.mime); assert.deepEqual(shared.data, original.data);
  await assert.rejects(designer.materialMedia(otherPid, drawingId, diagramId));
  await assert.rejects(designer.materialMedia(pid, needId, diagramId));
  await assert.rejects(new SiteChatService({ enterpriseId: eids[1], adminId: aids[1] }).materialMedia(pid, drawingId, diagramId));
  const r = await command(designer, '书房底盒待核对，帮我找对应图纸和需求'), response = (await item(String(r.messageId))).response as Row;
  assert.match(String(response.text), /靠窗书桌.*双人办公/); assert.match(String(response.text), /V2书桌插座点位/);
  assert.match(String(response.text), /客户提供点位图原件/); assert.doesNotMatch(String(response.text), /PRIVATE_NEED_DO_NOT_SHARE/);
  assert.ok((response.media as Row[]).some(m => m.id === `shared-${drawingId}-${diagramId}`));
  assert.equal(Number((await counts())!.runs), 1, 'sharing and deterministic queries create no model run');
});

test('same-issue drawing check, transfer and reply enforce current material and issue revisions', async () => {
  await command(worker, '跟进记录' + rid + '：底盒待核对');
  const iid = (await issue()).issueId;
  await command(worker, '接手事项' + iid);
  await assert.rejects(command(worker, '核对事项' + iid + '图纸' + drawingId), /construction_forbidden/);
  await command(boss, '转交事项' + iid + '给合成设计师');
  const stale = (await designer.read(pid)).versions as Row;
  await command(designer, '核对事项' + iid + '图纸' + drawingId);
  await assert.rejects(command(designer, '回复事项' + iid + '：不能沿旧修订处理', randomUUID(), stale), /version_conflict/);
  await command(designer, '回复事项' + iid + '：依据共享V2与靠窗双人办公需求，底盒先不固定，现场尺寸仍须核对。');
  const view = await issue(); assert.equal(view.status, 'awaiting_review'); assert.equal(view.drawingGrantId, drawingId);
  assert.match(view.text, /图纸资料.*已核对关联/); assert.match(view.text, /不等于已解决或正式批准/);
  await assert.rejects(command(designer, '回传事项' + iid + '：员工不能自行扩大受众'), /construction_forbidden/);
  assert.equal((await customerResults()).length, 0, 'a team reply is not automatically delivered');
});

test('explicit manager result waits through human mode then Worker delivers once to the original consented consultation', async () => {
  const iid = (await issue()).issueId, key = randomUUID(), raw = '回传事项' + iid + '：设计师已结合V2与双人办公需求回复，底盒位置仍待现场核对。';
  const versions = (await boss.read(pid)).versions as Row;
  const result = await command(boss, raw, key, versions); assert.deepEqual(await command(boss, raw, key, versions), result);
  await deliverSiteResults(); assert.equal((await customerResults()).length, 0);
  assert.equal((await withTenantTransaction(eids[0], tx => queryNeedIssues(tx, privateChat.actor, cid))).data.length, 0, 'pending human-mode results are not queryable');
  const other = await new ConversationService({ ...privateChat.actor, entry: { kind: 'company', id: eids[0] } }).create(randomUUID());
  await new HandoffService(privateChat.actor).customerWrite(cid, randomUUID(), { action: 'end' });
  assert.equal(await deliverSiteResults(), 1); assert.equal(await deliverSiteResults(), 0);
  const returned = await customerResults(); assert.equal(returned.length, 1); assert.equal(returned[0].available, true);
  assert.match(bodyText(returned[0]), /仍待现场核对/); assert.doesNotMatch(bodyText(returned[0]), /PRIVATE_NEED_DO_NOT_SHARE/);
  const second = await privateChat.messages(String(other.id)); assert.ok(second.items.every(m => !bodyText(m).includes('项目团队回传')));
  const followups = await withTenantTransaction(eids[0], tx => queryNeedIssues(tx, privateChat.actor, cid));
  assert.equal(followups.data.length, 1); assert.equal(followups.data[0].kind, 'team_result'); assert.equal(followups.data[0].issueId, iid);
  assert.match(followups.displayText, /仍待现场核对/); assert.doesNotMatch(followups.displayText, /PRIVATE_NEED_DO_NOT_SHARE/);
  assert.equal((await withTenantTransaction(eids[0], tx => queryNeedIssues(tx, privateChat.actor, String(other.id)))).data.length, 0);
  assert.equal((await new ConversationService(privateChat.actor).messages(cid, undefined, 100)).items.filter(m => bodyText(m).includes('项目团队回传')).length, 1);
  assert.equal((await issue()).status, 'awaiting_review');
});

test('Agent continuation inherits the exact returned result as revocable construction evidence', async () => {
  await withTenantTransaction(eids[0], tx => tx.execute(sql`update app.assistant_enterprise_settings
    set agent_config='{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb where enterprise_id=${eids[0]}`));
  const resultId = (await customerResults())[0].id;
  const sent = await say('刚才团队回传的底盒结论是什么，已经可以固定了吗？');
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processAgentAnswer(lease!, { model: async (messages, _tools, turn) => {
    // Bounded continuation may replace earlier assistant history with the fresh
    // tool result. Validate that authoritative result instead of requiring the
    // historical wrapper to remain in every provider round.
    if (turn === 0) assert.match(JSON.stringify(messages), /此前项目团队向本咨询明确回传的处理回复/);
    else {
      const current = JSON.parse(messages.filter(m => m.role === 'tool').at(-1)!.content as string);
      assert.equal(current.query.domain, 'followups');
      assert.equal(current.synthesisSources[0].resultKey, current.resultKey);
      assert.match(current.synthesisSources[0].text, /底盒位置仍待现场核对/);
    }
    const resultKey = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content as string).resultKey).at(-1);
    return { text: '', toolCalls: [{ id: 'test-' + turn, name: turn === 0 ? 'query_followups' : 'final_response',
      arguments: JSON.stringify(turn === 0 ? {} : { kind: 'business', resultKey }) }],
      finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 50, outputTokens: 30 } };
  } });
  const run = await privateChat.run(String(sent.runId)); assert.equal(run.status, 'succeeded');
  derivedMessageId = String(run.outputMessageId);
  assert.match(bodyText((await privateChat.messages(cid, undefined, 100)).items.find(m => m.id === derivedMessageId)!), /团队明确回传/);
  const step = await withTenantTransaction(eids[0], tx => one(tx, sql`select source_refs from app.assistant_run_steps
    where enterprise_id=${eids[0]} and run_id=${String(sent.runId)} and kind='agent_construction_context'`));
  assert.ok((step!.source_refs as string[]).includes(String(resultId)));
  const savedTool = await withTenantTransaction(eids[0], tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps
    where enterprise_id=${eids[0]} and run_id=${String(sent.runId)} and capability_name='query_followups' and kind='agent_tool'`));
  assert.equal(((savedTool!.private_checkpoint as Row).data as Row[]).find(i => i.kind === 'team_result')!.sourceMessageId, String(resultId));
  assert.equal((await privateChat.messages(cid, undefined, 100)).items.find(m => m.id === derivedMessageId)!.available, true);
});

test('query_followups finds only the authorized team result after it leaves the model history window and retains revocation provenance', async () => {
  const resultId = (await customerResults())[0].id;
  await withTenantTransaction(eids[0], async tx => {
    for (let i=0;i<32;i++) await appendMessage(tx, privateChat.actor, cid, { author: 'user', clientMessageId: randomUUID(),
      content: { version: 1, blocks: [{ type: 'text', text: '合成上下文占位' + i + '，与工程无关。' }] } });
  });
  const sent = await say('请查团队回传的底盒处理结论。'), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processAgentAnswer(lease!, { model: async (messages, _tools, turn) => {
    assert.doesNotMatch(JSON.stringify(messages), /此前项目团队向本咨询明确回传的处理回复/);
    const resultKey = messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content as string).resultKey).at(-1);
    if (turn > 0) assert.match(JSON.stringify(messages), /团队明确回传.*V2/);
    return { text: '', toolCalls: [{ id: 'history-' + turn, name: turn === 0 ? 'query_followups' : 'final_response',
      arguments: JSON.stringify(turn === 0 ? {} : { kind: 'business', resultKey }) }],
      finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 50, outputTokens: 30 } };
  } });
  const run = await privateChat.run(String(sent.runId)); assert.equal(run.status, 'succeeded'); olderDerivedMessageId = String(run.outputMessageId);
  const step = await withTenantTransaction(eids[0],tx=>one(tx,sql`select source_refs from app.assistant_run_steps where enterprise_id=${eids[0]}
    and run_id=${String(sent.runId)} and kind='agent_construction_context'`));
  assert.ok((step!.source_refs as string[]).includes(String(resultId)));
});

test('replacing a drawing invalidates old query/reply/result and rejects a stale material snapshot without changing the issue', async () => {
  const iid = (await issue()).issueId, oldVersions = (await designer.read(pid)).versions as Row;
  const before = await issue(), bytes = await sharp({ create: { width: 72, height: 96, channels: 3, background: '#b6d5c5' } }).png().toBuffer();
  diagramId = String((await new AssistantMediaService(privateChat.actor).upload(cid, randomUUID(), bytes, 'image', '')).id);
  await say('共享本期合成工地·书房点位图：V3修正后的书桌点位，旧V2停止沿用。');
  const oldId = drawingId; drawingId = (await roomSources()).sources.find(s => s.kind === 'drawing')!.id;
  await assert.rejects(designer.materialMedia(pid, oldId, diagramId));
  assert.equal((await issue()).status, 'invalidated'); assert.equal((await issue()).revision, before.revision);
  await assert.rejects(command(designer, '回复事项' + iid + '：旧材料不能继续回复', randomUUID(), oldVersions), /context_changed|version_conflict/);
  const history = await privateChat.messages(cid, undefined, 100);
  assert.ok(history.items.some(m => m.available === false && /已不可用/.test(bodyText(m))));
  assert.equal(history.items.find(m => m.id === derivedMessageId)!.available, false, 'the derived Agent answer must lose the same source too');
  assert.equal(history.items.find(m => m.id === olderDerivedMessageId)!.available, false, 'tool-only provenance must also revoke the older-history continuation');
  await assert.rejects(command(designer, '重新核对事项' + iid + '：采用V3', randomUUID(), oldVersions), /version_conflict/);
  await command(designer, '重新核对事项' + iid + '：采用当前共享V3');
  assert.equal((await issue()).drawingGrantId, null); assert.equal((await issue()).issueId, iid);
  await command(designer, '核对事项' + iid + '图纸' + drawingId);
  await command(designer, '回复事项' + iid + '：已按V3重新核对关联，尺寸待复核。');
});

test('source revocation before delivery kills the old event and removes diagram bytes and derived replies', async () => {
  const iid = (await issue()).issueId;
  await command(boss, '回传事项' + iid + '：待投递的V3处理回复');
  await say('撤回共享资料' + drawingId);
  await assert.rejects(designer.materialMedia(pid, drawingId, diagramId));
  assert.equal((await issue()).status, 'invalidated');
  assert.equal(await deliverSiteResults(), 0);
  const dead = await withTenantTransaction(eids[0], tx => one(tx, sql`select count(*) as n from app.domain_event_deliveries where enterprise_id=${eids[0]} and status='dead' and consumer_key=${'construction:result:' + cid}`));
  assert.ok(Number(dead!.n) >= 1); assert.equal((await customerResults()).length, 0);
});

test('customer access removal revokes shared need reads, results, original operations and query projections', async () => {
  const detail = (await owner.execute('detail', { projectId: pid })).project as Row;
  await act('update', { projectId: pid, expectedVersion: detail.version, name: detail.name, status: 'active', customerAccess: false });
  assert.equal((await roomSources()).sources.length, 0);
  await assert.rejects(say('共享本期合成工地·书房需求：撤权后不能继续共享'), /construction_material_scope_required/);
  const r = await command(designer, '书房底盒待核对，帮我找相关资料');
  assert.doesNotMatch(String(((await item(String(r.messageId))).response as Row).text), /偶尔双人办公/);
  const d = (await owner.execute('detail', { projectId: pid })).project as Row;
  await act('update', { projectId: pid, expectedVersion: d.version, name: d.name, status: 'active', customerAccess: true });
});

test('a formal-source-tagged upload cannot be relabeled as a point drawing', async () => {
  const bytes = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#f0f0f0' } }).png().toBuffer();
  const mediaId = String((await new AssistantMediaService(privateChat.actor).upload(cid, randomUUID(), bytes, 'image', '')).id);
  await withTenantTransaction(eids[0], tx => tx.execute(sql`update app.assistant_media set source_ref='{"kind":"synthetic_formal_snapshot"}'::jsonb
    where enterprise_id=${eids[0]} and conversation_id=${cid} and id=${mediaId}`));
  await assert.rejects(say('共享本期合成工地·书房点位图：不能把正式墙图改叫点位图'), /construction_material_image_required/);
  assert.equal((await roomSources()).sources.some(s => s.mediaId === mediaId), false);
});

test('observer/member removal and all management roles enforce live drawing and pending-result boundaries', async () => {
  const observer = new SiteChatService({ enterpriseId: eids[0], adminId: members[2] });
  await assert.rejects(command(observer, '核对事项' + (await issue()).issueId + '图纸' + drawingId));
  const bytes = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#80ad99' } }).png().toBuffer();
  diagramId = String((await new AssistantMediaService(privateChat.actor).upload(cid, randomUUID(), bytes, 'image', '')).id);
  await say('共享本期合成工地·书房点位图：V4待核对原件');
  drawingId = (await roomSources()).sources.find(s => s.kind === 'drawing')!.id;
  assert.ok((await designer.materialMedia(pid, drawingId, diagramId)).data.length);
  for (const aid of [aids[0], ...platformIds]) assert.ok((await new SiteChatService({ enterpriseId: eids[0], adminId: aid }).materialMedia(pid, drawingId, diagramId)).data.length);
  const iid = (await issue()).issueId;
  await command(designer, '重新核对事项' + iid + '：接入V4');
  await command(designer, '核对事项' + iid + '图纸' + drawingId);
  await command(designer, '回复事项' + iid + '：V4仍待现场复核');
  for (const aid of [aids[0], ...platformIds]) {
    const management = new SiteChatService({ enterpriseId: eids[0], adminId: aid });
    await command(management, '回传事项' + iid + '：合成管理角色' + aid + '明确回传，V4仍待现场核对。');
    assert.equal(await deliverSiteResults(), 1, 'owner/admin/super_admin can publish in the selected enterprise without joining the project');
  }
  await command(boss, '回传事项' + iid + '：V4待核对的处理回复');
  await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[1], role: 'designer', active: false, workLabel: '' });
  await assert.rejects(designer.read(pid)); await assert.rejects(designer.materialMedia(pid, drawingId, diagramId));
  assert.equal(await deliverSiteResults(), 0);
});
