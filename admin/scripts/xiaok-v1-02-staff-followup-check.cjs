/** Run as the bounded adapter of xiaok-v1-02-report-context-check.ts.
 * New labelled recipients keep the retained27/50/60-64 controls untouched.
 * Synthetic messages/runs exercise protocol guards; they are not model output. */
/* eslint-disable @typescript-eslint/no-require-imports -- This Node CommonJS adapter loads TS services through its parent tsx process. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');

module.exports = async ctx => {
  const { root, owner, site, pid, recordId, read, step, report, save } = ctx, eid = '1454';
  const nativeRemainder = process.argv.includes('--staff-native-remainder');
  assert.ok(!nativeRemainder || process.argv.includes('--staff-native'));
  const req = createRequire(path.join(root, 'admin/package.json')), { sql } = req('drizzle-orm');
  const { withPlatformTransaction } = req('./src/db/transaction.ts');
  const { one } = req('./src/db/repositories/assistant-repository.ts');
  const { AdminUserRepository } = req('./src/db/repositories/admin-user-repository.ts');
  const { UserRepository } = req('./src/db/repositories/user-repository.ts');
  const { MiniProgramIdentityRepository } = req('./src/db/repositories/miniprogram-identity-repository.ts');
  const { ReportContextService } = req('./src/lib/construction/report-context.ts');
  const { ConstructionReportService, reportPlanDto } = req('./src/lib/construction/report-service.ts');
  const { enqueueReport } = req('./src/lib/construction/report-store.ts');
  const { claimJob } = req('./src/lib/assistant/infrastructure/job-queue.ts');
  const { processConstructionReport, deliverConstructionReports } = req('./src/lib/construction/report-worker.ts');
  const { ConversationService, appendMessage, cancelRuns } = req('./src/lib/assistant/core/conversation.ts');
  const { boundReportContext } = req('./src/lib/assistant/agent/report-context.ts');
  const { businessSnapshotAvailable } = req('./src/lib/assistant/agent/business-tools.ts');
  const { knowledgeContext } = req('./src/lib/assistant/knowledge/applicability-context.ts');
  const { SignJWT } = req('jose');
  const actors = [], ownedRuns = [], prefix = 'synthetic-v1-02-staff-' + randomUUID().slice(0, 8);
  const result = { scope: 'staff06/07 owner-only report/source protocol; no normal-model or complete stage acceptance', actors: [], cleanup: false };
  if (nativeRemainder) result.reuse = { service: 'tmp/v1-02-staff-followup/service-01/report.json',
    nativePrefix: 'tmp/v1-02-staff-followup/native-02/native.json',
    scope: 'Fresh worker/designer fixtures only; prior five-role guards and worker original-key assertions are not replayed.' };
  report.scope = nativeRemainder ? 'Staff06/07 native remainder: real quota feedback, source HTTP503 retry and designer persisted reentry; fixture preparation only, no model acceptance'
    : result.scope;
  const sign = a => new SignJWT({ sub: a.uid, id: a.uid, mode: 'staff', role: a.role, staffId: a.aid, enterpriseId: eid,
    contextVersion: a.actor.contextVersion, source: 'password' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(a.uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const http = async (a, suffix, body, requestKey = randomUUID(), expected = 200) => {
    const response = await fetch('http://127.0.0.1:3006/api/miniprogram/assistant' + suffix, { method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + a.token, ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const data = await response.json(); assert.equal(response.status, expected, suffix + ': ' + response.status + '/' + data.code);
    return expected === 200 ? data.data : data;
  };
  try {
    await step(nativeRemainder ? 'fresh worker/designer signed identities for native remainder' : 'staff recipients and five real signed Mini identities; original private controls preserved', async () => {
      for (const role of nativeRemainder ? ['construction_staff','designer'] : ['construction_staff','designer','enterprise_admin','admin','super_admin']) {
        const a = await withPlatformTransaction(async tx => {
          const repo = new AdminUserRepository(tx), staff = await repo.create({ enterpriseId: BigInt(eid), username: prefix + ':' + role,
            displayName: '合成测试·私人跟进·' + role, passwordHash: 'unusable-local-fixture', role, status: 'active', mustChangePassword: false });
          const mini = new MiniProgramIdentityRepository(tx), user = await mini.ensureStaffUser(staff);
          await new UserRepository(tx).update(user.id, { phone: '199' + String(user.id).padStart(8, '0') });
          assert.ok(await mini.selectContext(user.id, { mode: 'staff', staffId: staff.id, enterpriseId: BigInt(eid) }));
          return { aid: String(staff.id), uid: String(user.id), role, actor: { enterpriseId: eid,
            principal: { kind: 'admin', adminId: String(staff.id) }, contextVersion: Number(user.contextVersion), capabilities: ['assistant.followup.self'],
            entry: { miniProgramUserId: String(user.id), miniProgramContextVersion: Number(user.contextVersion) } } };
        });
        actors.push(a); result.actors.push({ aid: a.aid, uid: a.uid, role }); report.staffFixture = result; save();
        if (['construction_staff','designer'].includes(role)) {
          const p = (await owner.execute('detail', { projectId: pid })).project;
          await owner.execute('member', { projectId: pid, expectedVersion: p.version, adminId: a.aid,
            role: role === 'designer' ? 'designer' : 'worker', active: true, workLabel: '合成06/07私人提问' }, randomUUID());
        }
        a.token = await sign(a);
        const opened = await http(a, '/followups/open', {}); a.bid = opened.bindingId; a.cid = opened.conversationId;
        Object.assign(result.actors.at(-1), { bid: a.bid, cid: a.cid }); save();
      }
      return { roles: actors.map(a => a.role), newRecipientReason: 'retained owner/private controls remain stopped or human; no rebinding' };
    });
    await step(nativeRemainder ? 'fresh fact reports, selected references and source protocol fixtures for native remainder' : 'staff original reports save, exact selection/readback and quota rejection roll back sends', async () => {
      const plan = new ConstructionReportService(owner.actor), p = reportPlanDto(await plan.settings(), eid);
      await plan.configure({ expectedVersion: p.version, enabled: true, stageEnabled: false, projectIds: [pid], stageKeys: [],
        audiences: ['customer','worker','designer','boss'], dailyTime: p.dailyTime, weeklyTime: p.weeklyTime, weeklyDay: p.weeklyDay, inactivePolicy: p.inactivePolicy }, randomUUID());
      for (const a of actors) {
        const clock = (await read(tx => one(tx, sql`select date_trunc('day',clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai' as start,
          clock_timestamp()+interval '1 millisecond' as cutoff`)));
        const made = await read(async tx => enqueueReport(tx, eid,
          await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${a.bid}`),
          await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`),
          { kind: 'daily', start: new Date(clock.start), end: new Date(clock.cutoff), cutoff: new Date(clock.cutoff), scheduledAt: new Date(clock.cutoff) }));
        assert.ok(made); ownedRuns.push(made.runId); const lease = await claimJob(); assert.equal(lease?.runId, made.runId);
        await processConstructionReport(lease); await deliverConstructionReports(eid); a.rid = made.reportId;
        const base = '/followups/' + a.bid + '/conversation', detail = await http(a, '/followups/' + a.bid + '/reports/' + a.rid);
        assert.ok(detail.available && detail.facts.projects.some(p => p.id === pid && p.records.some(r => r.id === recordId)));
        const body = { expectedVersion: 0, selection: { bindingId: a.bid, reportId: a.rid, revision: 1, projectId: pid } }, requestKey = randomUUID();
        a.selection = await http(a, base + '/report-context', body, requestKey);
        assert.deepEqual(await http(a, base + '/report-context', body, requestKey), a.selection);
        assert.equal(a.selection.selected.projectId, pid); assert.equal(a.selection.topicAvailable, false);
        const state = await http(a, base); assert.equal(state.reportContext.selected.reportId, a.rid); assert.equal(state.previewScope, undefined);
        const context = await read(async tx => knowledgeContext(tx, a.actor, await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${a.cid}`)));
        assert.equal(context.projectId, pid); assert.equal(context.stage, 'utilities');
        if (!nativeRemainder) {
        const sendKey = randomUUID(), error = await http(a, base + '/messages', { clientMessageId: sendKey,
          content: { version: 1, reportContextVersion: a.selection.version, blocks: [{ type: 'text', text: '厨房这个点位还需要核对什么？' }] } }, sendKey, 429);
        assert.equal(error.code, 'assistant_quota_exceeded');
        assert.equal(await read(async tx => !!await one(tx, sql`select id from app.assistant_messages where enterprise_id=${eid} and conversation_id=${a.cid} and client_message_id=${sendKey}`)), false);
        }
        a.protocol = await read(async tx => {
          const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${a.cid}`);
          const run = await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_schedule_key,purpose,status,policy_snapshot,context_revision,knowledge_epoch)
            values(${eid},${a.cid},'scheduled_task',${'synthetic06-protocol:' + randomUUID()},'reply','cancelled','{}'::jsonb,${c.context_revision},1) returning id`);
          const snapshot = await boundReportContext(tx, a.actor, c, String(run.id)); assert.ok(snapshot);
          assert.equal(snapshot.snapshot.customerId, undefined); assert.equal(snapshot.snapshot.reportReference.principal.adminId, a.aid);
          assert.equal(await businessSnapshotAvailable(tx, eid, snapshot.snapshot), true); a.snapshot = snapshot.snapshot;
          const source = await one(tx, sql`select ch.*,d.id as document_id from app.assistant_knowledge_documents d join app.assistant_knowledge_chunks ch
            on ch.enterprise_id=d.enterprise_id and ch.document_version_id=d.published_version_id where d.enterprise_id=${eid} and d.id=404 and d.status='active' order by ch.id limit 1`);
          assert.equal(String(source.document_version_id), '410');
          const question = a.role === 'designer' ? '厨房台面插座的位置还没定，我需要先核对哪些信息？'
            : a.role === 'construction_staff' ? '厨房台面插座的位置还没定，我现在要先核对什么？' : '这个工地现在有哪些事情需要我确认？';
          await appendMessage(tx, a.actor, a.cid, { author: 'admin', clientMessageId: randomUUID(), purpose: 'reply',
            content: { version: 1, blocks: [{ type: 'text', text: question }] } });
          const message = await appendMessage(tx, a.actor, a.cid, { author: 'assistant', runId: String(run.id),
            content: { version: 1, blocks: [{ type: 'text', text: '合成协议夹具，不是模型回答：仅核验本人来源按钮。' }] } });
          const citation = await one(tx, sql`insert into app.assistant_message_citations(enterprise_id,conversation_id,message_id,run_id,source_kind,resource_type,resource_id,resource_version,
            document_id,document_version_id,chunk_id,source_hash,quote_snapshot,locator,is_draft)
            values(${eid},${a.cid},${String(message.id)},${String(run.id)},'knowledge','knowledge_chunk',${String(source.id)},${String(source.document_version_id)},${String(source.document_id)},
            ${String(source.document_version_id)},${String(source.id)},${String(source.text_hash)},${String(source.text).slice(0,180)},${JSON.stringify(source.locator)}::jsonb,false) returning id`);
          return { runId: String(run.id), messageId: String(message.id), citationId: String(citation.id), synthetic: true,
            humanMessage: { synthetic: true, naturalLanguage: true, text: question }, queuedJob: false, providerAttempt: false };
        });
        const citation = await http(a, base + '/citations/' + a.protocol.citationId); assert.equal(citation.available, true);
        assert.ok(citation.quote); assert.equal(citation.isDraft, false);
        Object.assign(result.actors.find(r => r.aid === a.aid), { rid: a.rid, protocol: a.protocol }); save();
      }
      return { normalSend: nativeRemainder ? 'Deferred to the one real native quota-feedback check; no fixture sends'
        : 'blocked_by_inherited_quota; zero committed sends/dispatches', roles: actors.length, originalSnapshotAndPublishedSource: true };
    });
    if (!nativeRemainder) await step('private owner, selected tenant, reception and ordinary-preview boundaries', async () => {
      const a = actors[0], b = actors[1], base = '/followups/' + a.bid + '/conversation';
      await http(b, base, undefined, undefined, 404);
      await http(b, base + '/citations/' + a.protocol.citationId, undefined, undefined, 404);
      await http(a, '/followups/' + b.bid + '/conversation/citations/' + a.protocol.citationId, undefined, undefined, 404);
      for (const action of ['handoff','media','report-topic']) await http(a, base + '/' + action, {}, undefined, 403);
      await assert.rejects(new ReportContextService({ ...a.actor, enterpriseId: '1455' }, a.cid).read());
      assert.throws(() => new ConversationService(a.actor).create(randomUUID()));
      return { otherRecipient: 'denied', crossTenant: 'denied', receptionMediaTopic: 'denied', previewScope: 'absent' };
    });
    if (process.argv.includes('--staff-native')) {
      const fs = require('node:fs'); const nativePath = path.join(root, 'tmp/v1-02-staff-followup/native.cjs');
      assert.ok(fs.existsSync(nativePath)); result.native = await require(nativePath)({ ...ctx, actors, http });
      assert.equal(result.native.passed, true);
    }
    if (!nativeRemainder) await step('member removal and original withdrawal invalidate private selection and business snapshots', async () => {
      const a = actors[0], p = (await owner.execute('detail', { projectId: pid })).project;
      await owner.execute('member', { projectId: pid, expectedVersion: p.version, adminId: a.aid, role: 'worker', active: false, workLabel: '合成06撤权' }, randomUUID());
      await http(a, '/followups/' + a.bid + '/conversation', undefined, undefined, 404);
      assert.equal(await read(tx => businessSnapshotAvailable(tx, eid, a.snapshot)), false);
      const source = await read(tx => one(tx, sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${recordId}`));
      await site.mutate(pid, recordId, 'withdraw', { expectedVersion: Number(source.version), reason: '合成06/07原始来源撤回' }, randomUUID());
      for (const b of actors.slice(1)) {
        const q = await http(b, '/followups/' + b.bid + '/conversation/report-context'); assert.equal(q.invalidated, true); assert.equal(q.selected, null);
        assert.equal(await read(tx => businessSnapshotAvailable(tx, eid, b.snapshot)), false);
        const removed = await http(b, '/followups/' + b.bid + '/conversation/report-context', { expectedVersion: q.version, selection: null }); assert.equal(removed.selected, null);
      }
      return { memberReadDenied: true, allSnapshotsRevoked: true, removableByStillAuthorizedRecipients: true };
    });
    result.passed = true; result.normalModelAnswer = 'unverified_inherited_quota_and_semantic_stop';
    return result;
  } finally {
    // One failed connection must not skip the remaining owned cleanup. Record
    // each original failure and attempt every independent resource once.
    const cleanupErrors = [];
    const clean = async (scope, fn) => { try { await fn(); } catch (error) { cleanupErrors.push({ scope, error: error.stack }); } };
    await clean('cancel_owned_runs', () => read(async tx => {
      for (const a of actors) if (a.cid) await cancelRuns(tx, a.actor, a.cid);
    }));
    await clean('stop_owned_bindings', () => read(async tx => {
      for (const a of actors) if (a.bid) await tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1,updated_at=now() where enterprise_id=${eid} and id=${a.bid} and admin_id=${a.aid}`);
    }));
    await clean('disable_owned_staff', () => withPlatformTransaction(async tx => {
      for (const a of actors) await new AdminUserRepository(tx).update(BigInt(a.aid), { status: 'disabled' });
    }));
    await clean('idle_queue', async () => {
      const queue = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));
      assert.equal(queue.n, 0);
    });
    result.cleanup = cleanupErrors.length === 0; result.cleanupErrors = cleanupErrors; save();
    if (cleanupErrors.length) throw new Error('Owned staff cleanup incomplete: ' + cleanupErrors.map(e => e.scope).join(', '));
  }
};
