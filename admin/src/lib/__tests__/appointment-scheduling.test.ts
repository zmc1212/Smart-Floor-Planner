import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appointmentRange,
  buildScheduleSlots,
  DEFAULT_WEEKLY_APPOINTMENT_SCHEDULE,
  localDateInTimeZone,
  normalizeWeeklyAppointmentSchedule,
  zonedDateTimeToUtc,
} from '@/lib/appointment-scheduling';

test('appointment schedule defaults to seven daily 09:00-18:00 windows', () => {
  assert.deepEqual(normalizeWeeklyAppointmentSchedule({}), DEFAULT_WEEKLY_APPOINTMENT_SCHEDULE);
  assert.equal(buildScheduleSlots({
    date: '2026-08-18', schedule: DEFAULT_WEEKLY_APPOINTMENT_SCHEDULE,
    timeZone: 'Asia/Shanghai', durationMinutes: 120, stepMinutes: 30,
  }).length, 15);
});

test('appointment schedule rejects invalid windows and preserves valid windows', () => {
  const schedule = normalizeWeeklyAppointmentSchedule({
    2: [{ start: '09:00', end: '11:00' }, { start: '12:00', end: '11:00' }, { start: 'x', end: '12:00' }],
  });
  assert.deepEqual(schedule['2'], [{ start: '09:00', end: '11:00' }]);
  assert.deepEqual(schedule['1'], []);
});

test('Asia/Shanghai slots persist as UTC tstzrange values', () => {
  const start = zonedDateTimeToUtc('2026-08-18', '09:00', 'Asia/Shanghai');
  assert.equal(start.toISOString(), '2026-08-18T01:00:00.000Z');
  assert.equal(appointmentRange(start, 120), '[2026-08-18T01:00:00.000Z,2026-08-18T03:00:00.000Z)');
  assert.equal(localDateInTimeZone(start, 'Asia/Shanghai'), '2026-08-18');
});
