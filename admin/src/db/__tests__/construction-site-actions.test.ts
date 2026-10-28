import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { AssistantError } from '@/lib/assistant/contracts';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { processSiteAction } from '@/lib/construction/site-action-worker';
import { siteActionPromptVersion } from '@/lib/construction/site-action-contract';
import { readSiteIssue } from '@/lib/construction/site-issues';
import { D4SharingFixture } from '../../../scripts/assistant-d4-sharing-fixture';

const f = new D4SharingFixture();
let rid = '', issueId = '', openMessage = '', openKey = '', openBody: Row;
const worker = () => f.site(f.memberIds[1]), designer = () => f.site(f.memberIds[0]);
const say = async (text: string, service = worker(), key = randomUUID()) => {
  const body = { text, mediaIds: [], versions: (await service.read(f.projectId)).versions };
  return { result: await service.send(f.projectId, body, key), key, body };
};
const issue = () => withTenantTransaction(f.eid, tx => readSiteIssue(tx, f.eid, f.projectId, issueId));
const issues = () => withTenantTransaction(f.eid, tx => rows(tx, sql`select id from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.site.issue.opened.v1'`));
const view = async (messageId: string) => ((await f.site().read(f.projectId, undefined, 100)).items as Row[]).find(i => (i.message as Row).id === messageId)!;
async function proposed(text: string, action: string, target: string, service = worker()) {
  const sent = await say(text, service); assert.equal(sent.result.recordId, null); assert.ok(sent.result.runId);
  const lease = await claimJob(); assert.equal(lease?.runId, sent.result.runId);
  await processSiteAction(lease!, async () => ({ text: JSON.stringify({ action, target }), toolCalls: [], finishReason: 'stop', providerRequestId: null,
    usage: { inputTokens: 100, outputTokens: 10 } }));
  const row = await withTenantTransaction(f.eid, tx => one(tx, sql`select status,error_code from app.assistant_runs where enterprise_id=${f.eid} and id=${String(sent.result.runId)}`));
  assert.equal(row?.status, 'succeeded', JSON.stringify(row)); return sent;
}
async function record(roomName = '书房') {
  const room = ((await f.site().read(f.projectId)).rooms as Row[]).find(r => r.name === roomName)!;
  const sent = await worker().send(f.projectId, { text: `${roomName}线管今天铺好了，底盒还没固定，等待核对位置。`, mediaIds: [] }, randomUUID());
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: roomName + '底盒待核对', roomId: String(room.id), completed: '线管铺好',
    pending: '底盒还没固定', coordination: '核对位置', note: '' }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 10, outputTokens: 10 } }));
  return String(sent.recordId);
}
before(async () => { await f.create(); rid = await record(); });
after(async () => {
  try { if (f.eid && process.env.D4_EVIDENCE_DIRECTORY) fs.writeFileSync(path.join(process.env.D4_EVIDENCE_DIRECTORY, 'actions-fixture.json'), JSON.stringify(await f.snapshot(), null, 2)); }
  finally { await f.cleanup(); await closePostgresPool(); }
});

test('a natural follow-up prepares one persisted preview without executing the model-selected action', async () => {
  const before = await issues();
  const sent = await proposed('帮我继续跟进书房底盒的位置，先别固定。', 'open', rid);
  openMessage = String(sent.result.messageId); openKey = sent.key; openBody = sent.body;
  assert.deepEqual(await issues(), before);
  assert.match(String(((await view(openMessage)).response as Row).text), /尚未执行.*确认跟进/s);
  assert.deepEqual(await worker().send(f.projectId, openBody, openKey), sent.result);
  assert.equal(((await worker().operation(f.projectId, openKey)).result as Row).runId, sent.result.runId);
});
test('acknowledgements and another member cannot confirm; the original author commits once with both original and consent audit', async () => {
  await say('收到'); await say('确认跟进', designer()); assert.equal((await issues()).length, 0);
  const confirmed = await say('确认跟进'); issueId = String(confirmed.result.issueId); assert.ok(issueId);
  assert.equal((await issues()).length, 1);
  const stored = await issue(); assert.equal(stored!.requestMessageId, openMessage); assert.equal(stored!.requestText, openBody.text);
  assert.deepEqual(await worker().send(f.projectId, confirmed.body, confirmed.key), confirmed.result);
  await say('确认跟进'); assert.equal((await issues()).length, 1);
  const audit = await withTenantTransaction(f.eid, tx => one(tx, sql`select payload from app.domain_event_outbox
    where enterprise_id=${f.eid} and type='construction.site.action.confirmed.v1'`));
  assert.equal((audit!.payload as Row).sourceMessageId, openMessage); assert.equal((audit!.payload as Row).confirmationMessageId, confirmed.result.messageId);
});
test('the designer naturally volunteers, confirms and replies with the entire original statement, without resolving or publishing', async () => {
  await proposed('书房这个底盒的位置我来负责核对。', 'claim', issueId, designer());
  assert.equal((await issue())!.ownerId, null); await say('确认接手', designer()); assert.equal((await issue())!.ownerId, f.memberIds[0]);
  const text = '书房底盒我核过了，请记下我的回复：先不固定，还要核对桌子的位置，暂时不能按这句施工。';
  const reply = await proposed(text, 'reply', issueId, designer());
  assert.equal((await issue())!.state, 'awaiting_owner');
  await say('确认回复', designer());
  const current = await issue(); assert.equal(current!.progressMessageId, reply.result.messageId); assert.equal(current!.state, 'awaiting_review');
  assert.ok(current!.text.includes(text));
  assert.match(String(((await view(String(reply.result.messageId))).response as Row).text), /待团队核对/);
  const r = await withTenantTransaction(f.eid, tx => one(tx, sql`select status,audience from app.construction_site_records where enterprise_id=${f.eid} and id=${rid}`));
  assert.equal(r!.status, 'draft'); assert.equal(r!.audience, 'internal');
});
test('source changes invalidate the visible preview and reject confirmation without adopting newer versions', async () => {
  const request = await proposed('把书房底盒这段记成我的回复，仍需现场核对。', 'reply', issueId, designer());
  const r = (await f.site().read(f.projectId, undefined, 100)).items as Row[], source = r.find(i => (i.record as Row)?.id === rid)!.record as Row;
  await f.site().mutate(f.projectId, rid, 'edit', { expectedVersion: source.version, data: { ...(source.data as Row), pending: '底盒位置已变化，仍待核对' } }, randomUUID());
  assert.match(String(((await view(String(request.result.messageId))).response as Row).text), /原材料或权限已变化/);
  await assert.rejects(say('确认回复', designer()), /context_changed/);
});
test('a correction cancels only its queued natural-action run and never sends the old request to a provider', async () => {
  const queued = await say('帮我跟进书房这个底盒位置。'); assert.ok(queued.result.runId);
  await say('书房的现场资料在哪里？');
  const r = await withTenantTransaction(f.eid, tx => one(tx, sql`select r.status,j.provider_started_at,q.status as quota from app.assistant_runs r
    join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id
    where r.enterprise_id=${f.eid} and r.id=${String(queued.result.runId)}`));
  assert.equal(r!.status, 'cancelled'); assert.equal(r!.provider_started_at, null); assert.equal(r!.quota, 'released'); assert.equal(await claimJob(), null);
});
test('membership removal and re-addition never revive an old proposal; cross-project, cross-tenant and observer writes stay denied', async () => {
  const request = await proposed('帮我跟进书房底盒的新位置，先不要施工。', 'open', rid);
  await f.member(f.memberIds[1], 'worker', false);
  await assert.rejects(worker().read(f.projectId)); await assert.rejects(say('确认跟进'));
  await f.member(f.memberIds[1], 'worker', true);
  await assert.rejects(say('确认跟进'), /context_changed/);
  assert.match(String(((await view(String(request.result.messageId))).response as Row).text), /原材料或权限已变化/);
  await assert.rejects(worker().read(f.otherProjectId)); await assert.rejects(f.site(f.ownerIds[1]).read(f.projectId));
  await assert.rejects(say('帮我跟进书房底盒位置', f.site(f.memberIds[2])));
});
test('owner, admin and super_admin retain their selected-enterprise management rights without joining the project', async () => {
  for (const adminId of [f.ownerIds[0], ...f.platformIds]) {
    const target = await record('客厅'), service = f.site(adminId);
    await proposed('帮我跟进客厅底盒位置，先别固定。', 'open', target, service);
    assert.ok((await say('确认跟进', service)).result.issueId);
  }
});
test('a progress-record request keeps one original and uses the existing record worker instead of silently losing the report', async () => {
  const text = '帮我记下书房今天这次进展：线管铺好了，底盒还没固定。';
  const sent = await proposed(text, 'report', '');
  const r = await withTenantTransaction(f.eid, tx => one(tx, sql`select id::text,run_id::text,status from app.construction_site_records
    where enterprise_id=${f.eid} and source_message_id=${String(sent.result.messageId)}`));
  assert.equal(r!.status, 'organizing'); assert.notEqual(r!.run_id, sent.result.runId);
  const lease = await claimJob(); assert.equal(lease?.runId, r!.run_id);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房进展', roomId: f.roomId, completed: '线管铺好', pending: '底盒还没固定', coordination: '', note: '' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 10, outputTokens: 10 } }));
  const original = await view(String(sent.result.messageId));
  assert.equal((original.record as Row).status, 'draft'); assert.equal((original.record as Row).audience, 'internal');
  const count = await withTenantTransaction(f.eid, tx => one(tx, sql`select count(*)::int n from app.assistant_messages where enterprise_id=${f.eid}
    and conversation_id=${String(sent.result.conversationId)} and author_kind='admin' and client_message_id=${sent.key}`));
  assert.equal(count!.n, 1);
});
test('a recovered lease consumes its exact successful checkpoint without dispatching the provider again', async () => {
  const queued = await say('帮我继续跟进书房底盒位置。');
  const first = await claimJob(); assert.equal(first?.runId, queued.result.runId);
  const output = { text: JSON.stringify({ action: 'open', target: rid }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 10 } };
  await withTenantTransaction(f.eid, async tx => {
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary,private_checkpoint)
      values(${f.eid},${first!.runId},1110,'agent_model','succeeded',${JSON.stringify({ promptVersion: siteActionPromptVersion })}::jsonb,${JSON.stringify(output)}::jsonb)`);
    await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
      values(${f.eid},${first!.runId},${'run:' + first!.runId},'tokens',110,'observed',100,10)`);
    await tx.execute(sql`update app.assistant_jobs set provider_started_at=now(),lease_expires_at=now()-interval '1 second' where enterprise_id=${f.eid} and id=${first!.jobId}`);
  });
  const recovered = await claimJob(); assert.equal(recovered?.runId, first!.runId);
  await processSiteAction(recovered!, async () => { throw Error('A completed checkpoint must not redispatch'); });
  assert.match(String(((await view(String(queued.result.messageId))).response as Row).text), /尚未执行/);
  await say('取消这次操作');
});
test('a correction while inference is in flight cancels only the proposal and still preserves the returned usage', async () => {
  const queued = await say('帮我跟进书房底盒位置，先别动。'), lease = await claimJob(); assert.equal(lease?.runId, queued.result.runId);
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), continuation = new Promise<void>(resolve => { finish = resolve; });
  const processing = processSiteAction(lease!, async () => { entered(); await continuation; return { text: JSON.stringify({ action: 'open', target: rid }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 10 } }; });
  await started;
  try { await say('书房的现场资料在哪里？'); } finally { finish(); await processing; }
  const r = await withTenantTransaction(f.eid, tx => one(tx, sql`select r.status,(select quantity from app.assistant_usage_records where enterprise_id=r.enterprise_id and run_id=r.id and category='tokens' limit 1) tokens
    from app.assistant_runs r where r.enterprise_id=${f.eid} and r.id=${String(queued.result.runId)}`));
  assert.equal(r!.status, 'cancelled'); assert.equal(Number(r!.tokens), 110);
  assert.match(String(((await view(String(queued.result.messageId))).response as Row).text), /原材料或权限已变化/);
});
test('an actual uncertain service outcome retains its request and cost hold, with no automatic replay or confirmation action', async () => {
  const queued = await say('帮我跟进书房底盒位置，先等核对。');
  const lease = await claimJob(); assert.equal(lease?.runId, queued.result.runId);
  await processSiteAction(lease!, async () => { throw new AssistantError('model_unavailable', 503); });
  const r = await withTenantTransaction(f.eid, tx => one(tx, sql`select r.status,r.error_code,q.status as quota from app.assistant_runs r
    join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id where r.enterprise_id=${f.eid} and r.id=${String(queued.result.runId)}`));
  assert.equal(r!.status, 'indeterminate'); assert.equal(r!.error_code, 'provider_outcome_unknown'); assert.equal(r!.quota, 'reconciling');
  assert.match(String(((await view(String(queued.result.messageId))).response as Row).text), /提交结果待核对/);
  await assert.rejects(say('帮我跟进书房底盒位置，先等核对。'), /provider_outcome_unknown/);
  assert.equal(await claimJob(), null);
});
