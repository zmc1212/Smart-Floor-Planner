const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../utils/assistant-client');
const { FollowupController } = require('../utils/assistant-followups');
function fixture() {
  let session = 'history-a', intercept;
  const calls = [], context = { bindingId: '50', conversationId: '910', audience: 'designer', title: '我的项目跟进',
    projects: [{ id: '248', name: '合成测试甲' }, { id: '249', name: '合成测试乙' }], stages: [], conversation: { mode: 'ai' } };
  const report = { available: true, reportId: '900', revision: 1, kind: 'weekly', state: 'facts_ready', contentStatus: 'facts_only',
    periodStart: '2026-10-26T00:00:00+08:00', periodEnd: '2026-11-02T00:00:00+08:00', readToken: 'real-token', readAt: null, deliveryState: 'delivered',
    facts: { projects: [{ id: '248', records: [] }] } };
  const client = new AssistantClient(async (url, method, body) => {
    const c = { path: url.replace('/miniprogram/assistant', ''), method, body }; calls.push(c);
    let data = intercept ? await intercept(c) : undefined;
    if (data === undefined) {
      if (c.path === '/followups') data = { items: [context] };
      else if (c.path === '/followups/50') data = context;
      else if (c.path === '/followups/50/reports') data = { items: [report], nextCursor: null };
      else if (c.path === '/followups/50/reports/900') data = report;
      else if (c.path.endsWith('/acknowledge')) { report.readAt = true; data = { reportId: '900', revision: 1, read: true }; }
      else throw Error(c.path);
    }
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  });
  const controller = new FollowupController({ client, identity: () => session, emit() {}, schedule: () => 0, unschedule() {} });
  return { controller, calls, context, report, intercept(fn) { intercept = fn; }, identity(s) { session = s; } };
}
async function open(f) { await f.controller.show(); await f.controller.select('50'); await f.controller.openHistory(); await f.controller.filterHistory('month', '2026-10'); }
test('history scopes every cursor request, shows the complete week and does not acknowledge a list', async () => {
  const f = fixture(); await open(f); await f.controller.filterHistory('projectId', '248');
  f.intercept(c => c.path.endsWith('/reports') ? { items: [f.report], nextCursor: c.body.beforeId ? null : '900' } : undefined);
  await f.controller.filterHistory('kind', 'weekly'); await f.controller.loadHistory({ more: true });
  assert.deepEqual(f.calls.at(-1).body, { projectId: '248', month: '2026-10', kind: 'weekly', beforeId: '900' });
  assert.equal(f.controller.state.followupHistoryItems[0].title, '10月26日—11月1日 · 施工周报');
  assert.ok(f.calls.every(c => c.method === 'GET')); assert.equal(f.report.readAt, null); f.controller.hide();
});
test('read failure retains same filters and valid rows; retry does not widen scope or write', async () => {
  const f = fixture(); await open(f); await f.controller.filterHistory('projectId', '248'); const previous = f.controller.state.followupHistoryItems;
  f.intercept(c => { if (c.path.endsWith('/reports')) throw { statusCode: 503 }; }); await f.controller.loadHistory();
  assert.equal(f.controller.state.followupHistoryItems, previous); assert.ok(f.controller.state.followupHistoryError);
  f.intercept(null); await f.controller.loadHistory(); assert.equal(f.controller.state.followupHistoryError, '');
  assert.deepEqual(f.calls.at(-1).body, { projectId: '248', month: '2026-10' }); assert.ok(f.calls.every(c => c.method === 'GET')); f.controller.hide();
});
test('a slow prior filter response cannot overwrite a newer filter or its loading state', async () => {
  const f = fixture(); await open(f); let resolve, started;
  const ready = new Promise(r => { started = r; });
  f.intercept(c => c.path.endsWith('/reports') && c.body.kind === 'daily' ? new Promise(r => { resolve = r; started(); }) : undefined);
  const old = f.controller.filterHistory('kind', 'daily'); await ready;
  await f.controller.filterHistory('kind', 'weekly'); resolve({ items: [{ ...f.report, reportId: 'OLD' }], nextCursor: 'OLD' }); await old;
  assert.equal(f.controller.state.followupHistoryItems[0].reportId, '900'); assert.equal(f.controller.state.followupHistoryFilters.kind, 'weekly');
  assert.equal(f.controller.state.followupHistoryLoading, false); f.controller.hide();
});
test('detail read is acknowledged only after rendering and remains read after returning/reentry', async () => {
  const f = fixture(); await open(f); await f.controller.readReport('900', 1); assert.equal(f.report.readAt, null);
  await f.controller.renderedReport(); f.controller.closeReport(); assert.equal(f.controller.state.followupHistoryOpen, true);
  assert.equal(f.controller.state.followupHistoryItems[0].readAt, true);
  f.controller.hide(); await f.controller.show({ autoOpen: true });
  assert.equal(f.controller.state.followupHistoryOpen, true); assert.equal(f.controller.state.followupHistoryFilters.month, '2026-10');
  assert.equal(f.controller.state.followupHistoryItems[0].readAt, true); f.controller.hide();
});
test('removed project clears old summaries and names without falling through to all projects', async () => {
  const f = fixture(); await open(f); await f.controller.filterHistory('projectId', '248'); f.context.projects = [{ id: '249', name: '合成测试乙' }];
  const before = f.calls.length; await f.controller.loadHistory();
  assert.deepEqual(f.controller.state.followupHistoryItems, []); assert.equal(f.controller.state.followupHistoryFilters.projectId, '248');
  assert.ok(!JSON.stringify(f.controller.state).includes('合成测试甲')); assert.equal(f.calls.slice(before).filter(c => c.path.endsWith('/reports')).length, 0);
  await f.controller.filterHistory('projectId', '249'); assert.equal(f.controller.state.followupHistoryItems.length, 1); f.controller.hide();
});
test('identity changes discard history filters, labels, results and reentry', async () => {
  const f = fixture(); await open(f); await f.controller.filterHistory('projectId', '248'); f.controller.hide(); f.identity('other');
  await f.controller.show(); assert.equal(f.controller.state.followupHistoryOpen, false); assert.equal(f.controller.state.followupHistoryFilters, null);
  assert.deepEqual(f.controller.state.followupHistoryItems, []); f.controller.hide();
});
test('project options paginate and revalidate a selected project beyond the first page', async () => {
  const f = fixture(); f.context.projects = [{ id: '1', name: '当前第一页' }]; f.context.projectsNextCursor = '1';
  f.intercept(c => c.path === '/followups/50' && c.body.afterProjectId ? { ...f.context, projects: [{ id: '248', name: '后页工地' }], projectsNextCursor: null }
    : c.path === '/followups/50' && c.body.projectId ? { ...f.context, selectedProject: { id: '248', name: '后页工地' } } : undefined);
  await open(f); await f.controller.moreHistoryProjects(); assert.ok(f.controller.state.followupHistoryProjects.some(p => p.id === '248'));
  await f.controller.filterHistory('projectId', '248'); assert.equal(f.controller.state.followupHistoryProjectLabel, '后页工地');
  assert.deepEqual(f.calls.at(-1).body, { projectId: '248', month: '2026-10' }); assert.ok(f.calls.every(c => c.method === 'GET')); f.controller.hide();
});
