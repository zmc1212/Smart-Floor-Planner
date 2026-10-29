const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../packages/assistant/lib/client');
const { FloorplanContextController } = require('../packages/assistant/lib/floorplan-context');
const plan = { id: '12', leadId: '10', name: '合成旧房', layoutHash: 'a'.repeat(64), rooms: [] };
function fixture(intercept) {
  let identity = 'owner-a';
  const calls = [], view = {};
  let selected = null, version = 0;
  const client = new AssistantClient(async (url, method, body, options) => {
    const call = { url, method, body, options }; calls.push(call);
    const handled = intercept && await intercept(call);
    if (handled) return handled;
    if (method === 'POST') { selected = body.selection ? { ...body.selection, name: plan.name } : null; version++; }
    return { success: true, data: { version, selected, items: [plan] } };
  });
  const controller = new FloorplanContextController({ client, identity: () => identity, emit: patch => Object.assign(view, patch) });
  return { controller, calls, view, identity: value => { identity = value; } };
}
test('browsing remains read only; explicit selection and clearing are scoped durable service operations', async () => {
  const f = fixture(call => call.method === 'GET' && call.body.leadId ? { success: true, data: { ...plan, floorPlanId: plan.id, text: '正式户型只读记录' } } : null);
  await f.controller.show('8');
  await f.controller.detail(plan);
  assert.equal(f.view.selectedFloorplan, null);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(await f.controller.select(plan), true);
  assert.equal(f.view.selectedFloorplan.floorPlanId, '12');
  assert.deepEqual(f.calls.at(-1).body, { expectedVersion: 0, selection: { leadId: '10', floorPlanId: '12', layoutHash: plan.layoutHash } });
  await f.controller.show('8'); assert.equal(f.view.selectedFloorplan.floorPlanId, '12');
  await f.controller.select(null); assert.equal(f.view.selectedFloorplan, null);
});
test('an unknown selection reuses its original operation body and key after reentry', async () => {
  let key, attempts = 0;
  const f = fixture(call => {
    if (call.method !== 'POST') return;
    attempts++;
    if (attempts === 1) { key = call.options.headers['Idempotency-Key']; throw { statusCode: 503 }; }
    assert.equal(call.options.headers['Idempotency-Key'], key);
    assert.equal(call.body.selection.floorPlanId, '12');
  });
  await f.controller.show('8'); assert.equal(await f.controller.select(plan), false); assert.equal(f.view.contextPending, true);
  assert.equal(await f.controller.show('8'), false);
  assert.equal(await f.controller.retry(), true); assert.equal(f.view.contextPending, false); assert.equal(f.view.selectedFloorplan.floorPlanId, '12');
});
test('a late response from a prior conversation or identity cannot restore its private archive', async () => {
  let release;
  const f = fixture(call => call.url.includes('/8/') ? new Promise(resolve => { release = resolve; }) : null);
  const old = f.controller.show('8');
  await f.controller.show('9');
  release({ success: true, data: { version: 1, selected: { ...plan, floorPlanId: plan.id }, items: [plan] } });
  assert.equal(await old, false); assert.equal(f.view.selectedFloorplan, null);
  f.identity('owner-b'); f.controller.clear(); assert.deepEqual(f.view.contextItems, []);
});
test('revoked versions clear selection without fabricating a usable archive and a new chat starts unbound', async () => {
  const f = fixture(call => call.url.includes('/9/') ? { success: true, data: { version: 3, selected: null, items: [], invalidated: true } } : null);
  await f.controller.show('8'); await f.controller.select(plan); await f.controller.show('9');
  assert.equal(f.view.selectedFloorplan, null); assert.match(f.view.contextError, /已切回不结合/);
  await f.controller.show(''); assert.equal(f.view.contextVersion, 0); assert.equal(f.view.selectedFloorplan, null);
});
