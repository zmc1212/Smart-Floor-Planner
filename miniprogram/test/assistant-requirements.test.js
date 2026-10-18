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
