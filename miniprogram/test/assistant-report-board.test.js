const test = require('node:test');
const assert = require('node:assert/strict');
const { boardView, initialBoard, reportBoardMethods } = require('../packages/assistant/chat/report-board');
const { PlanChatController } = require('../packages/assistant/lib/plans');
const { FollowupController } = require('../utils/assistant-followups');

const project = { id: '10', name: '验收工地', stageKey: 'utilities', stageEvents: [],
  records: [{ id: '30', version: 2, room: '厨房', data: { completed: '客厅线管已铺设' } }],
  publishedRecordItems: [{ recordId: '30', room: '厨房', pending: '', coordination: '等设计图更新' }] };
const context = audience => ({ audience, bindingId: '12', title: '验收工地', enterprise: { name: '合成企业' },
  stages: [{ key: 'utilities', name: '水电阶段' }], projects: [project], selectedProject: project });
const report = (kind = 'daily') => ({ reportId: kind === 'weekly' ? '22' : '21', revision: 2,
  kind, state: 'facts_ready', available: true, deliveryState: 'delivered', readToken: 'authoritative-receipt',
  periodStart: '2026-11-14T16:00:00Z', periodEnd: '2026-11-15T16:00:00Z', cutoffAt: '2026-11-15T10:30:00Z',
  facts: { projects: [project] } });

test('owner confirmation is projected from authorized decisions and coordination remains a site note', () => {
  const view = boardView(report(), { role: 'customer',
    decisions: [{ id: '51', canDecide: true }, { id: '52', canDecide: false }],
    photos: [{ projectId: '10', recordId: '30', version: 2, mediaId: '44' }],
  }, context('customer'), 'daily', '10');
  assert.equal(view.period, '11月15日 · 截至18:30');
  assert.deepEqual(view.decisions.map(item => item.id), ['51']);
  assert.deepEqual(view.decided.map(item => item.id), ['52']);
  assert.deepEqual(view.projects[0].notes, ['等设计图更新']);
  assert.equal(view.photos[0].key, '30_2_44');
  assert.equal(view.detail.readToken, 'authoritative-receipt');
});

test('staff cards resolve their exact work entry and can distinguish resubmitted records from outstanding ones', () => {
  const designer = boardView(report(), { role: 'designer', review: [
    { projectId: '10', issueId: '81', replied: true }, { projectId: '10', issueId: '82', replied: false },
  ] }, context('designer'), 'daily', '10');
  assert.equal(designer.review[0].path, '/packages/construction/chat/chat?projectId=10&issueId=82&mode=review');
  assert.equal(designer.replied.length, 1);
  const worker = boardView(report(), { role: 'worker', captureProjects: ['10'], next: [], records: [
    { projectId: '10', recordId: '30', status: 'returned', canResubmit: true },
    { projectId: '10', recordId: '31', status: 'returned', resubmittedRecordId: '32' },
  ] }, context('worker'), 'daily', '10');
  assert.equal(worker.returned[0].path, '/packages/construction/inspection-record/inspection-record?projectId=10&recordId=30');
  assert.equal(worker.receipts[0].label, '已补交');
  assert.match(worker.receipts[0].path, /recordId=32$/);
  assert.equal(worker.captureProject, '10');
});

test('management counts reflect the authorized scope and incomplete history stays qualified', () => {
  const view = boardView(report('weekly'), { role: 'boss', closed: 3, closedComplete: false, items: [{
    status: 'active', projectId: '10', name: '验收工地', late: { nodeKey: 'bath-water' },
    coordinationCount: 2, coordination: [{ issueId: '81', title: '方案等答复' }], unverified: false,
  }] }, context('boss'), 'weekly', '');
  assert.deepEqual(view.stats.map(stat => stat.value), ['1', '3', '≥3']);
  assert.match(view.actions[0].path, /project=10&scheduleNode=bath-water$/);
  assert.match(view.actions[1].path, /projectId=10&issueId=81&mode=review$/);
});

test('period refresh reads the same scoped project and ignores a response from the previous period', async () => {
  let resolveDaily;
  const daily = new Promise(resolve => { resolveDaily = resolve; });
  const calls = [];
  const client = { pending: new Map(), read: async (path, query) => {
    calls.push({ path, query });
    if (path.endsWith('/workbench')) return { report: report('weekly'), workbench: { role: 'customer', decisions: [], photos: [] } };
    if (path.endsWith('/reports')) return query.kind === 'daily' ? daily : { items: [report('weekly')] };
    return context('customer');
  } };
  const followups = new FollowupController({ client, emit() {}, identity: () => 'owner' });
  await followups.show({ board: true, bindingId: '12', projectId: '10' });
  const acks = [];
  followups.renderedReport = detail => acks.push(detail.reportId);
  const page = { ...reportBoardMethods, _alive: true, _shown: true, _boardScope: { projectId: '10' }, followups,
    data: { ...initialBoard(), reportBoard: true }, setData(patch, done) { Object.assign(this.data, patch); done?.(); } };
  const pending = page.loadReportBoard('daily');
  await page.loadReportBoard('weekly');
  resolveDaily({ items: [report()] });
  await pending;
  assert.equal(page.data.reportBoardKind, 'weekly');
  assert.equal(page.data.reportBoardView.detail.reportId, '22');
  assert.deepEqual(acks, ['22']);
  assert.ok(calls.every(call => call.query.projectId === '10'));
  page.hideReportBoard();
  assert.equal(page.data.reportBoardView, null);
});

test('opening the original plan from a report preserves the existing explicit preview and approval workflow', async () => {
  const calls = [];
  const ownerPlan = { id: '41', issueId: '81', mediaId: '44', revision: 1, number: 3, costDeltaCents: 0,
    scheduleDeltaDays: 0, status: 'pending_customer', title: '核对厨房点位', difference: '转移至本次确认的位置' };
  const client = { pending: new Map(), async read(path) { calls.push(['GET', path]); return ownerPlan; },
    async mutate(_slot, path) { calls.push(['POST', path]); return {
      id: '41', revision: 2, status: 'pending_customer', material: { ...ownerPlan, revision: 2 },
    }; } };
  const controller = new PlanChatController({ client, emit() {}, identity: () => 'owner', media: { clear() {}, load: async () => {} } });
  assert.equal(await controller.open('25', '41'), true);
  assert.equal(await controller.decide('41', 'approve'), false);
  assert.equal(await controller.decide('41', 'preview'), true);
  assert.deepEqual(calls, [
    ['GET', '/conversations/25/plans/41'], ['POST', '/conversations/25/plans/41/preview'],
  ]);
});
