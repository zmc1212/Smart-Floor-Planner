/** One real 1454 customer round on 2026-11-10: natural renovation chat, the
 * customer's own construction follow-up, designer recommendation and profile,
 * then a live-scheduled daily report opened, acknowledged and re-entered.
 * Real 3006 service, real Worker, Stable DevTools; no injected answers and no
 * retry of a dispatched provider call. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { wechatideNativeClient } from './wechatide-native-client';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'), 'Development only');
const root = path.resolve('..'), eid = '1454', customerId = '645', projectId = '237', bindingId = '422', ownerId = '2853';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-1454-customer-test-20261110/round-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner', 'Development database only');
fs.mkdirSync(output, { recursive: true });

const project = path.join(root, 'miniprogram');
const mp = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const report: Row = { startedAt: new Date().toISOString(), enterpriseId: eid, scope: 'customer journey: renovation chat, own site, designers, live daily report', checks: [], failures: [], turns: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const tenantOne = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => one(tx, q));
const tenantRows = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => rows(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => (dir + '/' + path.relative(path.join(root, dir), path.join(e.parentPath, e.name))).replaceAll('\\', '/'));
}
const bind = () => Object.fromEntries([...new Set([
  ...walk('miniprogram/packages/assistant'), ...walk('miniprogram/utils'), ...walk('admin/src/lib/assistant'),
  'admin/scripts/xiaok-1454-customer-round-20261110.ts',
].sort())].map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const before = bind();
report.bindingBefore = createHash('sha256').update(JSON.stringify(before)).digest('hex');

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    (report.checks as Row[]).push({ name, passed: true, data }); console.log(name + ': PASS'); save(); return data;
  } catch (e) {
    (report.checks as Row[]).push({ name, passed: false, error: (e as Error).message });
    (report.failures as Row[]).push({ name, error: (e as Error).stack || (e as Error).message }); save(); throw e;
  }
}
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn(); if (value) return value; await delay(intervalMs);
  }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
const evaluate = async <T>(source: string, ...args: unknown[]): Promise<T> => {
  const r = await mp.call('automation_evaluate', { project, fnSource: source, args });
  return r.result.result as T;
};
const pageData = () => evaluate<Row>(`() => {
  const p = getCurrentPages().at(-1); if (!p) return { route: null };
  const d = p.data; const text = m => String(m.text || ((m.blocks || []).map(b => b.text || '').join('')));
  return { route: p.route, loading: !!d.loading, needsLogin: !!d.needsLogin, busy: !!d.busy, generating: !!d.generating,
    error: d.error || '', followupActive: !!d.followupActive,
    conversation: d.conversation ? { id: String(d.conversation.id), status: d.conversation.status } : null,
    messages: (d.messages || []).map(m => ({ id: String(m.id), isUser: !!m.isUser, text: text(m),
      citations: (m.citations || []).map(c => ({ id: String(c.id), title: c.title || '', sourceKind: c.sourceKind || '' })),
      designer: m.designerRecommendation && Array.isArray(m.designerRecommendation.items)
        ? { items: m.designerRecommendation.items.map(c => ({ authorId: String(c.authorId), authorName: c.authorName || '',
            workTitle: c.work && c.work.title || '', style: c.work && c.work.primaryStyle || '', specialty: c.specialtyLine || '' })) } : null })),
    followupBindings: (d.followupBindings || []).map(b => ({ id: String(b.bindingId), title: b.title || '', audience: b.audience || '' })),
    followupReports: (d.followupReports || []).map(r => ({ reportId: String(r.reportId), revision: Number(r.revision), kind: r.kind,
      available: r.available !== false, ready: !!r.ready, readAt: r.readAt || null, title: r.cardTitle || r.title || '' })),
    reportQuestion: { selected: !!(d.reportQuestion && d.reportQuestion.selected), title: (d.reportQuestion && d.reportQuestion.title) || '',
      busy: !!d.reportQuestion?.busy, pending: !!d.reportQuestion?.pending, error: (d.reportQuestion && d.reportQuestion.error) || '' },
    followupDetail: d.followupDetail ? { reportId: String(d.followupDetail.reportId || ''), available: !!d.followupDetail.available,
      ready: !!d.followupDetail.ready, readAt: d.followupDetail.readAt || null,
      projects: (d.followupDetail.projects || []).map(x => ({ id: String(x.id), name: x.name || '', stage: x.stageName || '',
        progress: (x.progress || []).map(y => y.text || '') })) } : null,
    followupHistoryItems: (d.followupHistoryItems || []).map(i => ({ reportId: String(i.reportId), kind: i.kind, readAt: i.readAt || null, title: i.title || '' })),
    followupChat: d.followupChat ? { messages: (d.followupChat.messages || []).map(m => ({ id: String(m.id), isUser: !!(m.isUser || m.authorKind === 'user'), text: text(m) })),
      generating: !!d.followupChat.generating, busy: !!d.followupChat.busy, reception: !!d.followupChat.reception } : null };
}`);

async function sendTurn(text: string, label: string, followup = false) {
  const start = await pageData();
  assert.equal(start.route, 'packages/assistant/chat/chat', 'Chat route must be active');
  assert.ok(!start.needsLogin, 'Customer session must be accepted: ' + start.error);
  const count = followup ? start.followupChat.messages.length : start.messages.length;
  await mp.call('automation_element_action', { project, selector: 'textarea.composer-input', action: 'input', value: text });
  await delay(400);
  await mp.call('automation_element_action', { project, selector: '.send-button', action: 'tap' });
  const done = await waitFor('reply: ' + label, async () => {
    const now = await pageData();
    if (now.needsLogin) throw new Error('Session lost: ' + now.error);
    const state = followup ? now.followupChat : now;
    if (!state) return undefined;
    const size = state.messages.length;
    if (now.error && !state.generating && size === count) throw new Error('Send error: ' + now.error);
    return size >= count + 2 && !state.generating && !state.busy ? now : undefined;
  }, 420000);
  const state = followup ? done.followupChat : done;
  const user = state.messages.at(-2), reply = state.messages.at(-1)!;
  assert.ok(user.isUser || user.text.includes(text.slice(0, 4)), 'Customer message rendered');
  assert.ok(!reply.isUser && reply.text.trim().length > 30, 'Assistant reply rendered');
  const shot = path.join(output, 'turn-' + label + '.png');
  await mp.screenshot({ path: shot });
  report['shot-' + label] = { logical: [390, 844], bytes: fs.statSync(shot).size };
  save();
  return reply;
}
async function runFor(conversationId: string) {
  return tenantOne(sql`select id,status,error_code,policy_snapshot from app.assistant_runs
    where enterprise_id=${eid} and conversation_id=${Number(conversationId)} and purpose='reply' order by id desc limit 1`);
}

let installed = false, originalPlan: Row | undefined;
async function setPlan(version: number, changes: Row) {
  const service = new ConstructionReportService({ enterpriseId: eid, adminId: ownerId });
  const base = originalPlan!;
  return service.configure({ expectedVersion: version, enabled: true, dailyTime: base.dailyTime, weeklyTime: base.weeklyTime,
    projectIds: base.projectIds, stageKeys: base.stageKeys, stageEnabled: base.stageEnabled, weeklyDay: base.weeklyDay,
    audiences: base.audiences, inactivePolicy: base.inactivePolicy, ...changes }, 'customer-round-' + randomUUID());
}

async function main() {
  try {
    await step('preflight: idle queue, labelled project, customer binding and plan', async () => {
      await waitFor('idle assistant queue', async () => {
        const q = await platformOne(sql`select count(*) filter (where status in ('queued','running')) active from app.assistant_jobs`);
        return Number(q!.active) === 0 ? q : undefined;
      }, 180000, 3000);
      const proj = (await tenantOne(sql`select p.id,p.name,p.status,p.current_stage_key,p.version,p.customer_access,l.customer_user_id,p.lead_id
        from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        where p.enterprise_id=${eid} and p.id=${Number(projectId)}`))!;
      assert.match(String(proj.name), /合成手测/); assert.equal(proj.status, 'active'); assert.equal(proj.customer_access, true);
      assert.equal(String(proj.customer_user_id), customerId);
      const binding = (await tenantOne(sql`select id,audience,project_id,conversation_id,status,list_hidden from app.construction_followup_bindings
        where enterprise_id=${eid} and id=${Number(bindingId)}`))!;
      assert.equal(binding.audience, 'customer'); assert.equal(String(binding.project_id), projectId);
      assert.equal(binding.status, 'enabled'); assert.equal(binding.list_hidden, false); assert.ok(binding.conversation_id);
      const conv = (await tenantOne(sql`select id,purpose,mode,status from app.assistant_conversations
        where enterprise_id=${eid} and id=${Number(binding.conversation_id)}`))!;
      assert.equal(conv.purpose, 'construction_followup'); assert.equal(conv.mode, 'ai'); assert.equal(conv.status, 'open');
      const plan = reportPlanDto(await new ConstructionReportService({ enterpriseId: eid, adminId: ownerId }).settings() as Row, eid);
      originalPlan = plan;
      report.planOriginal = plan;
      const info = await mp.systemInfo();
      assert.equal(info.windowWidth, 390); assert.equal(info.windowHeight, 844);
      report.accounting = { before: String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id) };
      return { project: proj, binding: { id: String(binding.id), conversationId: String(binding.conversation_id) },
        plan: { version: plan.version, dailyTime: plan.dailyTime }, logical: [info.windowWidth, info.windowHeight] };
    });

    await step('customer session installed in the real chat runtime', async () => {
      const version = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
      const token = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: version, source: 'wechat' })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(customerId).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h')
        .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
      await evaluate(`(f) => {
        const app = getApp();
        const saved = { token: app.globalData.token, bootstrap: app.globalData.bootstrap, userInfo: app.globalData.userInfo, hydrate: app.hydrateStoredSession };
        app.__qaRound = saved; app.hydrateStoredSession = async () => {};
        app.globalData.token = f.token; app.globalData.userInfo = { _id: f.customerId, role: 'user' };
        app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.projects', 'customer.service', 'account'], context: { enterpriseId: f.enterpriseId } } };
        wx.setStorageSync('token', f.token); wx.removeStorageSync('assistant-active-conversation-v1');
      }`, { token, customerId, enterpriseId: eid });
      installed = true;
      await mp.redirectTo('/packages/assistant/chat/chat?fresh=' + Date.now());
      const ready = await waitFor('customer chat entry', async () => {
        const now = await pageData();
        if (now.needsLogin) throw new Error('Customer session rejected: ' + now.error);
        return now.route === 'packages/assistant/chat/chat' && !now.loading ? now : undefined;
      }, 120000);
      return { route: ready.route, conversation: ready.conversation };
    });

    await step('renovation chat turn with a real Agent answer', async () => {
      const reply = await sendTurn('我家正在改水电，打压试验要做到什么程度才算合格？', 'renovation');
      const run = await waitFor('renovation run', async () => {
        const r = await runFor((await pageData()).conversation!.id);
        return r && !['queued', 'running'].includes(String(r.status)) ? r : undefined;
      }, 30000);
      assert.equal(String(run!.status), 'succeeded', 'Run failed: ' + String(run!.error_code || ''));
      assert.ok(reply.text.length >= 40, 'Answer is substantive');
      const turn = { label: 'renovation', conversationId: String((await pageData()).conversation!.id), runId: String(run!.id),
        protocol: ((run!.policy_snapshot as Row)?.agentRuntime as Row)?.protocol || null, question: '我家正在改水电，打压试验要做到什么程度才算合格？',
        answer: reply.text, citations: reply.citations };
      (report.turns as Row[]).push(turn);
      return { runId: turn.runId, protocol: turn.protocol, citations: reply.citations.length, answerChars: reply.text.length };
    });

    await step('customer follow-up: grounded report question about the real site', async () => {
      await evaluate(`() => { const p = getCurrentPages().at(-1); p.openHistory(); return true; }`);
      const listed = await waitFor('follow-up list', async () => {
        const now = await pageData();
        return now.followupBindings.some(b => b.id === bindingId) ? now : undefined;
      }, 60000);
      assert.ok(listed.followupBindings.length >= 1, 'Customer follow-up list rendered');
      await evaluate(`(id) => { const p = getCurrentPages().at(-1); p.selectFollowup({ currentTarget: { dataset: { id } } }); return true; }`, bindingId);
      const thread = await waitFor('follow-up thread', async () => {
        const now = await pageData();
        if (now.followupActive && now.followupReports.length) return now;
        return undefined;
      }, 90000);
      const daily = thread.followupReports.find((r: Row) => r.kind === 'daily' && r.ready && r.available !== false);
      assert.ok(daily, 'A ready daily report exists for the customer');
      await evaluate(`(f) => { const p = getCurrentPages().at(-1);
        p.readFollowupReport({ currentTarget: { dataset: { report: f.report, revision: f.revision } } }); return true; }`,
        { report: String(daily.reportId), revision: Number(daily.revision) });
      const detail = await waitFor('customer daily detail', async () => {
        const now = await pageData();
        return now.followupDetail && now.followupDetail.ready ? now.followupDetail : undefined;
      }, 90000);
      assert.equal(detail.available, true, 'Customer daily detail available');
      assert.ok(detail.projects.some((p: Row) => String(p.id) === projectId), 'Customer daily detail carries the bound project');
      report.dailyDetailBeforeQuestion = { reportId: String(daily.reportId), revision: Number(daily.revision),
        projects: detail.projects.map((p: Row) => ({ id: String(p.id), stage: p.stage, progressLines: p.progress.length })) };
      await evaluate(`(f) => { const p = getCurrentPages().at(-1);
        p.askFollowupReport({ currentTarget: { dataset: { report: f.report, revision: f.revision } } }); return true; }`,
        { report: String(daily.reportId), revision: Number(daily.revision) });
      await waitFor('report question selected', async () => {
        const now = await pageData();
        return now.reportQuestion.selected ? now : undefined;
      }, 60000);
      const stage = (await tenantOne(sql`select current_stage_key,version from app.construction_projects where enterprise_id=${eid} and id=${Number(projectId)}`))!;
      const before = (await pageData()).followupChat!.messages.length;
      const reply = await sendTurn('我家现在施工到哪一步了？最近工地上都做了些什么？', 'own-site', true);
      const run = await waitFor('own-site run', async () => {
        const r = await runFor('1522');
        return r && !['queued', 'running'].includes(String(r.status)) ? r : undefined;
      }, 40000);
      assert.equal(String(run!.status), 'succeeded', 'Own-site run failed: ' + String(run!.error_code || ''));
      assert.ok(reply.text.length >= 40, 'Own-site answer is substantive');
      assert.ok(!/这件事需要现场确认，请和现场团队核实/.test(reply.text), 'Grounded answer replaces the coordination referral');
      const after = (await pageData()).followupChat!.messages.length;
      assert.ok(after >= before + 2, 'Own-site turn persisted in the follow-up thread');
      const turn = { label: 'own-site', conversationId: '1522', runId: String(run!.id),
        protocol: ((run!.policy_snapshot as Row)?.agentRuntime as Row)?.protocol || null,
        question: '我家现在施工到哪一步了？最近工地上都做了些什么？', answer: reply.text,
        reportId: String(daily.reportId), revision: Number(daily.revision),
        detailProgress: detail.projects.flatMap((p: Row) => p.progress).slice(0, 6),
        stageKey: String(stage!.current_stage_key), projectVersion: Number(stage!.version) };
      (report.turns as Row[]).push(turn);
      report.ownSite = { reportId: turn.reportId, revision: turn.revision, progressLines: turn.detailProgress };
      return { runId: turn.runId, protocol: turn.protocol, reportId: turn.reportId, stageKey: turn.stageKey, answerChars: reply.text.length };
    });

    await step('designer recommendation and public profile', async () => {
      await evaluate(`() => { const p = getCurrentPages().at(-1); p.back(); return true; }`);
      await waitFor('back to chat', async () => !(await pageData()).followupActive || undefined, 30000);
      const reply = await sendTurn('我喜欢现代简约风格，帮我推荐几位合适的设计师', 'designer');
      const now = await pageData();
      assert.ok(reply.designer && reply.designer.items.length >= 1, 'Designer cards rendered from the real recommendation');
      await mp.screenshot({ path: path.join(output, 'designer-cards.png') });
      const card = reply.designer.items[0];
      assert.ok(card.authorId && card.authorName, 'Designer card identity');
      await mp.call('automation_element_action', { project, selector: '.designer-card-head', action: 'tap' });
      const profile = await waitFor('designer profile', async () => {
        const r = await evaluate<Row>(`() => { const p = getCurrentPages().at(-1); if (!p || !String(p.route).includes('designer')) return null;
          const d = p.data; return { route: p.route, name: d.designer && d.designer.name || '', title: d.designer && d.designer.professionalTitle || '',
            city: d.designer && d.designer.cityLabel || '', styles: d.designer && d.designer.styles || [],
            works: (d.designer && d.designer.works || []).map(w => ({ title: w.title || '', style: w.primaryStyle || '' })).slice(0, 6),
            totalWorks: d.totalWorks || 0, loading: !!d.loading, error: d.error || '' }; }`);
        return r && r.route && !r.loading ? r : undefined;
      }, 90000);
      assert.ok(String(profile.name).length > 0, 'Designer profile name rendered: ' + String(profile.error || ''));
      assert.ok(Array.isArray(profile.works), 'Designer works rendered');
      await mp.screenshot({ path: path.join(output, 'designer-profile.png') });
      await mp.call('automation_navigate', { project, action: 'navigateBack' });
      await waitFor('back from designer', async () => (await pageData()).route === 'packages/assistant/chat/chat' || undefined, 30000);
      const run = await runFor(String((await pageData()).conversation!.id));
      report.designer = { runId: String(run!.id), card, profile: { name: profile.name, title: profile.title, city: profile.city,
        styles: profile.styles, works: profile.works, totalWorks: profile.totalWorks } };
      return { card, profile: { name: profile.name, works: profile.works.length, totalWorks: profile.totalWorks } };
    });

    await step('live-scheduled daily report delivered to the customer binding', async () => {
      const now = new Date();
      const at = new Date(now.getTime() + 2 * 60_000);
      const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
      assert.ok(originalPlan, 'Plan snapshot present');
      let staged: Row | undefined;
      for (let attempt = 0; attempt < 2 && !staged; attempt++) {
        try { staged = await setPlan(Number((await new ConstructionReportService({ enterpriseId: eid, adminId: ownerId }).settings() as Row).version), { dailyTime: hhmm, projectIds: [projectId] }); }
        catch (e) { if (attempt === 1) throw e; }
      }
      assert.ok(new Date(String(staged!.next_daily_at)).getTime() > now.getTime(), 'Controlled daily scheduled ahead');
      const found = await waitFor('daily report delivered', async () => {
        const r = await tenantRows(sql`select r.id report_id,r.latest_revision revision,v.body,v.body_run_id,
          br.status body_status,br.error_code body_error,d.state delivery_state,d.read_at
          from app.construction_reports r
          join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
          left join app.assistant_runs br on br.enterprise_id=v.enterprise_id and br.id=v.body_run_id
          left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision and d.binding_id=r.binding_id
          where r.enterprise_id=${eid} and r.binding_id=${Number(bindingId)} and r.kind='daily' and r.created_at>=${new Date(now.getTime() - 60_000)}`);
        if (!r.length) return undefined;
        const row = r[0];
        const ready = row.body && String(row.body_status) === 'succeeded' && String(row.delivery_state) === 'delivered';
        return ready ? row : undefined;
      }, 1200000, 5000);
      report.daily = { stagedVersion: Number(staged!.version), nextDailyAt: staged!.next_daily_at,
        reportId: String(found!.report_id), revision: Number(found!.revision), bodyRunId: String(found!.body_run_id),
        deliveryState: String(found!.delivery_state), readAt: found!.read_at || null };
      return { reportId: String(found!.report_id), revision: Number(found!.revision), nextDailyAt: staged!.next_daily_at };
    });

    await step('customer opens, reads and acknowledges the delivered daily in the client', async () => {
      const daily = report.daily as Row;
      const fromChat = await pageData();
      if (!fromChat.followupActive) {
        await evaluate(`() => { const p = getCurrentPages().at(-1); p.openHistory(); return true; }`);
        await waitFor('follow-up list again', async () => (await pageData()).followupBindings.some(b => b.id === bindingId) || undefined, 60000);
        await evaluate(`(id) => { const p = getCurrentPages().at(-1); p.selectFollowup({ currentTarget: { dataset: { id } } }); return true; }`, bindingId);
      }
      const thread = await waitFor('daily card in follow-up', async () => {
        const now = await pageData();
        const item = now.followupReports.find((r: Row) => r.reportId === daily.reportId && r.ready);
        return now.followupActive && item ? item : undefined;
      }, 120000);
      assert.equal(thread.kind, 'daily', 'Daily card kind');
      await mp.screenshot({ path: path.join(output, 'daily-card.png') });
      await evaluate(`(f) => { const p = getCurrentPages().at(-1);
        p.readFollowupReport({ currentTarget: { dataset: { report: f.report, revision: f.revision } } }); return true; }`,
        { report: String(thread.reportId), revision: Number(thread.revision) });
      const detail = await waitFor('daily detail', async () => {
        const now = await pageData();
        return now.followupDetail && now.followupDetail.ready ? now.followupDetail : undefined;
      }, 90000);
      assert.equal(detail.available, true, 'Daily detail available');
      assert.ok(detail.projects.some((p: Row) => String(p.id) === projectId && p.progress.length > 0), 'Daily detail carries real progress lines');
      await mp.screenshot({ path: path.join(output, 'daily-detail.png') });
      const ack = await waitFor('acknowledgement persisted', async () => {
        const r = await tenantOne(sql`select read_at from app.construction_report_deliveries
          where enterprise_id=${eid} and binding_id=${Number(bindingId)} and report_id=${Number(daily.reportId)}`);
        return r?.read_at ? r : undefined;
      }, 120000);
      await evaluate(`() => { const p = getCurrentPages().at(-1); p.closeFollowupReport(); return true; }`);
      await evaluate(`() => { const p = getCurrentPages().at(-1); p.followupHistory(); return true; }`);
      const history = await waitFor('history shows read', async () => {
        const now = await pageData();
        const item = now.followupHistoryItems.find((i: Row) => i.reportId === String(daily.reportId));
        return item && item.readAt ? item : undefined;
      }, 90000);
      await mp.screenshot({ path: path.join(output, 'daily-history.png') });
      report.dailyRead = { readAt: ack!.read_at, historyReadAt: history.readAt, progressLines: detail.projects.find((p: Row) => String(p.id) === projectId)?.progress };
      return { readAt: ack!.read_at, progressLines: (report.dailyRead as Row).progressLines?.length };
    });

    await step('reentry keeps the daily report and its read state', async () => {
      const daily = report.daily as Row;
      await mp.reLaunch('/packages/assistant/chat/chat?fresh=' + Date.now());
      await waitFor('chat after reentry', async () => {
        const now = await pageData();
        return now.route === 'packages/assistant/chat/chat' && !now.loading ? now : undefined;
      }, 90000);
      await evaluate(`() => { const p = getCurrentPages().at(-1); p.openHistory(); return true; }`);
      await waitFor('reentry follow-up list', async () => (await pageData()).followupBindings.some(b => b.id === bindingId) || undefined, 60000);
      await evaluate(`(id) => { const p = getCurrentPages().at(-1); p.selectFollowup({ currentTarget: { dataset: { id } } }); return true; }`, bindingId);
      const thread = await waitFor('reentry daily card', async () => {
        const now = await pageData();
        const item = now.followupReports.find((r: Row) => r.reportId === String(daily.reportId));
        return now.followupActive && item ? item : undefined;
      }, 120000);
      assert.equal(thread.kind, 'daily'); assert.ok(thread.readAt, 'Read state visible after reentry');
      await mp.screenshot({ path: path.join(output, 'daily-reentry.png') });
      return { reportId: thread.reportId, readAt: thread.readAt };
    });

    report.passed = true;
  } catch (e) {
    report.passed = false; report.error = (e as Error).message; process.exitCode = 1; console.error(e.message);
    try { report.lastState = await pageData(); } catch { /* keep the error only */ }
  } finally {
    try {
      if (originalPlan) {
        const current = new ConstructionReportService({ enterpriseId: eid, adminId: ownerId });
        await current.configure({ expectedVersion: Number((await current.settings() as Row).version), enabled: true,
          dailyTime: originalPlan.dailyTime, weeklyTime: originalPlan.weeklyTime, projectIds: originalPlan.projectIds,
          stageKeys: originalPlan.stageKeys, stageEnabled: originalPlan.stageEnabled, weeklyDay: originalPlan.weeklyDay,
          audiences: originalPlan.audiences, inactivePolicy: originalPlan.inactivePolicy }, 'customer-round-restore-' + randomUUID());
        const restored = reportPlanDto(await current.settings() as Row, eid);
        report.planRestored = { dailyTime: restored.dailyTime, projectIds: restored.projectIds, weeklyTime: restored.weeklyTime };
        assert.equal(restored.dailyTime, originalPlan.dailyTime); assert.deepEqual(restored.projectIds, originalPlan.projectIds);
      }
    } catch (e) { report.planRestored = { error: (e as Error).message }; report.passed = false; process.exitCode = 1; }
    if (installed) try {
      await evaluate(`() => { const a = getApp(), s = a.__qaRound; if (!s) return false;
        a.globalData.token = s.token; a.globalData.bootstrap = s.bootstrap; a.globalData.userInfo = s.userInfo; a.hydrateStoredSession = s.hydrate;
        delete a.__qaRound; return true; }`);
      await mp.reLaunch('/pages/index/index');
    } catch (e) { report.cleanupError = (e as Error).message; report.passed = false; }
    try { report.accounting = { ...(report.accounting as Row), after: String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id) }; } catch { /* keep before count */ }
    await mp.disconnect().catch(() => {});
    const after = bind();
    report.drift = Object.keys(before).filter(f => before[f] !== after[f]);
    if (report.drift.length) { report.passed = false; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ passed: report.passed, checks: (report.checks as Row[]).length, drift: report.drift.length, error: report.error }));
    await closePostgresPool();
  }
}
main();
