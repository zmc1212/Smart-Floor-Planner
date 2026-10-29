import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantError } from '@/lib/assistant/contracts';
import { allPointsAccepted, canActOnPoint, canCancel, canConfirm, canExit, canExtend, canQuote, canRepair, canSchedule, cents, depositDisposition, extensionDays, quoteLines, repairIssue, repairResolution, scheduledFor, servicePoints, shanghaiDayStart } from '../service-order-contract';

const fails = (fn: () => unknown, code = 'invalid_service_order') => {
  try { fn(); } catch (error) { assert.ok(error instanceof AssistantError); assert.equal(error.code, code); return; }
  assert.fail('expected rejection');
};
test('quotes record whole cents only and the total is their exact sum', () => {
  assert.deepEqual(quoteLines([{ label: '云工地视频托管服务', amountCents: 120000 }, { label: '安装调试', amountCents: 30050 }]),
    { lines: [{ label: '云工地视频托管服务', amountCents: 120000 }, { label: '安装调试', amountCents: 30050 }], totalCents: 150050 });
  assert.equal(quoteLines([{ label: '服务', amountCents: 0 }]).totalCents, 0);
  for (const value of [[], Array(11).fill({ label: '服务', amountCents: 1 }), [{ label: ' ', amountCents: 1 }], [{ label: '服务', amountCents: -1 }],
    [{ label: '服务', amountCents: 1.5 }], [{ label: '服务', amountCents: '100' }], [{ label: '服务', amountCents: 1, tax: 1 }], ['服务'],
    [{ label: '服务', amountCents: 100000000000 }, { label: '追加', amountCents: 1 }]]) fails(() => quoteLines(value));
});
test('installation points require unique meaningful names, at most one camera each and project-owned room ids', () => {
  assert.deepEqual(servicePoints([{ name: ' 客厅东墙 ', roomId: '31', positionNote: '吊顶下方 2.2 米' }, { name: '入户门', positionNote: '' }]), [
    { name: '客厅东墙', roomId: '31', positionNote: '吊顶下方 2.2 米' }, { name: '入户门', roomId: null, positionNote: '' },
  ]);
  assert.equal(servicePoints([{ name: '点位', roomId: '', positionNote: '' }])[0].roomId, null);
  for (const value of [[], Array(9).fill({ name: '点位' }).map((p, i) => ({ ...p, name: `点位 ${i}` })), [{ name: '' }], [{ name: '点位', roomId: '0' }],
    [{ name: '点位', roomId: 'http://x' }], [{ name: '点位', positionNote: 'x'.repeat(201) }], [{ name: '点位', extra: 1 }],
    [{ name: '点位' }, { name: '点位' }]]) fails(() => servicePoints(value));
});
test('scheduled installation cannot be dated before today in Shanghai and stays inside one year', () => {
  const now = new Date('2026-10-29T02:00:00Z');
  assert.equal(shanghaiDayStart(now).toISOString(), '2026-10-28T16:00:00.000Z');
  assert.equal(scheduledFor('2026-10-28T16:00:00Z', now), '2026-10-28T16:00:00.000Z');
  fails(() => scheduledFor('2026-10-28T15:59:59Z', now), 'service_order_schedule_past');
  assert.equal(scheduledFor('2027-10-30T02:00:00Z', now), '2027-10-30T02:00:00.000Z');
  for (const value of ['2027-10-30T02:00:01Z', '明天', '', 1780000000000, 'x'.repeat(41)]) fails(() => scheduledFor(value, now));
});
test('order transitions stay one-way and every point must be accepted before completion', () => {
  assert.ok(canQuote('pending_quote') && canQuote('quoted') && canQuote('confirmed'));
  assert.ok(!canQuote('scheduled') && !canQuote('accepted') && !canQuote('cancelled'));
  assert.ok(canConfirm('quoted') && !canConfirm('confirmed') && !canConfirm('pending_quote'));
  assert.ok(canSchedule('confirmed') && canSchedule('scheduled') && !canSchedule('quoted'));
  assert.ok(canCancel('pending_quote') && canCancel('scheduled') && !canCancel('accepted') && !canCancel('cancelled'));
  assert.ok(canActOnPoint('scheduled') && !canActOnPoint('confirmed') && !canActOnPoint('accepted'));
  assert.ok(allPointsAccepted([{ status: 'accepted' }, { status: 'accepted' }]));
  assert.ok(!allPointsAccepted([]) && !allPointsAccepted([{ status: 'accepted' }, { status: 'installed' }]));
});
test('repairs and extensions stay within recorded bounds and only accepted service can be extended or exited', () => {
  assert.equal(extensionDays(30), 30); assert.equal(extensionDays(3650), 3650);
  for (const value of [0, 3651, 1.5, '30', null]) fails(() => extensionDays(value));
  assert.equal(repairIssue('  客厅画面偏暗 '), '客厅画面偏暗');
  for (const value of ['', '   ', 'x'.repeat(501), 5]) fails(() => repairIssue(value));
  assert.equal(repairResolution(' 已调整曝光 '), '已调整曝光');
  for (const value of ['', 'x'.repeat(201)]) fails(() => repairResolution(value));
  assert.ok(canRepair('scheduled') && canRepair('accepted'));
  assert.ok(!canRepair('confirmed') && !canRepair('exited') && !canRepair('cancelled'));
  assert.ok(canExtend('accepted') && !canExtend('scheduled') && !canExtend('exited'));
  assert.ok(canExit('accepted') && !canExit('scheduled') && !canExit('cancelled'));
  assert.ok(!canCancel('exited') && canCancel('scheduled'));
});
test('deposit disposition records whole non-negative amounts with an optional bounded note', () => {
  assert.deepEqual(depositDisposition({ depositReturnedCents: 40000, depositDeductedCents: 10000, depositNote: ' 线下已结算 ' }),
    { returnedCents: 40000, deductedCents: 10000, note: '线下已结算' });
  assert.deepEqual(depositDisposition({ depositReturnedCents: 0, depositDeductedCents: 0 }), { returnedCents: 0, deductedCents: 0, note: '' });
  for (const value of [{ depositReturnedCents: -1, depositDeductedCents: 0 }, { depositReturnedCents: 1.5, depositDeductedCents: 0 },
    { depositReturnedCents: '100', depositDeductedCents: 0 }, { depositReturnedCents: 0, depositDeductedCents: 100000000001 },
    { depositReturnedCents: 0, depositDeductedCents: 0, depositNote: 'x'.repeat(201) }]) fails(() => depositDisposition(value));
});
test('stored money never introduces fractions or negatives into a displayed receipt', () => {
  assert.equal(cents(150050n), 150050);
  assert.equal(cents('150050'), 150050);
  assert.equal(cents(0), 0);
  for (const value of [-1, 1.5, '1.5', '-1', '', null, undefined, Number.MAX_SAFE_INTEGER + 1]) assert.equal(cents(value), null);
});
