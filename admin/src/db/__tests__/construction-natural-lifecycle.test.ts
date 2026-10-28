import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { processSiteAction } from '@/lib/construction/site-action-worker';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { readSiteResolution } from '@/lib/construction/site-resolution';
import { readSiteIssue } from '@/lib/construction/site-issues';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { customerSiteMedia } from '@/lib/construction/site-publications';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';
import { prepareApprovedNaturalPlans } from '../../../scripts/construction-natural-plans-fixture';
import { naturalPlanCases } from '../../../scripts/construction-natural-plans-scenario.mjs';
import { prepareOtherManagementProject, prepareClosedLifecycle } from '../../../scripts/construction-natural-lifecycle-fixture';
import type { SiteAction } from '@/lib/construction/site-action-contract';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import { synthesisRepairBase } from '@/lib/assistant/agent/synthesis-repair';
import type { SynthesisSource } from '@/lib/assistant/agent/synthesis';
after(closePostgresPool);
const image = () => sharp({ create: { width: 96, height: 72, channels: 3, background: '#c9dfd0' } }).png().toBuffer();
async function fixture(work: (f: D4SharingFixture, issueId: string, drawingId: string) => Promise<void>) {
  const f = new D4SharingFixture(); try {
    await f.create(); await f.send('共享测试工地甲·书房需求：电脑和台灯插座，先核对位置。');
    await new AssistantMediaService(f.actor).upload(f.conversationId, randomUUID(), await image(), 'image', '');
    await f.send('共享测试工地甲·书房点位图：供现场核对。');
    const drawingId = (await f.sources()).sources.find(s => s.kind === 'drawing')!.id;
    const prepared = await f.prepareReturnedIssue(drawingId, { open: '继续跟进底盒。', reply: '位置已人工核对。', return: '位置还需现场复测。' });
    await work(f, prepared.issueId, drawingId);
  } finally { await f.cleanup(); }
}
async function say(f: D4SharingFixture, aid: string, text: string, key = randomUUID()) {
  const s = f.site(aid); return s.send(f.projectId, { text, mediaIds: [], versions: (await s.read(f.projectId)).versions }, key);
}
async function propose(f: D4SharingFixture, aid: string, raw: string, selection: SiteAction, expected = 'succeeded') {
  const sent = await say(f, aid, raw), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteAction(lease!, async () => ({ text: JSON.stringify(selection), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } }));
  const run = await withTenantTransaction(f.eid, tx => one(tx, sql`select status,error_code from app.assistant_runs where enterprise_id=${f.eid} and id=${String(sent.runId)}`));
  assert.equal(run!.status, expected, JSON.stringify(run)); return sent;
}
async function completion(f: D4SharingFixture) {
  const s = f.site(f.memberIds[1]), media = await s.upload(f.projectId, randomUUID(), await image());
  const sent = await s.send(f.projectId, { text: '书房右侧底盒已经固定，桌子摆位也已复核。', mediaIds: [String(media.id)] }, randomUUID());
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '测试专用 · 书房底盒完成', roomId: f.roomId, completed: '右侧底盒已固定并复核', pending: '', coordination: '', note: '' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } }));
  const record = (await withTenantTransaction(f.eid, tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${f.eid} and id=${String(sent.recordId)}`)))!;
  const published = await f.site().mutate(f.projectId, String(sent.recordId), 'publish', { expectedVersion: Number(record.version), audience: 'internal' }, randomUUID());
  return { id: String(sent.recordId), mediaId: String(media.id), version: Number(published.version) };
}
const state = (f: D4SharingFixture, iid: string) => withTenantTransaction(f.eid, tx => readSiteResolution(tx, f.eid, f.projectId, iid));
const count = (f: D4SharingFixture) => withTenantTransaction(f.eid, async tx => Number((await one(tx, sql`select count(*)::int n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.site.issue.lifecycle.v1'`))!.n));
const disclosure = (close = false, originals = false) => `请正式${close ? '关闭' : '解决'}书房底盒这件事。PRIVATE_INTERNAL核对细节留在项目。给业主说：“书房底盒已按同意的V2落实，${close ? '事项已正式关闭' : '事项已正式解决，尚未关闭'}。”${originals ? '把本次落实照片原件也回传给业主' : '只回传文字'}。`;
const selected = (iid: string, close = false): SiteAction => ({ action: close ? 'close' : 'resolve', target: iid, resolution: { planId: '', recordId: '', excerpt: `书房底盒已按同意的V2落实，${close ? '事项已正式关闭' : '事项已正式解决，尚未关闭'}。` } });

test('natural implementation, separate resolution/closure and exact recovery keep evidence and explicit customer disclosure distinct', async () => fixture(async (f, iid, drawing) => {
  await prepareOtherManagementProject(f);
  const p = (await prepareApprovedNaturalPlans(f, iid, naturalPlanCases[0])).plans[1], r = await completion(f), designer = f.memberIds[0];
  await propose(f, designer, '书房已按同意的V2完成，请把这次完成记录作为现场落实依据。', { action: 'implement', target: iid, resolution: { planId: p.id, recordId: r.id, excerpt: '' } });
  assert.equal(await count(f), 0); await say(f, f.ownerIds[0], '确认落实'); await say(f, designer, '收到'); assert.equal(await count(f), 0);
  const s = f.site(designer), body = { text: '确认落实', mediaIds: [], versions: (await s.read(f.projectId)).versions }, key = randomUUID();
  const a = await s.send(f.projectId, body, key), b = await s.send(f.projectId, body, key); assert.equal(a.lifecycleId, b.lifecycleId);
  assert.equal((await state(f, iid))!.state, 'implemented'); assert.equal(await count(f), 1);
  await propose(f, f.ownerIds[0], disclosure(true), selected(iid, true), 'failed'); assert.equal(await count(f), 1);
  await propose(f, f.ownerIds[0], disclosure(), selected(iid)); await say(f, f.ownerIds[0], '确认正式解决');
  assert.equal((await state(f, iid))!.state, 'resolved'); await deliverSiteResults();
  let messages = (await f.chat.messages(f.conversationId, undefined, 100)).items;
  const result = messages.findLast(m => m.available && JSON.stringify(m.content).includes('事项已正式解决，尚未关闭')); assert.ok(result); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_INTERNAL/);
  await assert.rejects(withTenantTransaction(f.eid, async tx => { const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${f.eid} and id=${f.conversationId}`))!;
    return customerSiteMedia(tx, f.actor, c, r.id, r.mediaId, r.version); }));
  await propose(f, f.ownerIds[0], disclosure(true, true), selected(iid, true));
  const boss = f.site(), closeBody = { text: '确认正式关闭', mediaIds: [], versions: (await boss.read(f.projectId)).versions }, closeKey = randomUUID();
  const closed = await boss.send(f.projectId, closeBody, closeKey); assert.equal((await boss.send(f.projectId, closeBody, closeKey)).lifecycleId, closed.lifecycleId);
  assert.equal((await state(f, iid))!.state, 'closed'); assert.equal(await count(f), 3); await deliverSiteResults();
  await withTenantTransaction(f.eid, async tx => { const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${f.eid} and id=${f.conversationId}`))!;
    assert.ok(await customerSiteMedia(tx, f.actor, c, r.id, r.mediaId, r.version)); });
  const brief = await f.owner.execute('brief'); assert.equal((brief.items as Row[]).length, 2);
  assert.equal(((brief.items as Row[]).find(p => p.projectId === f.projectId)!.issues as Row[])[0].status, 'closed');
  const other = (brief.items as Row[]).find(p => p.projectId === f.otherProjectId)!; assert.ok(other.latestRecord); assert.equal((other.issues as Row[])[0].label, '待分配');
  await f.send('撤回共享资料' + drawing); assert.equal((await state(f, iid))!.available, false);
  await assert.rejects(boss.send(f.projectId, closeBody, closeKey), /context_changed/);
  messages = (await f.chat.messages(f.conversationId, undefined, 100)).items; assert.equal(messages.find(m => m.id === result.id)!.available, false);
}));
test('natural transfer pins the unique actual member and cannot retain a removed assignee or an old approved plan', async () => fixture(async (f, iid) => {
  await prepareApprovedNaturalPlans(f, iid, naturalPlanCases[0]);
  await propose(f, f.ownerIds[0], '请将书房底盒的位置核对转交给测试师傅继续处理。', { action: 'transfer', target: iid, assigneeName: '测试师傅' });
  const key = randomUUID(); await say(f, f.ownerIds[0], '确认转交', key);
  const issue = await withTenantTransaction(f.eid, tx => readSiteIssue(tx, f.eid, f.projectId, iid)); assert.equal(issue!.ownerId, f.memberIds[1]); assert.equal(issue!.status, 'awaiting_owner');
  await propose(f, f.ownerIds[0], '请把书房底盒转交给测试设计师。', { action: 'transfer', target: iid, assigneeName: '测试设计师' });
  await f.member(f.memberIds[0], 'designer', false); await assert.rejects(say(f, f.ownerIds[0], '确认转交'), /context_changed|version_conflict/);
}));
test('missing explicit customer disclosure stays visibly unexecuted; another member cannot select or confirm formal actions', async () => fixture(async (f, iid) => {
  const p = (await prepareApprovedNaturalPlans(f, iid, naturalPlanCases[0])).plans[1], r = await completion(f);
  await propose(f, f.memberIds[1], '书房已经装好，请记下现场落实。', { action: 'implement', target: iid, resolution: { planId: p.id, recordId: r.id, excerpt: '' } }, 'failed');
  await propose(f, f.ownerIds[0], '请正式解决书房底盒这件事，给客户回复一下。', { action: 'resolve', target: iid, resolution: { planId: '', recordId: '', excerpt: '' } });
  const items = (await f.site().read(f.projectId)).items as Row[]; assert.ok(items.some(i => /尚未落实/.test(String((i.response as Row)?.text || ''))));
  await say(f, f.ownerIds[0], '确认正式解决'); assert.equal(await count(f), 0);
}));
test('withdrawn completion evidence after a natural preview cannot be committed or displayed as a live result', async () => fixture(async (f, iid) => {
  const p = (await prepareApprovedNaturalPlans(f, iid, naturalPlanCases[0])).plans[1], r = await completion(f);
  const sent = await propose(f, f.memberIds[0], '请把书房这次已完成记录作为V2的落实依据。', { action: 'implement', target: iid, resolution: { planId: p.id, recordId: r.id, excerpt: '' } });
  await f.site().mutate(f.projectId, r.id, 'withdraw', { expectedVersion: r.version, reason: '合成证据撤回' }, randomUUID());
  await assert.rejects(say(f, f.memberIds[0], '确认落实'), /context_changed|site_execution_evidence_required|version_conflict/); assert.equal(await count(f), 0);
  const item = ((await f.site().read(f.projectId)).items as Row[]).find(i => (i.message as Row).id === sent.messageId)!; assert.match(String((item.response as Row).text), /权限已变化|材料或权限/);
}));
test('selected-enterprise owner, admin and super_admin inherit natural lifecycle management without project employment', async () => {
  for (let n = 0; n < 3; n++) await fixture(async (f, iid) => {
    const p = (await prepareApprovedNaturalPlans(f, iid, naturalPlanCases[0])).plans[1], r = await completion(f), aid = [f.ownerIds[0], ...f.platformIds][n];
    await propose(f, aid, '书房已按同意的V2落实，请登记这次已完成记录。', { action: 'implement', target: iid, resolution: { planId: p.id, recordId: r.id, excerpt: '' } });
    await say(f, aid, '确认落实'); await propose(f, aid, disclosure(), selected(iid)); await say(f, aid, '确认正式解决'); assert.equal((await state(f, iid))!.state, 'resolved');
  });
});
for (const withdraw of [false, true]) test(`one actual final repair may select the existing formal service view; a live source withdrawal fences that choice (withdraw=${withdraw})`, async () => fixture(async (f, iid, drawing) => {
  await prepareClosedLifecycle(f, iid, naturalPlanCases[0], true); await deliverSiteResults();
  const sent = await f.send('书房底盒现在处理到哪一步了？同意的是哪一版，这就算验收和付款完成了吗？'), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  let calls = 0, key = '';
  await processAgentAnswer(lease!, { model: async (messages, tools, turn) => {
    calls++;
    if (!turn) return { text: '', toolCalls: [{ id: 'read-closed', name: 'query_followups', arguments: '{}' }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
    if (turn === 1) {
      const packet = messages.filter(m => m.role === 'tool').map(m => JSON.parse(String(m.content))).findLast(m => m.query?.domain === 'followups'); key = packet.resultKey;
      const source = (packet.synthesisSources as SynthesisSource[]).find(s => s.followup?.kind === 'formal_plan')!; assert.ok(source);
      return { text: '', toolCalls: [{ id: 'rejected-financial-denial', name: 'final_response', arguments: JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'uncertainty',
        text: '这不算验收和付款完成。解决与关闭是由有权人员分别确认的流程结果，本次查询不包含工程验收、付款或结算凭据，因此不能据此认定验收通过或款项已结清。', citations: [{ citationId: sourceCitationCatalog(source)[0].citationId }] }] }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    assert.equal(turn, 2); assert.ok(tools.every(t => t.name === 'final_response')); const base = synthesisRepairBase(messages)!; assert.ok(base.businessResultKeys?.includes(key));
    if (withdraw) await f.send('撤回共享资料' + drawing);
    return { text: '', toolCalls: [{ id: 'existing-service-view', name: 'final_response', arguments: JSON.stringify({ kind: 'business_repair', baseHash: base.baseHash, resultKey: key }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 0, outputTokens: 0 } };
  } });
  const run = await f.chat.run(String(sent.runId)); assert.equal(calls, 3);
  if (withdraw) { assert.notEqual(run.status, 'succeeded'); assert.equal(run.outputMessageId, null); }
  else { assert.equal(run.status, 'succeeded', JSON.stringify(run));
    const result = (await f.chat.messages(f.conversationId, undefined, 100)).items.find(m => m.id === run.outputMessageId)!; const body = JSON.stringify(result.content);
    assert.match(body, /V2/); assert.match(body, /已正式关闭/); assert.match(body, /不代表工程验收/); assert.doesNotMatch(body, /这不算验收和付款完成|PRIVATE_INTERNAL/);
  }
}));
