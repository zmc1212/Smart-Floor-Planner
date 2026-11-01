const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../utils/assistant-client');
const { FollowupController } = require('../utils/assistant-followups');
const { settingsPageMethods } = require('../utils/assistant-followup-settings');
function fixture() {
  let identity = 'self', intercept;
  const calls = [], items = [{ bindingId: '27', title: '本人项目', status: 'deleted', version: 3, preferences: { stage: true, daily: true, weekly: true } }];
  const client = new AssistantClient(async (url, method, body, options) => {
    const path = url.replace('/miniprogram/assistant', ''); calls.push({ path, method, body, options });
    if (intercept) { const r = await intercept(path, method, body); if (r) return { success: true, data: r }; }
    let data;
    if (path === '/followups/manage') data = { items, nextCursor: null };
    else if (path === '/followups') data = { items: [] };
    else if (path.endsWith('/preferences')) { items[0].preferences = { ...body.preferences }; items[0].version++; data = {
      bindingId: '27', conversationId: '880', version: body.expectedVersion + 1, preferences: body.preferences }; }
    else throw Error('Unexpected ' + path);
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  });
  const controller = new FollowupController({ client, emit() {}, identity: () => identity, schedule: () => 0, unschedule() {} });
  return { controller, client, calls, items, identity: v => { identity = v; }, intercept: fn => { intercept = fn; } };
}
test('management discovers deleted metadata without opening its conversation or marking read', async () => {
  const f = fixture(); await f.controller.show({ autoOpen: true });
  assert.equal(f.controller.state.followupManageOpen, true); assert.equal(f.controller.state.followupSetting.status, 'deleted');
  assert.ok(f.calls.every(c => c.method === 'GET' && ['/followups', '/followups/manage'].includes(c.path)));
  f.controller.hide();
});
test('preference save validates the exact binding and saved fields, without modifying ordinary chat', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.openSettings(); f.controller.editPreference('daily', false);
  assert.equal(f.controller.state.followupPreferenceDirty, true); await f.controller.savePreferences();
  assert.equal(f.controller.state.followupPreferenceDirty, false); assert.equal(f.items[0].preferences.daily, false);
  assert.equal(f.controller.state.followupSettingsNotice, '提醒偏好已保存');
  assert.equal(f.controller.state.followupActive, false); assert.equal(f.controller.state.followupContext, null); f.controller.hide();
});
test('lost save keeps original key/body across hide and same-identity reentry', async () => {
  const f = fixture(); let lost = true;
  f.intercept(path => { if (path.endsWith('/preferences') && lost) { lost = false; throw { statusCode: 503 }; } });
  await f.controller.show(); await f.controller.openSettings(); f.controller.editPreference('weekly', false); await f.controller.savePreferences();
  assert.equal(f.controller.state.followupPending, true); f.controller.hide(); await f.controller.show();
  assert.equal(f.controller.state.followupPending, true); await f.controller.recover();
  const writes = f.calls.filter(c => c.method === 'POST'); assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, writes[1].body); assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key']);
  assert.equal(f.controller.state.followupSettingsNotice, '提醒偏好已保存'); f.controller.hide();
});
test('malformed preference receipt stays unknown and never claims saved', async () => {
  const f = fixture(); f.intercept(path => path.endsWith('/preferences') ? { bindingId: 'OTHER', conversationId: '880', version: 4, preferences: {} } : undefined);
  await f.controller.show(); await f.controller.openSettings(); f.controller.editPreference('stage', false); await f.controller.savePreferences();
  assert.equal(f.controller.state.followupPending, true); assert.equal(f.controller.state.followupSettingsNotice, '');
  assert.equal(f.controller.state.followupPreferenceDirty, true); f.controller.hide();
});
test('remote version change retains draft until explicit reload and never retries automatically', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.openSettings(); f.controller.editPreference('daily', false);
  f.items[0].version++; await f.controller.loadManagement(); assert.equal(f.controller.state.followupSettingsConflict, true);
  await f.controller.savePreferences(); assert.ok(f.calls.every(c => c.method === 'GET'));
  await f.controller.loadManagement({ rebase: true }); assert.equal(f.controller.state.followupPreferenceDraft.daily, false);
  assert.equal(f.controller.state.followupSetting.version, 4); await f.controller.savePreferences();
  assert.equal(f.items[0].preferences.daily, false); f.controller.hide();
});
test('revocation clears management labels and unsaved preferences; changed identity drops saved draft', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.openSettings(); f.controller.editPreference('stage', false);
  f.items.length = 0; await f.controller.loadManagement(); assert.equal(f.controller.state.followupSetting, null);
  assert.equal(f.controller.state.followupPreferenceDraft, null);
  f.controller.hide(); f.identity('other'); await f.controller.show(); assert.equal(f.controller.state.followupManageOpen, false); f.controller.hide();
});
test('cancelled discard leaves switches and selection unchanged, and blocks lifecycle writes', async () => {
  const f = fixture(); await f.controller.show(); await f.controller.openSettings(); f.controller.editPreference('daily', false);
  const previous = global.wx; global.wx = { showModal(o) { o.success({ confirm: false }); } };
  try {
    const page = { ...settingsPageMethods, _alive: true, _shown: true, data: f.controller.state, followups: f.controller };
    await page.changeFollowup({ currentTarget: { dataset: { action: 'delete' } } });
    assert.equal(f.controller.state.followupPreferenceDirty, true); assert.equal(f.controller.state.followupPreferenceDraft.daily, false);
    assert.ok(f.calls.every(c => c.method === 'GET'));
  } finally { global.wx = previous; f.controller.hide(); }
});
test('muted reports remain in history with no chat card or visibility receipt', async () => {
  const f = fixture(); await f.controller.show(); f.controller.set({ followupReports: [{ reportId: '9', deliveryState: 'muted' }] });
  assert.equal(f.controller.state.followupHasCards, false); await f.controller.visibleCard('9');
  assert.ok(f.calls.every(c => c.method === 'GET')); f.controller.hide();
});
