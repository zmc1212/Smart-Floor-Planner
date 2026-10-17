/** Explicit development-only PPT15/16/23/37 acceptance. Creates labelled synthetic
 * data without changing any existing enterprise, provider or customer record.
 * Credentials stay in memory. Native mode uses the verified existing DevTools window.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { readMemory } from '@/lib/assistant/agent/memory';
import { agentPromptVersion } from '@/lib/assistant/agent/context';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';

const root = path.resolve('..'), output = path.join(root, 'tmp/xiaok-vector/materials-followups-batch');
const require = createRequire(path.resolve('package.json'));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  loadEnvConfig(process.cwd(), true);
  // Load the service graph only after env initialization: some established auth
  // modules intentionally capture their signing key at module initialization.
  const [{ ConversationService }, { HandoffService }, { ConstructionService }, { defaultConstructionStages }, { queryNeedIssues }] = await Promise.all([
    import('@/lib/assistant/core/conversation'), import('@/lib/assistant/handoff/service'), import('@/lib/construction/service'),
    import('@/lib/construction/stages'), import('@/lib/construction/need-issues'),
  ]);
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432'
    && target.pathname === '/smart_floor_planner', 'Explicit approved development target required');
  fs.mkdirSync(output, { recursive: true });
  const prefix = 'synthetic-agent-materials-' + randomUUID(), native = process.argv.includes('--native');
  const report: Row = { prefix, startedAt: new Date().toISOString(), promptVersion: agentPromptVersion, checks: [], passed: false };
  const reportPath = path.join(output, native ? 'materials-native-driver.json' : 'materials-development-http.json');
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const layout = { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'f', floors: [{
    id: 'f', name: '一层', ceilingHeightMm: 2800,
    nodes: [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }, { id: 'c', xMm: 4000, yMm: 3000 }, { id: 'd', xMm: 0, yMm: 3000 }],
    walls: [{ id: 'ab', startNodeId: 'a', endNodeId: 'b' }, { id: 'bc', startNodeId: 'b', endNodeId: 'c' }, { id: 'cd', startNodeId: 'c', endNodeId: 'd' }, { id: 'da', startNodeId: 'd', endNodeId: 'a' }],
    openings: [], spaces: [{ id: 'study', name: '书房', closed: true, wallIds: ['ab', 'bc', 'cd', 'da'] }],
  }] } };
  let eid = '', uid = '', ownerId = '', designerId = '', cid = '', planId = '', leadId = '';
  try {
    const fixture = await withPlatformTransaction(async tx => {
      const template = await one(tx, sql`select s.agent_config,e.name,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404 and s.enabled`);
      assert.ok(template && String(template.name).startsWith('测试专用 · 小K公开工地') && String(template.code).startsWith('p4b-development-'));
      const config = template.agent_config as Row;
      assert.equal(config.providerKey, 'deepseek'); assert.equal(config.model, 'deepseek-flash'); assert.equal(config.runtime, 'langgraph-v1'); assert.equal(config.tools, true);
      eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · Agent资料与接续',${prefix},'active') returning id`))!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,100,1000000,10000000,30,${JSON.stringify({ ...config, imageInput: false })}::jsonb)`);
      for (const role of ['enterprise_admin', 'designer']) {
        const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
          values(${eid},${prefix + role},${'unusable:' + randomUUID()},${role},'active',false,${role === 'designer' ? '合成核对设计师' : '合成测试负责人'}) returning id`))!.id);
        if (role === 'designer') designerId = aid; else ownerId = aid;
      }
      uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values('合成资料接续业主',1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix + uid})`);
      return { enterpriseId: eid, ownerId, designerId, customerId: uid };
    });
    report.fixture = fixture; save();
    await withTenantTransaction(eid, async tx => {
      leadId = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,community_name)
        values(${eid},${uid},'合成资料接续客户','13800000000','natural','合成书房之家') returning id`))!.id);
      planId = String((await one(tx, sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data)
        values(${eid},${uid},'合成书房正式户型','manual','completed',${JSON.stringify(layout)}::jsonb) returning id`))!.id);
      await tx.execute(sql`update app.leads set primary_floor_plan_id=${planId} where enterprise_id=${eid} and id=${leadId}`);
    });
    const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
    const chat = new ConversationService(actor); cid = String((await chat.create(randomUUID())).id);
    const service = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
    const projectId = String((await service.execute('create', { leadId, name: '合成书房资料接续工地', managerId: designerId, rooms: ['书房', '客厅'] }, randomUUID())).id);
    const settings = await service.execute('stages', {}, randomUUID());
    await service.execute('saveStages', { expectedVersion: settings.version, stages: defaultConstructionStages.map(s => s.key === 'utilities'
      ? { ...s, followUps: [{ field: 'devices', room: '书房', question: '书房还有其他准备添置的设备吗？' }] } : s) }, randomUUID());
    report.fixture = { ...fixture, leadId, planId, projectId, conversationId: cid, layoutHash: fingerprint(layout) }; save();
    const token = await signMiniProgramToken({ sub: uid, id: uid, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
    const request = async (suffix: string, method = 'GET', body?: Row) => {
      const requestKey = randomUUID(), sending = suffix === '/messages' && method === 'POST';
      const payload = sending ? { clientMessageId: requestKey, content: body } : body;
      const response = await fetch('http://localhost:3006/api/miniprogram/assistant/conversations/' + cid + suffix, { method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Idempotency-Key': requestKey },
        ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(60000) });
      const result = await response.json(); assert.equal(response.status, sending ? 202 : 200, JSON.stringify(result)); return result.data;
    };
    const entryProbe = await fetch('http://localhost:3006/api/miniprogram/assistant/entry-context', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ conversationId: cid }), signal: AbortSignal.timeout(60000) });
    assert.equal(entryProbe.status, 200, JSON.stringify(await entryProbe.json()));
    (report.checks as Row[]).push({ name: 'synthetic bearer and exact-conversation HTTP entry probe', passed: true }); save();
    const runStatus = (runId: string) => withTenantTransaction(eid, tx => one(tx, sql`select status,output_message_id::text from app.assistant_runs where enterprise_id=${eid} and id=${runId} and conversation_id=${cid}`));
    const waitRun = async (runId: string) => {
      for (let i = 0; i < 120; i++) { const run = await runStatus(runId); if (run && !['queued', 'running'].includes(String(run.status))) { assert.equal(run.status, 'succeeded', JSON.stringify(run)); return run; } await delay(500); }
      throw Error('Development Worker did not complete the synthetic run');
    };
    const validateWrite = async () => {
      const c = (await withTenantTransaction(eid, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`)))!;
      const facts = readMemory(c.entry_snapshot).facts.filter(f => f.status === 'current');
      assert.ok(facts.some(f => f.room === '书房' && /靠窗|两人办公/.test(f.value))); return facts.map(f => ({ id: f.id, room: f.room, field: f.field, sourceMessageId: f.sourceMessageId }));
    };
    const progress = async () => {
      const detail = await service.execute('detail', { projectId }, randomUUID());
      await service.execute('progress', { projectId, expectedVersion: Number((detail.project as Row).version), stageKey: 'utilities', note: '', sendReminder: false }, randomUUID());
      await chat.messages(cid); return (await withTenantTransaction(eid, tx => queryNeedIssues(tx, actor, cid))).data[0];
    };
    const review = async () => {
      const customer = new HandoffService(actor), staff = new HandoffService({ enterpriseId: eid, principal: { kind: 'admin', adminId: designerId }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] });
      await customer.customerWrite(cid, randomUUID(), { action: 'request', recipientId: designerId });
      await staff.staffWrite(cid, randomUUID(), { action: 'claim' });
      const issue = (await withTenantTransaction(eid, tx => queryNeedIssues(tx, actor, cid))).data[0], packet = await staff.staffRead(cid);
      assert.ok(issue.sourceMessageId);
      await staff.staffWrite(cid, randomUUID(), { action: 'correct', field: 'devices', text: '显示器与台灯需求已核对，点位图仍待补充', sourceMessageId: issue.sourceMessageId, expectedVersion: packet.version });
      await staff.staffWrite(cid, randomUUID(), { action: 'reply', text: '显示器与台灯需求已核对，点位图仍待补充，暂未形成正式变更。' });
      await customer.customerWrite(cid, randomUUID(), { action: 'end' });
      const current = (await withTenantTransaction(eid, tx => queryNeedIssues(tx, actor, cid))).data[0];
      assert.equal(current.issueId, issue.issueId); assert.equal(current.lastProgress, 'designer_review'); return current;
    };
    if (native) {
      await require(path.join(output, 'materials-native.cjs')).run({ root, output, cid, token, enterpriseId: eid, validateWrite, progress, review, request, waitRun });
      (report.checks as Row[]).push({ name: 'native PPT15/16/23/37 original chat and same-issue chain', passed: true });
    } else {
      for (const text of ['请记录书房靠窗，偶尔两人办公。', '帮我找下书房对应的图纸和客户需求。']) {
        const sent = await request('/messages', 'POST', { version: 1, blocks: [{ type: 'text', text }] }); await waitRun(String(sent.runId));
      }
      await validateWrite(); await progress();
      for (const text of ['请记录，书房还需要显示器和台灯插座。', '之前书房补充的事现在在等谁？']) {
        const sent = await request('/messages', 'POST', { version: 1, blocks: [{ type: 'text', text }] }); await waitRun(String(sent.runId));
      }
      await review(); (report.checks as Row[]).push({ name: 'real HTTP/Worker/same-issue writes and S01 review', passed: true });
    }
    const runs = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text,status,output_message_id::text from app.assistant_runs where enterprise_id=${eid} and conversation_id=${cid} order by id`));
    const tools = await withTenantTransaction(eid, tx => rows(tx, sql`select s.run_id::text,s.capability_name from app.assistant_run_steps s join app.assistant_runs r on r.enterprise_id=s.enterprise_id and r.id=s.run_id
      where s.enterprise_id=${eid} and r.conversation_id=${cid} and s.capability_name in ('query_materials','query_followups','record_need') order by s.run_id,s.step_seq`));
    assert.ok(tools.some(s => s.capability_name === 'query_materials')); assert.ok(tools.some(s => s.capability_name === 'query_followups'));
    assert.equal(fingerprint((await withTenantTransaction(eid, tx => one(tx, sql`select layout_data from app.floor_plans where enterprise_id=${eid} and id=${planId}`)))!.layout_data), fingerprint(layout));
    report.runs = runs; report.tools = tools; report.finalIssue = (await withTenantTransaction(eid, tx => queryNeedIssues(tx, actor, cid))).data;
    report.usage = await withTenantTransaction(eid, tx => rows(tx, sql`select category,measurement_kind,sum(quantity)::text quantity,sum(input_tokens)::text input_tokens,sum(output_tokens)::text output_tokens
      from app.assistant_usage_records where enterprise_id=${eid} group by category,measurement_kind`));
    report.passed = true;
  } catch (error) { report.error = error instanceof Error ? error.message : String(error); throw error; }
  finally {
    if (eid) await withPlatformTransaction(async tx => {
      await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid} and username in (${prefix + 'enterprise_admin'},${prefix + 'designer'})`);
      if (uid) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid} and nickname='合成资料接续业主'`);
    });
    report.cleanup = { operatorsDisabled: !!eid, syntheticSessionRevoked: !!uid, retainedForReadback: true };
    report.finishedAt = new Date().toISOString(); save(); await closePostgresPool();
  }
  console.log(JSON.stringify({ passed: report.passed, fixture: report.fixture, report: reportPath }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
