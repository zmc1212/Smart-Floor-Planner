const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../packages/assistant/lib/client');
const { RequirementsController, rowsFor } = require('../packages/assistant/lib/requirements');

test('optional empty room keys do not expand the summary; recorded and confirmed details remain visible', () => {
  const draftFields = Object.fromEntries(['housing', 'household', 'style', 'budget', 'timeline', 'room', 'space', 'usage', 'frequency', 'devices'].map(key => [key, { text: '' }]));
  assert.equal(rowsFor({ draftFields }).length, 5);
  draftFields.usage.text = '需要办公';
  const summary = { draftFields, confirmedFields: { devices: '双显示器' } };
  assert.deepEqual(rowsFor(summary).map(row => row.key), ['housing', 'household', 'style', 'budget', 'timeline', 'usage', 'devices']);
  assert.equal(rowsFor(summary).find(row => row.key === 'devices').text, '双显示器');
  assert.equal(rowsFor(summary, { room: '书房' }).find(row => row.key === 'room').text, '书房');
  assert.equal(draftFields.room.text, '');
});

function fixture() {
  const db = { latest: null, confirmed: null, writable: true, status: 'open' };
  const calls = []; let token = 'customer', intercept, seq = 0;
  const request = async (url, method, body, options) => {
    const call = { url, method, body, options }; calls.push(call);
    if (intercept) { const result = await intercept(call); if (result) return result; }
    let data;
    if (url.endsWith('/entry-context')) data = { canSend: db.writable, enterprise: { name: '测试企业' } };
    else if (url.endsWith('/requirements')) {
      if (method === 'GET') data = db;
      else if (body.action === 'draft') {
        db.latest = { id: String(++seq), version: 1, status: 'draft', draftFields: { housing: { text: '90平米旧房', sourceMessageId: '2' }, budget: { text: '预算20万', sourceMessageId: '2' } } }; data = db.latest;
      } else {
        db.latest = { ...db.latest, status: 'confirmed', version: 2, confirmedFields: body.fields, confirmedAt: '2026-10-15' };
        db.confirmed = db.latest; data = db.latest;
      }
    } else data = { id: '11', status: db.status, mode: 'ai' };
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  };
  const create = () => new RequirementsController({ emit() {}, identity: () => token, client: new AssistantClient(request) });
  return { db, calls, create, intercept: fn => { intercept = fn; }, identity: value => { token = value; } };
}

test('item-level metadata keeps the aggregate room values visible after page reentry and confirmation', async () => {
  const f = fixture();
  f.db.latest = { id: '7', version: 1, status: 'draft', draftFields: {
    housing: { text: '我家90平' }, budget: { text: '预算改成10万' },
    room: { text: '客厅换瓷砖；地暖不做', items: [
      { id: 'item-floor', text: '客厅换瓷砖', sourceMessageId: '4' },
      { id: 'item-heating', text: '地暖不做', sourceMessageId: '1' },
    ] },
  } };
  const first = f.create(); await first.show('11');
  assert.equal(first.fields().room, '客厅换瓷砖；地暖不做'); first.dispose();
  const reopened = f.create(); await reopened.show('11');
  assert.equal(reopened.fields().room, '客厅换瓷砖；地暖不做');
  await reopened.act('confirm');
  const call = f.calls.find(c => c.body.action === 'confirm');
  assert.equal(call.body.fields.room, '客厅换瓷砖；地暖不做');
  assert.ok(!JSON.stringify(call.body.fields).includes('item-heating'));
});

test('summary: draft, edit, confirm and fresh-page read preserve customer values', async () => {
  const f = fixture(), c = f.create(); await c.show('11');
  assert.equal(c.fields().housing, '90平米旧房');
  await c.edit('budget'); c.input('budget', '总预算25万元');
  await c.show('11'); assert.equal(c.fields().budget, '总预算25万元');
  assert.equal(await c.act('confirm'), true);
  c.dispose(); const reopened = f.create(); await reopened.show('11');
  assert.equal(reopened.state.confirmed, true); assert.equal(reopened.fields().budget, '总预算25万元');
  await reopened.edit('style'); assert.equal(reopened.fields().budget, '总预算25万元');
  reopened.input('style', '现代简约'); await reopened.act('confirm');
  const again = f.create(); await again.show('11'); assert.equal(again.fields().style, '现代简约');
  assert.equal(again.fields().budget, '总预算25万元');
});

test('unknown confirmation retries original body/key, and concurrent taps share a request', async () => {
  const f = fixture(), c = f.create(); await c.show('11'); c.input('budget', '25万');
  let fail = true;
  f.intercept(call => { if (call.body.action === 'confirm' && fail) { fail = false; throw { statusCode: 503 }; } });
  const first = c.act('confirm'); assert.equal(c.act('confirm'), first); await first;
  assert.equal(c.state.pending, 'confirm'); c.input('budget', '不能改成30万');
  await c.act('confirm');
  const confirms = f.calls.filter(call => call.body.action === 'confirm');
  assert.equal(confirms.length, 2);
  assert.deepEqual(confirms[0].options.headers, confirms[1].options.headers);
  assert.equal(confirms[1].body.fields.budget, '25万'); assert.equal(c.state.confirmed, true);
});

test('stale confirmation requires refresh from conversation; read-only cannot mutate', async () => {
  const f = fixture(), c = f.create(); await c.show('11');
  f.intercept(call => { if (call.body.action === 'confirm') throw { code: 'requirements_stale', statusCode: 409 }; });
  await c.act('confirm'); assert.equal(c.state.stale, true);
  const count = f.calls.length; await c.act('confirm'); assert.equal(f.calls.length, count);
  f.intercept(null); await c.act('draft'); assert.equal(c.state.stale, false); await c.act('confirm');
  f.db.status = 'archived'; await c.show('11'); const previous = f.calls.length;
  await c.edit('budget'); c.input('budget', '30万'); await c.act('draft');
  assert.equal(f.calls.length, previous); assert.equal(c.state.writable, false);
});

test('identity change and access denial clear private rows, late responses never publish', async () => {
  const f = fixture(), c = f.create(); await c.show('11');
  let release;
  f.intercept(call => call.body.action === 'confirm' ? new Promise(resolve => { release = resolve; }) : undefined);
  const pending = c.act('confirm'); await Promise.resolve(); f.identity('other');
  release({ success: true, data: { ...f.db.latest, status: 'confirmed', confirmedFields: c.fields() } });
  await pending; assert.equal(c.state.confirmed, false);
  f.intercept(() => { throw { code: 'assistant_resource_not_found', statusCode: 404 }; });
  await c.show('11'); assert.deepEqual(c.state.rows, []); assert.equal(c.state.fatal, true);
});

test('redacted summaries cannot recreate text; empty fields require input', async () => {
  const f = fixture(), c = f.create(); await c.show('11');
  for (const row of c.state.rows) c.input(row.key, '');
  assert.equal(await c.act('confirm'), false); assert.match(c.state.error, /至少填写/);
  f.db.latest = { ...f.db.latest, status: 'redacted', draftFields: {}, confirmedFields: null };
  const fresh = f.create(); await fresh.show('11'); assert.deepEqual(fresh.state.rows, []);
  const count = f.calls.length; await fresh.act('draft'); assert.equal(f.calls.length, count);
});

test('page registers native summary route and confirmation navigates only on success', async () => {
  const app = require('../app.json'); assert.ok(app.subPackages.find(p => p.root === 'packages/assistant').pages.includes('requirements/requirements'));
  let page, backs = 0;
  global.Page = config => { page = config; };
  global.wx = { hideKeyboard() {}, showToast() {}, navigateBack() { backs++; } };
  require('../packages/assistant/requirements/requirements');
  const instance = { ...page, alive: true, data: { confirmed: false }, controller: { act: async () => false } };
  await instance.confirm(); assert.equal(backs, 0);
  instance.controller.act = async () => true; await instance.confirm(); assert.equal(backs, 1);
  delete global.Page; delete global.wx;
});

test('review mode never generates a draft merely by opening the summary', async () => {
  const f = fixture(); f.db.reviewMode = true;
  const c = f.create(); await c.show('11'); await c.act('draft');
  assert.equal(f.calls.filter(call => call.method !== 'GET' && call.url.endsWith('/requirements')).length, 0);
  assert.equal(c.state.summary, null);
});

test('pending proposal survives reentry, displays the diff, and confirmation sends only the bound decision', async () => {
  const f = fixture(); f.db.reviewMode = true;
  f.db.proposal = { id: 'proposal-1', digest: 'digest-1', requiresRestoreConsent: true,
    diff: [{ field: 'budget', before: '10万', after: '12万' }],
    summary: { status: 'proposal', draftFields: { budget: { text: '12万' }, room: { text: '瓷砖；地暖不做' } } } };
  const first = f.create(); await first.show('11'); first.dispose();
  const c = f.create(); await c.show('11');
  assert.match(c.state.rows.find(row => row.key === 'budget').sourceText, /当前：10万\n拟改为：12万/);
  c.input('budget', '99万'); assert.equal(c.fields().budget, '12万');
  f.intercept(call => call.body.action === 'apply_proposal' ? { success: true, data: { id: '8', version: 1, status: 'draft', draftFields: f.db.proposal.summary.draftFields } } : undefined);
  assert.equal(await c.act('confirm', true), true);
  const call = f.calls.find(call => call.body.action === 'apply_proposal');
  assert.deepEqual(call.body, { action: 'apply_proposal', proposalId: 'proposal-1', digest: 'digest-1', consent: true, restoreConsent: true });
  assert.equal(c.state.confirmed, false); assert.equal(c.state.proposal, null);
});

test('historical restore modal cancellation does not invoke a write', async () => {
  let page, writes = 0;
  global.Page = config => { page = config; };
  global.wx = { hideKeyboard() {}, showModal({ success }) { success({ confirm: false }); } };
  const file = require.resolve('../packages/assistant/requirements/requirements'); delete require.cache[file]; require(file);
  await page.confirm.call({ alive: true, data: { proposal: { requiresRestoreConsent: true, diff: [{ before: '瓷砖', after: '木地板' }] } }, controller: { act() { writes++; } } });
  assert.equal(writes, 0);
  delete global.Page; delete global.wx;
});

test('formal confirmation after a repeated save binds the displayed conversation source without another draft', async () => {
  const f = fixture(); f.db.reviewMode = true; f.db.sourceSeq = '9';
  f.db.latest = { id: '8', version: 1, status: 'draft', sourceSeq: '4', draftFields: { budget: { text: '12万' } } };
  const c = f.create(); await c.show('11');
  await c.act('confirm');
  const call = f.calls.find(call => call.body.action === 'confirm');
  assert.equal(call.body.reviewedSourceSeq, '9');
  assert.equal(f.calls.some(call => call.body.action === 'draft'), false);
});

test('unknown committed proposal restores original operation after page recreation', async () => {
  const storage = new Map([['token', 'customer']]);
  global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) };
  try {
    const f = fixture(); f.db.reviewMode = true;
    f.db.proposal = { id: 'p1', digest: 'd1', diff: [], requiresRestoreConsent: true,
      summary: { status: 'proposal', draftFields: { budget: { text: '12万' } } } };
    let lost = true;
    f.intercept(call => {
      if (call.body.action !== 'apply_proposal') return;
      f.db.latest = { id: '9', version: 1, status: 'draft', draftFields: { budget: { text: '12万' } }, confirmedFields: null };
      f.db.proposal = null;
      if (lost) { lost = false; throw { statusCode: 503 }; }
      return { success: true, data: f.db.latest };
    });
    const first = f.create(); await first.show('11'); await first.act('confirm', true); first.dispose();
    const reopened = f.create(); await reopened.show('11');
    assert.equal(reopened.state.pending, 'confirm'); assert.match(reopened.state.error, /确认上次操作结果/);
    assert.equal(await reopened.act('confirm'), true); assert.equal(reopened.state.confirmed, false);
    const requests = f.calls.filter(c => c.body.action === 'apply_proposal');
    assert.equal(requests.length, 2); assert.deepEqual(requests[0].body, requests[1].body);
    assert.deepEqual(requests[0].options.headers, requests[1].options.headers);
    assert.equal(storage.get('assistant-pending-v1').entries.length, 0);
  } finally { delete global.wx; }
});
