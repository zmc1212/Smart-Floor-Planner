import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appointmentDisplayText, appointmentTimeText } from '../agent/appointment-display';

test('customer appointment bodies carry Beijing time but no internal id, version or raw range', () => {
  const expired = appointmentDisplayText('现场量房', 'expired', '[2026-08-31T16:06:34.246Z,2026-08-31T18:06:34.246Z)');
  assert.equal(expired, '现场量房：量房预约已过期，时间2026年9月1日 00:06–02:06（北京时间）。');
  for (const hidden of ['1818', '255', '版本', '[', ']', 'T16:06', 'Z']) assert.equal(expired.includes(hidden), false, hidden);
  assert.equal(appointmentDisplayText('东辰心语A区', 'confirmed', '[2026-09-01T01:07:31.047Z,2026-09-01T03:07:31.047Z)'),
    '东辰心语A区：量房预约已确认，时间2026年9月1日 09:07–11:07（北京时间）。');
});

test('appointment time keeps the existing Shanghai conversion across midnight and noon', () => {
  assert.equal(appointmentTimeText('[2026-11-03T04:00:00.000Z,2026-11-03T12:00:00.000Z)'), '2026年11月3日 12:00–20:00');
  assert.equal(appointmentTimeText('[2026-09-01T15:30:00.000Z,2026-09-01T17:00:00.000Z)'), '2026年9月1日 23:30–9月2日 01:00');
});

test('unknown state and unreadable ranges stay honest instead of echoing the stored value', () => {
  assert.equal(appointmentDisplayText('', 'on_hold', '[2026-09-01T01:07:31.047Z,2026-09-01T03:07:31.047Z)'),
    '本企业服务档案：量房预约状态待核实，时间2026年9月1日 09:07–11:07（北京时间）。');
  assert.equal(appointmentTimeText('not-a-range'), '');
  assert.equal(appointmentDisplayText('现场量房', 'pending', 'not-a-range'), '现场量房：量房预约待确认，具体时间待核实。');
  assert.equal(appointmentTimeText('[2026-09-01T03:07:31.047Z,2026-09-01T01:07:31.047Z)'), '');
});
