/** 1454 focused daily: a live-scheduled daily for the customer binding, then
 * the customer opens, acknowledges, lists history and re-enters; the client
 * shows the delivered card with its read state. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { wechatideNativeClient } from './wechatide-native-client';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454', customerId = '645', leadId = '3132', bindingId = '422', projectId = '237', ownerId = '2853';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-1454-customer-test-20261110/daily-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const project = path.join(root, 'miniprogram');
const mp = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
type Report = Row & { checks: Row[]; failures: Row[]; passed?: boolean; error?: string };
type PageState = { route: string | null; loading: boolean; followupActive: boolean; followupBindings: string[];
  followupReports: Array<{ reportId: string; kind: string; ready: boolean; readAt: unknown; title: string }> };
const report: Report = { startedAt: new Date().toISOString(), checks: [], failures: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const tenantOne = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => one(tx, q));
const tenantRows = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => rows(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { const v = await fn(); if (v) return v; await delay(intervalMs); }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
async function api(token: string, route: string, init: { method?: string; body?: Row; entry?: string; key?: string; expect?: number | number[] } = {}) {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
  if (init.entry) headers['X-Assistant-Entry'] = init.entry;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.key) headers['Idempotency-Key'] = init.key;
  const response = await fetch(base + route, { method: init.method || (init.body !== undefined ? 'POST' : 'GET'), headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => ({})) as Row;
  const expected = init.expect ?? 200;
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), route + ': ' + response.status + '/' + String(data.code || data.error || ''));
  return data.data as Row;
}
const evaluate = async <T>(source: string, ...args: unknown[]): Promise<T> => (await mp.call('automation_evaluate', { project, fnSource: source, args })).result.result as T;
const page = () => evaluate<PageState>(`() => { const p = getCurrentPages().at(-1); if (!p) return { route: null }; const d = p.data;
  return { route: p.route, loading: !!d.loading, followupActive: !!d.followupActive,
    followupBindings: (d.followupBindings || []).map(b => String(b.bindingId)),
    followupReports: (d.followupReports || []).map(r => ({ reportId: String(r.reportId), kind: r.kind, ready: !!r.ready, readAt: r.readAt || null, title: r.cardTitle || r.title || '' })) }; }`);

let installed = false, original: Row | undefined;
async function main() {
  try {
    await waitFor('idle queue', async () => {
      const q = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
      return Number(q!.n) === 0 ? q : undefined;
    }, 120000, 3000);
    const service = new ConstructionReportService({ enterpriseId: eid, adminId: ownerId });
    original = reportPlanDto(await service.settings() as Row, eid);
    const now = new Date();
    const at = new Date(now.getTime() + 2 * 60_000);
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
    const input = (version: number, changes: Row) => ({ expectedVersion: version, enabled: true, dailyTime: original!.dailyTime,
      weeklyTime: original!.weeklyTime, projectIds: original!.projectIds, stageKeys: original!.stageKeys, stageEnabled: original!.stageEnabled,
      weeklyDay: original!.weeklyDay, audiences: original!.audiences, inactivePolicy: original!.inactivePolicy, ...changes });
    let staged: Row | undefined;
    for (let attempt = 0; attempt < 2 && !staged; attempt++) {
      try { staged = await service.configure(input(Number((await service.settings() as Row).version), { dailyTime: hhmm, projectIds: [projectId] }), 'daily-focus-' + randomUUID()); }
      catch (e) { if (attempt === 1) throw e; }
    }
    assert.ok(new Date(String(staged!.next_daily_at)).getTime() > now.getTime(), 'Daily scheduled ahead');
    const found = await waitFor('daily delivered', async () => {
      const r = await tenantRows(sql`select r.id report_id,r.latest_revision revision,v.body_run_id, br.status body_status, br.error_code body_error,
        d.state delivery_state,d.read_at
        from app.construction_reports r
        join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
        left join app.assistant_runs br on br.enterprise_id=v.enterprise_id and br.id=v.body_run_id
        left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision and d.binding_id=r.binding_id
        where r.enterprise_id=${eid} and r.binding_id=${Number(bindingId)} and r.kind='daily' and r.created_at>=${new Date(now.getTime() - 60_000)}`);
      const row = r[0];
      return row && String(row.body_status) === 'succeeded' && String(row.delivery_state) === 'delivered' ? row : undefined;
    }, 1200000, 6000);

    const version = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
    const token = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: version, source: 'wechat' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(customerId).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const entry = String((await api(token, '/entry-context', { body: { leadId } })).entryToken);
    assert.ok(entry, 'Entry token for the labelled lead');
    const listed = await api(token, `/followups/${bindingId}/reports?projectId=${projectId}&kind=daily`, { entry });
    const item = (listed.items as Row[] || []).find(r => String(r.reportId) === String(found!.report_id));
    assert.ok(item, 'Daily listed for the customer binding');
    const detail = await api(token, `/followups/${bindingId}/reports/${String(found!.report_id)}?revision=${String(found!.latest_revision)}`, { entry });
    assert.equal(detail.available, true, 'Daily detail available');
    assert.ok(Array.isArray(detail.body) && detail.body.length > 0, 'Daily body composed');
    assert.ok(detail.readToken, 'Read token issued');
    const facts = detail.facts as { projects?: Array<{ records?: Array<{ id: string }>; publishedRecordItems?: Array<{ id: string }> }> } | undefined;
    const progress = (facts?.projects || []).flatMap(p => (p.publishedRecordItems || p.records || []).map(r => r.id));
    await api(token, `/followups/${bindingId}/reports/${String(found!.report_id)}/acknowledge`, { entry, key: randomUUID(),
      body: { revision: Number(found!.latest_revision), readToken: String(detail.readToken) } });
    const reread = await api(token, `/followups/${bindingId}/reports/${String(found!.report_id)}?revision=${String(found!.latest_revision)}`, { entry });
    assert.ok(reread.readAt, 'Acknowledgement persisted');
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
    const history = await api(token, `/followups/${bindingId}/reports?month=${month}&kind=daily&projectId=${projectId}`, { entry });
    assert.ok((history.items as Row[] || []).some(r => String(r.reportId) === String(found!.report_id)), 'Daily appears in history');
    const destinations = await api(token, '/followups', { entry });
    assert.ok((destinations.items as Row[] || []).some(b => String(b.bindingId) === bindingId), 'Follow-up destination on reentry');
    const conversation = await api(token, `/followups/${bindingId}/conversation`, { entry });
    assert.ok(conversation.id, 'Follow-up conversation readable on reentry');
    report.service = { reportId: String(found!.report_id), revision: Number(found!.latest_revision), bodyRunId: String(found!.body_run_id),
      deliveryState: String(found!.delivery_state), bodyParts: (detail.body as Row[]).length, progressRecords: progress.length,
      readAt: reread.readAt, historyItems: (history.items as Row[]).length };

    await evaluate(`(f) => { const app = getApp();
      const saved = { token: app.globalData.token, bootstrap: app.globalData.bootstrap, userInfo: app.globalData.userInfo, hydrate: app.hydrateStoredSession };
      app.__qaDaily = saved; app.hydrateStoredSession = async () => {};
      app.globalData.token = f.token; app.globalData.userInfo = { _id: f.customerId, role: 'user' };
      app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.projects','customer.service','account'], context: { enterpriseId: f.enterpriseId } } };
      wx.setStorageSync('token', f.token); wx.removeStorageSync('assistant-active-conversation-v1'); }`,
      { token, customerId, enterpriseId: eid });
    installed = true;
    await mp.redirectTo('/packages/assistant/chat/chat?fresh=' + Date.now());
    await waitFor('chat ready', async () => {
      const now = await page(); return now.route === 'packages/assistant/chat/chat' && !now.loading ? now : undefined;
    }, 120000);
    await evaluate(`() => { const p = getCurrentPages().at(-1); p.openHistory(); return true; }`);
    await waitFor('follow-up list', async () => (await page()).followupBindings.includes(bindingId) || undefined, 60000);
    await evaluate(`(id) => { const p = getCurrentPages().at(-1); p.selectFollowup({ currentTarget: { dataset: { id } } }); return true; }`, bindingId);
    const card = await waitFor('daily card visible', async () => {
      const now = await page();
      return now.followupActive ? now.followupReports.find(r => r.reportId === String(found!.report_id)) : undefined;
    }, 120000);
    assert.equal(card.kind, 'daily');
    assert.ok(card.readAt, 'Client shows the delivered card as read');
    await mp.screenshot({ path: path.join(output, 'daily-card.png') });
    report.client = { reportId: card.reportId, readAt: card.readAt };
    report.checks.push({ name: 'daily delivered, opened, acknowledged, reentered', passed: true, data: report.service });
    report.passed = true;
  } catch (e) {
    report.passed = false; report.error = (e as Error).message; process.exitCode = 1;
    report.failures.push({ error: (e as Error).stack || (e as Error).message }); save();
  } finally {
    try {
      if (original) {
        const service = new ConstructionReportService({ enterpriseId: eid, adminId: ownerId });
        await service.configure({ expectedVersion: Number((await service.settings() as Row).version), enabled: true,
          dailyTime: original.dailyTime, weeklyTime: original.weeklyTime, projectIds: original.projectIds, stageKeys: original.stageKeys,
          stageEnabled: original.stageEnabled, weeklyDay: original.weeklyDay, audiences: original.audiences,
          inactivePolicy: original.inactivePolicy }, 'daily-focus-restore-' + randomUUID());
        const restored = reportPlanDto(await service.settings() as Row, eid);
        report.planRestored = { dailyTime: restored.dailyTime, projectIds: restored.projectIds };
        assert.equal(restored.dailyTime, original.dailyTime);
      }
    } catch (e) { report.planRestored = { error: (e as Error).message }; report.passed = false; }
    if (installed) try {
      await evaluate(`() => { const a = getApp(), s = a.__qaDaily; if (!s) return false;
        a.globalData.token = s.token; a.globalData.bootstrap = s.bootstrap; a.globalData.userInfo = s.userInfo; a.hydrateStoredSession = s.hydrate;
        delete a.__qaDaily; return true; }`);
      await mp.reLaunch('/pages/index/index');
    } catch (e) { report.cleanupError = (e as Error).message; }
    await mp.disconnect().catch(() => {});
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ passed: report.passed, error: report.error, checks: (report.checks as Row[]).length }));
    await closePostgresPool();
  }
}
main();
