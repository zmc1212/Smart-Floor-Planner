const test = require('node:test');
const assert = require('node:assert/strict');

const notification = require('../utils/notification.js');

const templates = [
  { type: 'workflow_todo', title: '装修待办提醒', templateId: '48Jvq7OjOKwRhsnh8fyvtsjxAamLOakaNtiKcO11rOc' },
  { type: 'lead_assignment', title: '客户指派成功通知', templateId: 'wItuS0LdggzpMWdSOIr6FBSKeRbOKUzqXVCqJDmLpmA' },
  { type: 'new_lead', title: '新增客户成功通知', templateId: 'EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjg4xest9GRc' },
  { type: 'measurement_appointment', title: '上门量房提醒', templateId: 'CtcuQ_NWF4GOpHvstgviDPmYRISjyqTjnFAoeQR9-vI' },
  { type: 'design_published', title: '设计案例发布提醒', templateId: 'XEQFWwyaIQVotG3R6FKZxWLFExf9pS7_g85r-j3Vjag' },
  { type: 'enterprise_join_result', title: '入驻申请结果通知', templateId: 'wJ5K4XXpOOPnsHFcEOl5MJq7J0iG8bpxsyVLzd_G3Kk' },
  { type: 'signing_commission', title: '推广奖励到账提醒', templateId: 'aY-4Rk78otCQuM-PQ6yKUt46XFWP60zP8m7QqrrX8xU' },
  { type: 'lead_converted', title: '客户已成交提醒', templateId: 'WFQg70AyoRkLpHaNNK4oywE2gMS60nHuKelkLjkK3zo' },
];

test('versioned notification config requires every semantic template and ignores legacy scalar cache', () => {
  assert.equal(notification.normalizeTemplateConfig({ miniprogramTemplateId: 'legacy' }), null);
  assert.equal(notification.normalizeTemplateConfig({ version: 2, templates: templates.slice(0, 6) }), null);
  assert.deepEqual(
    notification.normalizeTemplateConfig({ version: 2, templates }).templates.map((item) => item.type),
    notification.TEMPLATE_ORDER
  );
});

test('versioned notification config rejects duplicate template IDs', () => {
  const config = { version: 2, templates: templates.map((template) => ({ ...template })) };
  config.templates[3].templateId = config.templates[0].templateId;
  assert.equal(notification.normalizeTemplateConfig(config), null);
});

test('role-scoped subscribe kinds stay within the WeChat three-template limit', () => {
  assert.equal(notification.getSubscribeKindsForRole('customer').length, 2);
  assert.equal(notification.getSubscribeKindsForRole('designer').length, 3);
  assert.equal(notification.getSubscribeKindsForRole('measurer').length, 3);
  assert.equal(notification.getSubscribeKindsForRole('enterprise_admin').length, 3);
  assert.deepEqual(notification.getSubscribeKindsForRole('referrer'), ['signing_commission']);
  assert.ok(notification.getSubscribeKindsForRole('customer').includes('design_published'));
  assert.ok(notification.getSubscribeKindsForRole('enterprise_admin').includes('lead_converted'));
  assert.ok(notification.TEMPLATE_ORDER.includes('signing_commission'));
  assert.ok(notification.TEMPLATE_ORDER.includes('lead_converted'));
});

test('subscribe request helpers are no-ops and never call WeChat authorize APIs', async () => {
  const originalWx = global.wx;
  let subscribeCalled = false;
  let modalCalled = false;
  global.wx = {
    showModal() { modalCalled = true; },
    requestSubscribeMessage() { subscribeCalled = true; },
    showToast() { throw new Error('no-op helpers must not toast'); }
  };

  try {
    const kindsResult = await notification.requestSubscribeKinds(['enterprise_join_result'], { quiet: true });
    const notifyResult = await notification.requestNotification({ role: 'designer' });
    const done = [];
    const offerResult = await notification.offerNotificationAuthorization({
      role: 'referrer',
      onDone: (result) => done.push(result)
    });

    assert.equal(subscribeCalled, false);
    assert.equal(modalCalled, false);
    assert.deepEqual(kindsResult.templateIds, []);
    assert.deepEqual(notifyResult.templateIds, []);
    assert.deepEqual(offerResult, { offered: false, accepted: false });
    assert.deepEqual(done[0], { offered: false, accepted: false });
  } finally {
    global.wx = originalWx;
  }
});
