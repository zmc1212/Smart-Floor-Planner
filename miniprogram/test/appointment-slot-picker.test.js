const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appointmentDates,
  formatConfirmRescheduleLabel,
} = require('../utils/appointmentSlotPicker.js');

test('appointmentDates builds a capped 5-day window with today/tomorrow labels', () => {
  const dates = appointmentDates(0, 30);
  assert.equal(dates.length, 5);
  assert.equal(dates[0].label, '今天');
  assert.equal(dates[1].label, '明天');
  assert.match(dates[0].key, /^\d{4}-\d{2}-\d{2}$/);
});

test('appointmentDates respects maxAdvanceDays remainder', () => {
  assert.equal(appointmentDates(6, 7).length, 2);
  assert.equal(appointmentDates(8, 7).length, 0);
});

test('formatConfirmRescheduleLabel uses selected slot start', () => {
  const label = formatConfirmRescheduleLabel({
    selectedSlot: { startAt: '2026-08-24T06:00:00.000Z', endAt: '2026-08-24T08:00:00.000Z' },
  });
  assert.match(label, /^确认改期至/);
  assert.match(label, /\d+月\d+日/);
  assert.match(label, /\d{2}:\d{2}/);
});
