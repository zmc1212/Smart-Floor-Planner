const assert = require('node:assert/strict');
const test = require('node:test');
const { ChatController } = require('../packages/assistant/lib/chat');
const { openQuestionLogin, previewQuestion, authorizeQuestionReturn, takeQuestion, dismissQuestionLogin } =
  require('../utils/xiaok-question-login');
const { renovationProjects, overviewCard } = require('../packages/construction/owner-home/renovation-overview');

test('question continuation requires the same source page, current customer token and unchanged draft', t => {
  const sourcePage = { route: 'pages/index/index' }, origin = {};
  const question = '老房的采光不好，要先考虑哪些改造？';
  let url;
  const state = { aiEntriesEnabled: true, token: 'authorized',
    bootstrap: { current: { mode: 'customer', capabilities: ['customer.service'], context: { mode: 'customer' } } } };
  global.getApp = () => ({ globalData: state });
  global.getCurrentPages = () => [sourcePage];
  global.wx = { navigateTo: options => { url = options.url; } };
  t.after(() => { delete global.wx; delete global.getApp; delete global.getCurrentPages; });
  const begin = () => {
    assert.equal(openQuestionLogin(origin, question, 3), true);
    assert.match(url, /^\/packages\/business\/login\/login\?questionResume=[a-z0-9-]+$/);
    return url.split('=').at(-1);
  };
  let id = begin();
  assert.equal(previewQuestion(id, {}), '');
  assert.equal(previewQuestion(id, sourcePage), question);
  assert.equal(takeQuestion(origin, state.token, 3), '');
  assert.equal(authorizeQuestionReturn(id, sourcePage, state), true);
  dismissQuestionLogin(id, true);
  assert.equal(takeQuestion({}, state.token, 3), '');
  assert.equal(takeQuestion(origin, state.token, 3), question);
  assert.equal(takeQuestion(origin, state.token, 3), '');
  id = begin();
  authorizeQuestionReturn(id, sourcePage, state);
  assert.equal(takeQuestion(origin, 'changed-session', 3), '');
  id = begin();
  authorizeQuestionReturn(id, sourcePage, state);
  assert.equal(takeQuestion(origin, state.token, 4), '');
  id = begin();
  assert.equal(authorizeQuestionReturn(id, sourcePage, { ...state, bootstrap: { current: { mode: 'staff' } } }), false);
  assert.equal(previewQuestion(id, sourcePage), '');
  id = begin();
  dismissQuestionLogin(id);
  assert.equal(previewQuestion(id, sourcePage), '');
});

test('returning from a cancelled guest login keeps the local question without any conversation request', async () => {
  const controller = new ChatController({ identity: () => '', emit() {}, client: {} });
  await controller.show({});
  controller.input('老房采光怎么改善？');
  controller.hide();
  await controller.show({});
  assert.equal(controller.state.needsLogin, true);
  assert.equal(controller.state.draft, '老房采光怎么改善？');
  assert.equal(controller.state.messages.length, 0);
});

test('an authorized entry clears the guest login gate in the existing chat instance', async () => {
  let token = '';
  const requests = [];
  const client = { pending: new Map(), async read(path) {
    requests.push(path);
    return { entryToken: 'authorized-entry', canSend: true };
  } };
  const controller = new ChatController({ identity: () => token, emit() {}, client });
  await controller.show({});
  controller.hide();
  token = 'new-session';
  await controller.show({});
  assert.equal(controller.state.needsLogin, false);
  assert.equal(controller.state.fatal, false);
  assert.equal(controller.state.canSend, true);
  assert.deepEqual(requests, ['/entry-context']);
});

test('renovation groups construction and service by the authorized lead and prefers real progress over a camera grant', () => {
  const leads = [
    { leadId: '4', communityName: '春和苑', serviceStage: 'measurer_assigned' },
    { leadId: '5', communityName: '青禾园', serviceStage: 'design_published' },
  ];
  const cards = renovationProjects(leads, [
    { id: '10', name: '仅监控', leadId: '5', progressAccess: false },
    { id: '9', name: '青禾园住宅', leadId: '5', progressAccess: true },
    { id: '8', name: '家里工地', leadId: '6', progressAccess: false },
  ]);
  assert.deepEqual(cards.map(card => [card.key, card.name, card.site?.id]),
    [['lead-5', '青禾园住宅', '9'], ['lead-4', '春和苑', undefined], ['site-8', '家里工地', '8']]);
  const cameraOnly = overviewCard({ project: { progressAccess: false }, site: cards[2].site });
  assert.equal(cameraOnly.step, -1);
  assert.equal(cameraOnly.action, 'site');
});

test('primary actions follow current service rights and the exact published scheme', () => {
  const ready = { serviceStage: 'measurer_assigned', nextActionKind: 'book', designer: { displayName: '林顾问' } };
  const booking = overviewCard({ service: ready });
  assert.deepEqual([booking.badge, booking.action, booking.rows[1].meta], ['待预约', 'book', '林顾问']);
  const confirmed = { ...ready, serviceStage: 'appointment_confirmed', nextActionKind: 'view_project',
    appointment: { id: '6', status: 'confirmed' }, appointmentSummary: '11月28日 16:00', canReschedule: false };
  assert.equal(overviewCard({ service: confirmed }).action, 'appointment');
  assert.equal(overviewCard({ service: confirmed }).rows.some(row => row.key === 'reschedule'), false);
  assert.equal(overviewCard({ service: { ...confirmed, canReschedule: true } }).rows[1].key, 'reschedule');
  const published = { ...confirmed, serviceStage: 'design_published', formalFloorPlan: { previewEndpoint: '/floor' },
    featuredScheme: { id: '61' }, publishedSchemes: [
      { id: '62', title: '第二轮', firstPublishedAt: '2026-11-26T01:00:00Z', images: [{ imageEndpoint: '/later' }] },
      { id: '61', title: '已定稿方案', firstPublishedAt: '2026-11-24T01:00:00Z', images: [
        { imageEndpoint: '/first' }, { imageEndpoint: '/cover', publishedAt: '2026-11-25T16:05:00Z' },
      ] },
    ] };
  const scheme = overviewCard({ service: published });
  assert.deepEqual(scheme.scheme, { id: '61', title: '已定稿方案', meta: '第 1 版 · 11月26日发布', endpoint: '/cover' });
  assert.equal(scheme.rows[0].key, 'floorplan');
});

test('reported coordination does not become an actionable owner confirmation', () => {
  const data = { project: { progressAccess: true, stageName: '水电施工' },
    report: { publishedAt: '2026-11-26T02:00:00Z', progress: ['线管已铺设'], pending: [{ text: '现场核对厨房插座' }] } };
  const progress = overviewCard(data);
  assert.deepEqual([progress.badge, progress.action, progress.digest], ['施工中', 'site', '线管已铺设']);
  assert.equal(progress.ordinaryConstruction, true);
  assert.deepEqual(progress.rows.map(row => row.key), ['report', 'schedule', 'family']);
  assert.deepEqual(progress.rows[0], { key: 'report', icon: 'file', label: '日报与周报', meta: '11月26日', summary: '线管已铺设' });
  const noDailyReport = overviewCard({ project: data.project });
  assert.deepEqual(noDailyReport.rows[0], { key: 'report', icon: 'file', label: '日报与周报', meta: '暂无日报', summary: '' });
  const live = overviewCard({ ...data, live: { canDecide: true, alias: '厨房施工直播' } });
  assert.equal(live.action, 'live');
  assert.equal(live.ordinaryConstruction, false);
  const decision = overviewCard({ ...data, decision: { id: '3', title: '厨房插座调整' } });
  assert.deepEqual([decision.badge, decision.action, decision.title], ['待我确认', 'decision', '厨房插座调整']);
  assert.deepEqual(decision.rows.map(row => row.key), ['schedule', 'family', 'site']);
});
