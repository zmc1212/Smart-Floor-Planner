import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEAD_COMMISSION_SOURCES,
  isTwoRoleCommissionSource,
  shouldSnapshotLeadCommissions,
} from '@/lib/lead-source';

test('manual entry uses the two-role commission snapshot, not a referrer row', () => {
  assert.deepEqual(LEAD_COMMISSION_SOURCES, [
    'referrer_network',
    'staff_activity',
    'manual_entry',
  ]);
  assert.equal(isTwoRoleCommissionSource('manual_entry'), true);
  assert.equal(isTwoRoleCommissionSource('staff_activity'), true);
  assert.equal(isTwoRoleCommissionSource('referrer_network'), false);
  assert.equal(isTwoRoleCommissionSource('MiniProgram'), false);
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
