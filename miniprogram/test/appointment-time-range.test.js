const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  toIsoTimestamp,
  parseAppointmentBounds,
  formatAppointmentDisplay,
} = require('../utils/appointmentTimeRange.js');

test('toIsoTimestamp rewrites postgres timestamps that iOS Date cannot parse', () => {
  assert.equal(toIsoTimestamp('2026-08-23 01:00:00+00'), '2026-08-23T01:00:00+00:00');
  assert.equal(toIsoTimestamp('"2026-08-23 09:00:00+08"'), '2026-08-23T09:00:00+08:00');
  assert.equal(toIsoTimestamp('2026-08-23T01:00:00.000Z'), '2026-08-23T01:00:00.000Z');
});

test('parseAppointmentBounds accepts postgres tstzrange literals', () => {
  const bounds = parseAppointmentBounds('["2026-08-23 01:00:00+00","2026-08-23 03:00:00+00")');
  assert.equal(bounds.startAt.toISOString(), '2026-08-23T01:00:00.000Z');
  assert.equal(bounds.endAt.toISOString(), '2026-08-23T03:00:00.000Z');
});

test('formatAppointmentDisplay buckets a 09:00 Shanghai visit onto that calendar day', () => {
  const display = formatAppointmentDisplay('["2026-08-23 01:00:00+00","2026-08-23 03:00:00+00")');
  assert.equal(display.dateKey, '2026-08-23');
  assert.equal(display.time, '09:00 - 11:00');
  assert.equal(display.timeText, '09:00 - 11:00');
  assert.match(display.dateText, /2026年8月23日/);
});

test('formatAppointmentDisplay still buckets Shanghai visits when Intl is missing', () => {
  const { spawnSync } = require('node:child_process');
  const helperPath = path.resolve(__dirname, '../utils/appointmentTimeRange.js');
  const result = spawnSync(process.execPath, ['-e', `
    delete globalThis.Intl;
    const { formatAppointmentDisplay } = require(${JSON.stringify(helperPath)});
    const display = formatAppointmentDisplay('["2026-08-23 01:00:00+00","2026-08-23 03:00:00+00")');
    if (display.dateKey !== '2026-08-23') throw new Error('dateKey ' + display.dateKey);
    if (display.time !== '09:00 - 11:00') throw new Error('time ' + display.time);
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('appointment surfaces use the shared iOS-safe time-range helper', () => {
  const root = path.resolve(__dirname, '..');
  const files = [
    'packages/business/customer-project/customer-project.js',
    'packages/business/measurer-calendar/measurer-calendar.js',
    'packages/business/appointment-detail/appointment-detail.js',
    'packages/business/enterprise-appointments/enterprise-appointments.js',
    'components/role-workbench/role-workbench.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /appointmentTimeRange/, `${file} should reuse the shared parser`);
  }
});
