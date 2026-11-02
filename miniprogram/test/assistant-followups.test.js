const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../packages/assistant/lib/client');
const { FollowupController, FollowupRecordMedia, reportForView, dateLabel } = require('../packages/assistant/lib/followups');

function fixture() {
  let session = 'customer-a', intercept;
  const calls = [], emitted = [], context = { bindingId: '27', conversationId: '880', audience: 'customer', status: 'enabled', version: 2,
    title: '合成测试·我家装修', enterprise: { id: '1454', name: '微云' }, conversation: { id: '880', mode: 'ai', status: 'open' },
    projects: [{ id: '248', name: '合成测试·我家装修' }], stages: [{ key: 'water', name: '水电阶段' }] };
  const report = { reportId: '98', revision: 1, kind: 'daily', available: true, state: 'facts_ready', contentStatus: 'facts_only',
    periodStart: '2026-11-01T00:00:00+08:00', periodEnd: '2026-11-01T20:00:00+08:00', cutoffAt: '2026-11-01T20:00:00+08:00',
    generatedAt: '2026-11-01T20:01:00+08:00', sequence: '9', deliveryState: 'delivered', readAt: null, readToken: 'original-token',
    facts: { projects: [{ id: '248', name: '合成测试·我家装修', stageKey: 'water', records: [{ id: '12', version: 3, data: { completed: '书房线管有记录', pending: '' } }],
      publishedRecordItems: [{ recordId: '11', pending: '底盒位置仍需核对', coordination: '', carriedOver: true }] }] } };
  const client = new AssistantClient(async (url, method, body, options) => {
    const call = { path: url.replace('/miniprogram/assistant', ''), method, body: JSON.parse(JSON.stringify(body)), options }; calls.push(call);
    if (intercept) { const response = await intercept(call); if (response !== undefined) return { success: true, data: response }; }
    let data;
    if (method === 'GET' && call.path === '/followups') data = { items: [context] };
    else if (method === 'GET' && call.path === '/followups/27') data = context;
    else if (method === 'GET' && call.path === '/followups/27/reports') data = { items: [report], nextCursor: null };
    else if (method === 'GET' && call.path === '/followups/27/reports/98') data = report;
    else if (method === 'POST' && call.path.endsWith('/acknowledge')) { report.readAt = '2026-11-01T20:02:00+08:00'; data = { reportId: '98', revision: 1, read: true }; }
    else if (method === 'POST' && call.path.endsWith('/seen')) data = { bindingId: '27', throughSequence: body.throughSequence };
    else if (method === 'POST' && /\/(stop|resume|archive)$/.test(call.path)) {
      const action = call.path.split('/').pop(); context.version++; context.status = action === 'stop' ? 'stopped' : 'enabled';
      if (action === 'archive') context.conversation.status = 'archived';
      data = { bindingId: '27', conversationId: '880', version: context.version, status: context.status };
    } else throw Error('Unexpected request ' + method + ' ' + call.path);
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  });
  const controller = new FollowupController({ client, identity: () => session, emit: p => emitted.push(p), headers: async () => ({ 'X-Assistant-Entry': 'signed-entry' }), schedule: () => 0, unschedule() {} });
  return { client, controller, context, report, calls, emitted, intercept(fn) { intercept = fn; }, identity(value) { session = value; } };
}

test('approved staff daily card labels retain full detail identity, original facts and non-daily ranges', () => {
  const f = fixture(), now = Date.parse('2026-11-01T09:00:00+08:00');
  const worker = reportForView(f.report, { ...f.context, audience: 'worker' }, '', now);
  const designer = reportForView(f.report, { ...f.context, audience: 'designer' }, '', now);
  assert.equal(worker.cardLabel, '我的施工日报'); assert.equal(worker.cardTitle, '今天的施工跟进');
  assert.equal(designer.cardLabel, '我的项目日报'); assert.equal(designer.cardTitle, '今天需要你核对的事');
  assert.equal(worker.cardPeriodLabel, '11月1日 · 截至20:00');
  assert.equal(worker.title, '11月1日 · 施工日报'); assert.equal(worker.factsOnly, true);
  assert.deepEqual(worker.projects, reportForView(f.report, f.context).projects);
  assert.equal(reportForView(f.report, f.context, '', now).cardTitle, '今天我家进展');
  assert.equal(reportForView({ ...f.report, cutoffAt: '2026-11-02T01:00:00+08:00' }, { ...f.context, audience: 'worker' }).cardPeriodLabel, '');
  assert.equal(reportForView({ ...f.report, kind: 'weekly' }, { ...f.context, audience: 'designer' }).cardTitle, '');
  assert.equal(reportForView(f.report, { ...f.context, audience: 'worker' }, '', now + 86400000).cardTitle, '11月1日的施工跟进');
  assert.equal(reportForView({ reportId: '98', revision: 1, available: false }, { ...f.context, audience: 'worker' }).cardLabel, undefined);
});

test('composed text uses the approved sections while keeping original-record actions and exact report scope', () => {
  const f = fixture(), line = text => [{ key: text, text }];
  const report = { ...f.report, contentStatus: 'composed', bodyGeneratedAt: '2026-11-01T20:03:00+08:00', body: [{ projectId: '248',
    progress: line('模型归纳的获权进展'), pending: line('待本人核对'), standards: line('有效企业依据'), arrangements: line('已记录的安排') }] };
  const view = reportForView(report, f.context, '248');
  assert.equal(view.factsOnly, false); assert.equal(view.projects[0].standards[0].text, '有效企业依据');
  assert.deepEqual(view.projects[0].originalIds, ['12', '11']); assert.equal(view.generatedLabel, '11月1日 20:03');
  assert.equal(view.reportId, f.report.reportId); assert.equal(view.revision, 1); assert.equal(view.cutoffAt, f.report.cutoffAt);
  const withdrawn = reportForView({ ...report, body: [], contentStatus: 'facts_only', generationState: 'source_unavailable' }, f.context);
  assert.equal(withdrawn.projects[0].standards, undefined); assert.equal(withdrawn.projects[0].progress[0].text, '书房线管有记录');
});

test('pre-dispatch body retry retains its operation key through a lost response and refreshes the same detail', async () => {
  const f = fixture(); f.report.generationRetryable = true; f.report.generationState = 'failed';
  await f.controller.show({ autoOpen: true }); await f.controller.readReport('98', 1);
  const attempts = [];
  f.intercept(call => {
    if (call.method === 'POST' && call.path.endsWith('/retry')) {
      attempts.push(call);
      if (attempts.length === 1) throw Object.assign(Error('lost response'), { statusCode: 0 });
      f.report.generationState = 'queued'; f.report.generationRetryable = false;
      return { reportId: '98', revision: 1, runId: 'saved-run', status: 'queued' };
    }
  });
  await f.controller.retryBody(f.controller.state.followupDetail);
  assert.equal(f.controller.state.followupPending, true);
  await f.controller.recover();
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.ok(attempts[0].options.headers['Idempotency-Key']);
  assert.equal(attempts[0].options.headers['Idempotency-Key'], attempts[1].options.headers['Idempotency-Key']);
  assert.equal(f.controller.state.followupDetail.reportId, '98'); assert.equal(f.controller.state.followupDetail.generationState, 'queued');
  assert.equal(f.controller.state.followupDetail.generationRetryable, false);
  assert.ok(!f.calls.some(c => /\/messages$|\/send$/.test(c.path))); f.controller.hide();
});

test('owner daily card preserves progress separately from authoritative published confirmations and historical cutoff', () => {
  const f = fixture(), now = Date.parse('2026-11-01T09:00:00+08:00');
  const facts = { projects: [{ ...f.report.facts.projects[0],
    records: [{ id: '12', version: 3, data: { completed: '厨房线路走向已核对', pending: '内部草稿不能进入业主确认区' } },
      { id: '13', version: 1, data: { completed: '客厅线管已有记录' } }],
    publishedRecordItems: [{ recordId: '12', pending: '台面插座位置还没定', coordination: '位置确认前先不要施工', carriedOver: true }],
  }] };
  const view = reportForView({ ...f.report, facts }, f.context, '', now);
  assert.equal(view.ownerDaily, true); assert.equal(view.cardTitle, '今天我家进展');
  assert.equal(view.cardPeriodLabel, '11月1日 · 水电阶段 · 截至20:00');
  assert.deepEqual(view.projects[0].progress.map(l => l.text), ['厨房线路走向已核对', '客厅线管已有记录']);
  assert.deepEqual(view.projects[0].pending.map(l => l.text), ['台面插座位置还没定', '位置确认前先不要施工']);
  assert.equal(view.projects[0].pending[0].carriedOver, true); assert.equal(view.factsOnly, true);
  const empty = reportForView({ ...f.report, facts: { projects: [{ ...facts.projects[0], publishedRecordItems: [] }] } }, f.context, '', now);
  assert.deepEqual(empty.projects[0].pending, []); // Empty published projection cannot fall back to internal drafts.
  assert.equal(reportForView(f.report, f.context, '', now + 86400000).cardTitle, '11月1日我家进展');
  assert.equal(reportForView({ ...f.report, cutoffAt: '2026-11-02T01:00:00+08:00' }, f.context, '', now).cardPeriodLabel, '');
  assert.equal(reportForView({ ...f.report, kind: 'stage' }, f.context).ownerDaily, false);
  assert.equal(reportForView({ ...f.report, kind: 'weekly' }, f.context).cardTitle, '');
  assert.equal(reportForView({ ...f.report, available: false }, f.context).ownerDaily, undefined);
});

test('owner full daily detail labels the actual cutoff and historical day without altering other recipients', () => {
  const f = fixture(), now = Date.parse('2026-11-01T09:00:00+08:00');
  const report = { ...f.report, periodEnd: '2026-11-02T00:00:00+08:00', cutoffAt: '2026-11-01T18:30:00+08:00' };
  const view = reportForView(report, f.context, '', now);
  assert.equal(view.detailPeriodLabel, '统计00:00—18:30');
  assert.equal(view.detailProgressLabel, '今日进展');
  assert.equal(view.takeoverTitle, '11月1日施工日报');
  assert.equal(view.factsOnly, true);
  assert.equal(reportForView(report, f.context, '', now + 86400000).detailProgressLabel, '当日进展');
  assert.equal(reportForView({ ...report, cutoffAt: '2026-11-02T01:00:00+08:00' }, f.context).detailPeriodLabel, '统计11月1日 00:00—11月2日 01:00');
  assert.equal(reportForView(report, { ...f.context, audience: 'worker' }).detailPeriodLabel, '');
  assert.equal(reportForView({ ...report, kind: 'weekly' }, f.context).detailProgressLabel, '');
  assert.equal(reportForView({ ...report, available: false }, f.context).detailPeriodLabel, undefined);
});

test('background list refresh preserves a failed original read until the same record is retried', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.select('27'); await f.controller.readReport('98', 1);
  let fail = true;
  f.intercept(call => {
    if (call.path.endsWith('/projects/248/records/12')) {
      if (fail) throw { statusCode: 503, code: 'assistant_unavailable' };
      return { id: '12', data: { completed: '书房线管有记录' } };
    }
  });
  await f.controller.original('248', '12');
  const error = f.controller.state.followupError; assert.ok(error); assert.equal(f.controller.state.followupOriginal, null);
  await f.controller.loadList({ background: true }); await f.controller.sync();
  assert.equal(f.controller.state.followupError, error); assert.equal(f.controller.state.followupDetail.reportId, '98');
  fail = false; await f.controller.original('248', '12');
  assert.equal(f.controller.state.followupOriginal.id, '12'); assert.equal(f.controller.state.followupError, '');
});

test('boss weekly card uses the exact Shanghai period, preserves historical stages and never calls old facts this week', () => {
  const f = fixture(), context = { ...f.context, audience: 'boss' }, report = { ...f.report, kind: 'weekly',
    periodStart: '2026-10-19T00:00:00+08:00', periodEnd: '2026-10-26T00:00:00+08:00', cutoffAt: '2026-10-26T00:00:00+08:00' };
  const view = reportForView(report, context, '', Date.parse('2026-11-02T00:00:00+08:00'));
  assert.equal(view.bossWeekly, true); assert.equal(view.cardLabel, '企业周报');
  assert.equal(view.cardTitle, '本期工地进展'); assert.equal(view.cardPeriodLabel, '10月19日—10月25日');
  assert.equal(view.cutoffLabel, '10月26日 00:00'); assert.equal(view.projects[0].stageName, '水电阶段');
  assert.equal(view.factsOnly, true); assert.equal(view.reportId, report.reportId);
  assert.equal(reportForView(report, f.context).bossWeekly, false);
  assert.equal(reportForView({ ...report, kind: 'daily' }, context).bossWeekly, false);
  const revoked = reportForView({ ...report, available: false }, context);
  assert.equal(revoked.bossWeekly, undefined); assert.equal(revoked.projects, undefined);
  assert.equal(reportForView({ ...report, periodStart: '2026-12-28T00:00:00+08:00', periodEnd: '2027-01-04T00:00:00+08:00' }, context).cardPeriodLabel, '12月28日—1月3日');
});

test('weekly outlook distinguishes a complete empty projection from missing or truncated arrangements', () => {
  const f = fixture(), context = { ...f.context, audience: 'boss' }, report = { ...f.report, kind: 'weekly' };
  assert.equal(reportForView(report, context).arrangementsComplete, false);
  const facts = { ...report.facts, arrangementsStatus: 'aggregated' };
  assert.equal(reportForView({ ...report, facts }, context).arrangementsComplete, true);
  assert.equal(reportForView({ ...report, facts }, context).hasArrangements, false);
  assert.equal(reportForView({ ...report, facts: { ...facts, projectsTruncated: true } }, context).arrangementsComplete, false);
  assert.equal(reportForView({ ...report, facts: { ...facts, projects: [{ ...facts.projects[0], arrangementsTruncated: true }] } }, context).arrangementsComplete, false);
  const second = { id: '249', name: '另一工地', arrangements: [{ id: 'plan-2', title: '现场复核', difference: '已确认由设计师现场核对，时间未定' }] };
  const populated = reportForView({ ...report, facts: { ...facts, projects: [...facts.projects, second] } }, context);
  assert.equal(populated.hasArrangements, true); assert.equal(populated.arrangementsComplete, true);
  assert.equal(populated.projects[1].arrangements[0].text, '现场复核\n已确认由设计师现场核对，时间未定');
  assert.equal(reportForView({ ...report, facts: { ...facts, projects: [...facts.projects, second] } }, context, '248').hasArrangements, false);
});

test('listing and selecting never acknowledge reports or change ordinary draft/destination', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.select('27');
  assert.ok(f.calls.every(c => c.method === 'GET'));
  assert.ok(f.emitted.every(p => !('draft' in p) && !('conversation' in p) && !('messages' in p)));
  assert.equal(f.controller.state.followupContext.conversationId, '880');
  assert.equal(f.controller.state.followupReports[0].projects[0].pending[0].carriedOver, true);
  f.controller.hide();
});
test('real visibility and rendered detail acknowledgements have different receipts', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.select('27');
  await f.controller.visibleCard('98');
  assert.deepEqual(f.calls.find(c => c.path.endsWith('/seen')).body, { throughSequence: '9', conversationId: '880' });
  assert.equal(f.report.readAt, null);
  await f.controller.readReport('98', 1); assert.equal(f.report.readAt, null);
  await f.controller.renderedReport(); assert.ok(f.report.readAt);
  assert.equal(f.controller.state.followupDetail.readAt, true);
  f.controller.hide();
});
test('unknown read keeps original key and body even when the source token later changes', async () => {
  const f = fixture(); let first = true;
  f.intercept(c => { if (c.path.endsWith('/acknowledge') && first) { first = false; throw { statusCode: 503 }; } });
  await f.controller.show(); await f.controller.select('27'); await f.controller.readReport('98', 1); await f.controller.renderedReport();
  assert.equal(f.controller.state.followupPending, true);
  f.report.readToken = 'later-token'; await f.controller.recover();
  const writes = f.calls.filter(c => c.path.endsWith('/acknowledge'));
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.equal(writes[1].options.headers['X-Assistant-Entry'], 'signed-entry'); f.controller.hide();
});
test('invalid successful receipt remains unknown and is never displayed as read', async () => {
  const f = fixture(); f.intercept(c => c.path.endsWith('/acknowledge') ? { reportId: 'OTHER', revision: 1, read: true } : undefined);
  await f.controller.show(); await f.controller.select('27'); await f.controller.readReport('98', 1); await f.controller.renderedReport();
  assert.equal(f.controller.state.followupPending, true); assert.equal(f.controller.state.followupDetail.readAt, null);
  assert.ok(f.client.pending.size); f.controller.hide();
});
test('lost lifecycle receipt is recovered by same key without executing another action', async () => {
  const f = fixture(); let first = true;
  f.intercept(c => { if (c.path.endsWith('/stop') && first) { first = false; throw { statusCode: 503 }; } });
  await f.controller.show(); await f.controller.select('27'); await f.controller.change('stop');
  assert.equal(f.controller.state.followupPending, true); await f.controller.change('resume');
  assert.equal(f.calls.filter(c => c.path.endsWith('/resume')).length, 0);
  await f.controller.recover(); assert.equal(f.controller.state.followupContext.status, 'stopped');
  const writes = f.calls.filter(c => c.path.endsWith('/stop')); assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.ok(!f.calls.some(c => c.path.startsWith('/conversations/'))); f.controller.hide();
});
test('ordinary background list refresh never selects a destination', async () => {
  const f = fixture(); await f.controller.show(); f.context.unreadMessages = 2; await f.controller.loadList();
  assert.equal(f.controller.state.followupActive, false); assert.equal(f.controller.selected, undefined);
  assert.equal(f.controller.state.followupBindings[0].unreadMessages, 2); f.controller.hide();
});
test('revocation clears report original and private project labels on foreground reentry', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.select('27'); await f.controller.readReport('98', 1);
  f.controller.hide(); assert.equal(f.controller.state.followupDetail, null); assert.deepEqual(f.controller.state.followupReports, []);
  f.identity('other-identity'); f.intercept(() => { throw { statusCode: 403, code: 'assistant_capability_forbidden' }; }); await f.controller.show();
  assert.equal(f.controller.state.followupContext, null); assert.deepEqual(f.controller.state.followupBindings, []);
  assert.ok(!JSON.stringify(f.controller.state).includes('合成测试·我家装修')); f.controller.hide();
});
test('live source withdrawal replaces content instead of returning cached names or text', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.select('27'); await f.controller.readReport('98', 1);
  f.intercept(c => c.path === '/followups/27/reports/98' ? { reportId: '98', revision: 1, available: false, facts: null } : undefined);
  await f.controller.sync(); assert.equal(f.controller.state.followupDetail.available, false);
  assert.ok(!JSON.stringify(f.controller.state.followupDetail).includes('底盒位置')); f.controller.hide();
});
test('unavailable projections retain no private project title or field', () => {
  const result = reportForView({ available: false, reportId: '98', revision: 1, facts: { projects: [{ name: 'PRIVATE' }] } });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('project drill-down keeps the second project through refresh and full-report viewing resets the scope', async () => {
  const f = fixture(); f.context.audience = 'designer';
  f.report.facts.projects.push({ id: '249', name: '合成测试·另一工地', stageKey: 'water',
    records: [{ id: '13', version: 1, data: { completed: '镜前灯电源位置尚待核对' } }] });
  await f.controller.show(); await f.controller.select('27'); await f.controller.readReport('98', 1, '27', '249');
  assert.deepEqual(f.controller.state.followupDetail.projects.map(p => p.id), ['249']);
  assert.deepEqual(f.controller.state.followupDetail.facts.projects.map(p => p.id), ['249']);
  await f.controller.sync(); assert.equal(f.controller.state.followupDetail.selectedProjectId, '249');
  assert.deepEqual(f.controller.state.followupDetail.projects.map(p => p.id), ['249']);
  assert.equal(f.controller.state.followupDetail.bindingId, '27');
  await f.controller.renderedReport(); assert.ok(f.report.readAt);
  await f.controller.readReport('98', 1); assert.equal(f.controller.state.followupDetail.projects.length, 2); f.controller.hide();
});
test('a missing or revoked selected project never falls back to another authorized project on refresh', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.select('27');
  await f.controller.readReport('98', 1, '27', 'OTHER');
  assert.equal(f.controller.state.followupDetail.available, false);
  assert.ok(!JSON.stringify(f.controller.state.followupDetail).includes('底盒位置'));
  await f.controller.sync(); assert.equal(f.controller.state.followupDetail.available, false);
  assert.equal(f.controller.state.followupDetail.selectedProjectId, 'OTHER'); f.controller.hide();
});
test('staff report shows original pending notes without formal issues, while formal tracking and customer publication remain authoritative', () => {
  const project = { id: '249', name: '合成工地', records: [{ id: '13', version: 1,
    data: { completed: '卫生间线路走向已有记录', pending: '镜前灯电源位置待核对', coordination: '位置确认前不要施工' } }], issues: [] };
  const report = { available: true, state: 'facts_ready', facts: { projects: [project] } };
  assert.deepEqual(reportForView(report).projects[0].pending.map(p => p.text), ['镜前灯电源位置待核对', '位置确认前不要施工']);
  const tracked = { ...report, facts: { projects: [{ ...project, issues: [{ id: 'issue-1', recordId: '13', text: '原事项的当前记录' }] }] } };
  assert.deepEqual(reportForView(tracked).projects[0].pending.map(p => p.text), ['原事项的当前记录']);
  const customer = { ...report, facts: { projects: [{ ...project, publishedRecordItems: [] }] } };
  assert.deepEqual(reportForView(customer).projects[0].pending, []);
});
test('unknown generation time stays unknown instead of displaying a fabricated epoch date', () => {
  assert.equal(dateLabel(null), ''); assert.equal(dateLabel(undefined), ''); assert.equal(dateLabel(''), '');
});
test('followup originals reuse authenticated media behavior with exact report/project/version locator', async () => {
  const urls = [];
  const media = new FollowupRecordMedia({ identity: () => 'a', emit() {}, headers: async () => ({ 'X-Assistant-Entry': 'entry' }),
    download: async (url, options) => { urls.push({ url, options }); return { tempFilePath: 'tmp-original' }; } });
  await media.loadOriginal({ bindingId: '27' }, { reportId: '98', revision: 2 }, { id: '12', version: 3, projectId: '248', media: [{ id: '44' }] });
  assert.equal(urls[0].url, '/miniprogram/assistant/followups/27/reports/98/projects/248/records/12/media/44?revision=2');
  assert.equal(urls[0].options.headers['X-Assistant-Entry'], 'entry'); media.clear();
});
