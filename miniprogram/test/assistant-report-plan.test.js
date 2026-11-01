const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../utils/assistant-client');
const { FollowupController } = require('../utils/assistant-followups');
function fixture() {
  let session = 'one', intercept;
  const calls = [], plan = { enterpriseId: '1454', version: 3, timezone: 'Asia/Shanghai', enabled: false, stageEnabled: true,
    dailyTime: '20:00', weeklyTime: '08:00', weeklyDay: 1, projectIds: ['248'], stageKeys: [], audiences: ['customer','worker','designer','boss'], inactivePolicy: 'pause_inactive' };
  const client = new AssistantClient(async (url, method, body, options) => {
    const route = url.replace('/miniprogram/assistant',''); calls.push({ route, method, body, options });
    if (intercept) { const result = await intercept(method, body); if (result) return { success: true, data: result }; }
    if (route === '/followups') return { success: true, data: { items: [] } };
    if (method === 'POST') { const { expectedVersion, ...values } = body; Object.assign(plan, values, { version: expectedVersion + 1 }); return { success: true, data: { ...plan } }; }
    return { success: true, data: { settings: { ...plan }, enterprise: { id: '1454', name: '微云' }, projects: [{ id: '248', name: '测试工地' }], selectedProjects: [], nextCursor: null } };
  });
  const controller = new FollowupController({ client, emit() {}, identity: () => session, schedule: () => 0, unschedule() {} });
  return { controller, client, calls, plan, intercept: f => { intercept = f; }, session: v => { session = v; } };
}
test('lost enterprise-plan receipt reuses the persisted key and body after reentry', async () => {
  const f = fixture(); let lost = true;
  f.intercept((method, body) => { if (method === 'POST' && lost) { lost = false; Object.assign(f.plan, body, { version: body.expectedVersion + 1 }); throw { statusCode: 503 }; } });
  await f.controller.show(); await f.controller.openPlan(); f.controller.editPlan('weeklyDay', 3); await f.controller.savePlan();
  assert.equal(f.controller.state.followupPending, true); f.controller.hide(); await f.controller.show(); await f.controller.recover();
  assert.equal(f.controller.state.followupPlanDirty, false); assert.equal(f.controller.state.followupPlan.weeklyDay, 3);
  const writes = f.calls.filter(c => c.method === 'POST'); assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, writes[1].body); assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']); f.controller.hide();
});
test('conflict survives background and polling until explicit review, preserving unsaved choices', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.openPlan(); f.controller.editPlan('dailyTime','19:30'); f.plan.version++;
  f.controller.hide(); await f.controller.show(); await f.controller.loadPlan();
  assert.equal(f.controller.state.followupPlanConflict, true); await f.controller.savePlan(); assert.equal(f.calls.filter(c => c.method === 'POST').length,0);
  await f.controller.loadPlan({ rebase: true }); assert.equal(f.controller.state.followupPlanDraft.dailyTime, '19:30');
  await f.controller.savePlan(); assert.equal(f.plan.dailyTime,'19:30'); f.controller.hide();
});
test('another identity or a revoked manager cannot retain the prior plan or project choices', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.openPlan(); f.controller.editPlan('enabled',true);
  f.controller.hide(); f.session('two'); await f.controller.show(); assert.equal(f.controller.state.followupPlan,null);
  await f.controller.openPlan(); f.intercept(() => { throw { statusCode:403, code:'construction_forbidden' }; });
  await f.controller.loadPlan(); assert.equal(f.controller.state.followupPlanDraft,null); assert.deepEqual(f.controller.state.followupPlanProjects,[]); f.controller.hide();
});
test('an incorrect receipt remains unknown without a saved notice or a second operation', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.openPlan(); f.controller.editPlan('enabled',true);
  f.intercept(method => method === 'POST' ? { ...f.plan, enterpriseId:'another', version:4 } : undefined);
  await f.controller.savePlan(); assert.equal(f.controller.state.followupPending,true); assert.equal(f.controller.state.followupPlanNotice,'');
  await f.controller.openSettings(); assert.equal(f.calls.filter(c => c.method === 'POST').length,1); f.controller.hide();
});
