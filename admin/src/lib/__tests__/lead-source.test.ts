import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEAD_COMMISSION_SOURCES,
  isStaffCommissionSource,
  shouldSnapshotLeadCommissions,
} from '@/lib/lead-source';

test('manual entry uses the two-role commission snapshot, not a referrer row', () => {
  assert.deepEqual(LEAD_COMMISSION_SOURCES, [
    'referrer_network',
    'staff_activity',
    'manual_entry',
  ]);
  assert.equal(isStaffCommissionSource('manual_entry'), true);
  assert.equal(isStaffCommissionSource('staff_activity'), true);
  assert.equal(isStaffCommissionSource('referrer_network'), false);
  assert.equal(isStaffCommissionSource('MiniProgram'), false);
});

test('conversion snapshots commissions for manual entry even before a measurer is filled', () => {
  assert.equal(shouldSnapshotLeadCommissions({
    source: 'manual_entry',
    referrerMembershipId: null,
    measurerId: null,
  }), true);
  assert.equal(shouldSnapshotLeadCommissions({
    source: 'staff_activity',
    referrerMembershipId: null,
    measurerId: null,
  }), true);
  assert.equal(shouldSnapshotLeadCommissions({
    source: 'MiniProgram',
    referrerMembershipId: null,
    measurerId: null,
  }), false);
});
