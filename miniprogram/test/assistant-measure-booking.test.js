const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient } = require('../packages/assistant/lib/client');
const { MeasureBookingController } = require('../packages/assistant/lib/measure-booking');

const readReceipt = {
  projects: [{ leadId: '10', name: '合成工地', communityName: null }],
  leadId: '10',
  appointment: null,
  contactPhone: '13801000000',
  phoneMasked: '138****0000',
  maxAdvanceDays: 5,
  durationMinutes: 60,
  timezone: 'Asia/Shanghai',
};
const slots = [
  { startAt: '2026-11-20T06:00:00.000Z', endAt: '2026-11-20T07:00:00.000Z' },
  { startAt: '2026-11-20T07:00:00.000Z', endAt: '2026-11-20T08:00:00.000Z' },
];
const appointment = {
  id: '99', leadId: '10', enterpriseId: '5', designerId: '7', measurerId: '7',
  timeRange: '["2026-11-20 14:00:00+08","2026-11-20 15:00:00+08"]',
  address: '合成小区 1 栋 101', locationName: null, status: 'confirmed',
};

function fixture(interceptPost, readAvailability, booking = readReceipt) {
  const calls = [];
  const view = {};
  const client = new AssistantClient(async (url, method, body, options) => {
    const call = { url, method, body, options };
    calls.push(call);
    if (url.endsWith('/measure-booking') && method === 'GET') return { success: true, data: booking };
    if (url.includes('/measure-booking/availability')) {
      return readAvailability ? readAvailability(body) : { success: true, data: { leadId: '10', maxAdvanceDays: 5, slots } };
    }
    if (url.endsWith('/measure-booking') && method === 'POST') {
      if (interceptPost) { const handled = await interceptPost(call, calls); if (handled) return handled; }
      return { success: true, data: { leadId: '10', appointment } };
    }
    return { success: false, error: 'not_found' };
  });
  const controller = new MeasureBookingController({ client, identity: () => 'owner', emit: patch => Object.assign(view, patch) });
  return { controller, calls, view };
}

test('reading a conversation loads real availability and submits the selected slot with an address', async () => {
  const f = fixture();
  assert.equal(await f.controller.show('8'), true);
  assert.equal(f.view.measureLeadId, '10');
  assert.equal(f.view.measurePhone, '13801000000');
  assert.equal(f.view.measureContactEditable, true);
  assert.ok(f.view.measureDates.length >= 1);
  assert.equal(f.view.measureSlots.length, 2);
  f.controller.selectSlot(f.view.measureSlots[0]);
  assert.equal(f.view.measureSlotHeading, '11月20日 14:00');
  f.controller.inputAddress('合成小区 1 栋 101');
  assert.equal(await f.controller.submit(), true);
  assert.equal(f.view.measureAppointment.id, '99');
  assert.equal(f.view.measureAppointmentLabel, '11月20日 14:00 - 15:00');
  assert.equal(f.view.measureSlotHeading, '');
  assert.match(f.view.measureAppointmentMeta, /合成小区 1 栋 101/);
  const post = f.calls.find(call => call.method === 'POST');
  assert.deepEqual(post.body, {
    leadId: '10', startAt: slots[0].startAt, endAt: slots[0].endAt,
    address: '合成小区 1 栋 101',
  });
});

test('an empty address never creates an appointment', async () => {
  const f = fixture();
  await f.controller.show('8');
  f.controller.selectSlot(f.view.measureSlots[0]);
  assert.equal(await f.controller.submit(), false);
  assert.match(f.view.measureBookingError, /请填写上门地址/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('an unknown booking keeps the original key and contact override for the retry', async () => {
  let attempts = 0, firstKey = '', firstBody;
  const f = fixture(call => {
    attempts++;
    if (attempts === 1) {
      firstKey = call.options.headers['Idempotency-Key'];
      firstBody = call.body;
      throw { statusCode: 503 };
    }
    assert.equal(call.options.headers['Idempotency-Key'], firstKey);
    assert.deepEqual(call.body, firstBody);
    assert.equal(call.body.contactPhone, '13901000000');
    return null;
  });
  await f.controller.show('8');
  assert.equal(await f.controller.editContact(async () => '13901000000'), true);
  f.controller.selectSlot(f.view.measureSlots[0]);
  f.controller.inputAddress('合成小区 1 栋 101');
  assert.equal(await f.controller.submit(), false);
  assert.equal(f.view.measureBookingPending, true);
  assert.equal(await f.controller.editContact(async () => '13701000000'), false);
  assert.equal(await f.controller.submit(), true);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 2);
});

test('the login number stays visible when the user cancels or enters an invalid appointment number', async () => {
  const f = fixture();
  await f.controller.show('8');
  assert.equal(await f.controller.editContact(async phone => {
    assert.equal(phone, '13801000000');
    return undefined;
  }), false);
  assert.equal(await f.controller.editContact(async () => '123'), false);
  assert.match(f.view.measureBookingError, /手机号/);
  assert.equal(f.view.measurePhone, '13801000000');
});

test('reentry displays the number saved for this appointment', async () => {
  const f = fixture(null, null, { ...readReceipt, appointment, contactPhone: '13901000000' });
  await f.controller.show('8');
  assert.equal(f.view.measureAppointment.id, '99');
  assert.equal(f.view.measurePhone, '13901000000');
  assert.equal(await f.controller.editContact(async () => '13701000000'), false);
});

test('rapid date changes only display slots returned for the current date', async () => {
  let resolveEarlier;
  let holdEarlier = false;
  const earlier = '2026-11-20';
  const later = '2026-11-21';
  const f = fixture(null, ({ date }) => {
    if (holdEarlier && date === earlier) return new Promise(resolve => { resolveEarlier = resolve; });
    return { success: true, data: { maxAdvanceDays: 5, slots: [slots[1]] } };
  });
  await f.controller.show('8');
  holdEarlier = true;
  f.controller.inputAddress('合成小区 1 栋 101');
  const slow = f.controller.selectDate(earlier);
  assert.equal(f.view.measureSlotsLoading, true);
  await f.controller.selectDate(later);
  resolveEarlier({ success: true, data: { maxAdvanceDays: 5, slots: [slots[0]] } });
  assert.equal(await slow, false);
  assert.equal(f.view.measureDate, later);
  assert.deepEqual(f.view.measureSlots.map(item => item.startAt), [slots[1].startAt]);
  assert.equal(f.view.measureSlotsLoading, false);
  assert.equal(f.controller.selectSlot(slots[0]), false);
  assert.equal(f.view.measureAddress, '合成小区 1 栋 101');
});

test('multiple service files wait for an explicit project before requesting its slots', async () => {
  const booking = { ...readReceipt, leadId: null,
    projects: [...readReceipt.projects, { leadId: '11', name: '第二份合成档案' }] };
  const f = fixture(null, null, booking);
  await f.controller.show('8');
  assert.equal(f.view.measureLeadName, '');
  assert.equal(f.calls.filter(call => call.url.includes('/availability')).length, 0);
  await f.controller.selectProject('11');
  assert.equal(f.view.measureLeadName, '第二份合成档案');
  assert.equal(f.calls.filter(call => call.url.includes('/availability')).length, 1);
});
