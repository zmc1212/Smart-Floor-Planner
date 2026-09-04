const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness(role = 'designer', focus = 'overview') {
  let component;
  const destinations = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../components/role-workbench/role-workbench.js'), 'utf8'), {
    require: () => ({}),
    Component: (value) => { component = value; },
    wx: { navigateTo: ({ url }) => destinations.push(url) },
  });
  const context = {
    properties: { role, focus },
    openAppointment: () => destinations.push('appointment'),
    openSurvey: () => destinations.push('survey'),
    openReschedule: () => destinations.push('reschedule'),
  };
  return {
    destinations,
    click: (item) => component.methods.openItem.call(context,
      { currentTarget: { dataset: { item } } }),
  };
}

for (const action of ['rebook', 'book', 'appointment', 'reschedule', 'survey', 'lead']) {
  test(`published designer overview opens schemes ahead of stale ${action} action`, () => {
    const h = harness();
    h.click({ leadId: 'customer / 1', appointmentId: 'appointment-1',
      serviceStage: 'design_published', action,
      canContinueSurvey: action === 'survey', canSurveyNow: action === 'survey' });
    assert.deepEqual(h.destinations, [
      '/packages/business/customer-ai-schemes/customer-ai-schemes?leadId=customer%20%2F%201&mode=staff',
    ]);
  });
}

test('unpublished overview still opens rebooking', () => {
  const h = harness();
  h.click({ leadId: 'lead-1', serviceStage: 'awaiting_rebooking', action: 'rebook' });
  assert.deepEqual(h.destinations, [
    '/packages/business/appointment-booking/appointment-booking?leadId=lead-1',
  ]);
});

for (const [role, focus] of [['measurer', 'overview'], ['designer', 'survey']]) {
  test(`${role} ${focus} retains its explicit survey destination`, () => {
    const h = harness(role, focus);
    h.click({ leadId: 'lead-1', serviceStage: 'design_published', action: 'survey' });
    assert.deepEqual(h.destinations, ['survey']);
  });
}

test('published customer card retains the customer project route', () => {
  const h = harness('customer');
  h.click({ leadId: 'lead-1', serviceStage: 'design_published', action: 'customer-project' });
  assert.deepEqual(h.destinations, [
    '/packages/business/customer-project/customer-project?leadId=lead-1',
  ]);
});
