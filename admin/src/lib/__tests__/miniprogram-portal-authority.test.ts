import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireMiniProgramPortalMode, requireMiniProgramStaffEarnings, requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import type { MiniProgramContext } from '@/lib/miniprogram-auth';

const customer = { mode: 'customer', enterpriseId: undefined, referrerMembershipId: undefined } as unknown as MiniProgramContext;
const referrer = { mode: 'referrer', enterpriseId: '7', referrerMembershipId: '9' } as unknown as MiniProgramContext;

test('customer project index rejects a signed non-customer context', () => {
  assert.throws(() => requireMiniProgramPortalMode(referrer, 'customer'), { status: 403, code: 'miniprogram_portal_forbidden' });
});

test('referrer aggregates reject customer and incomplete membership contexts', () => {
  assert.throws(() => requireMiniProgramPortalMode(customer, 'referrer'), { status: 403, code: 'miniprogram_portal_forbidden' });
  assert.throws(() => requireMiniProgramPortalMode({ ...referrer, referrerMembershipId: undefined }, 'referrer'), { status: 403, code: 'referrer_membership_context_invalid' });
});

test('staff earnings reject non-designer and non-measurer contexts', () => {
  const designer = { mode: 'staff', enterpriseId: '7', staff: { _id: '11', role: 'designer' } } as unknown as MiniProgramContext;
  const measurer = { mode: 'staff', enterpriseId: '7', staff: { _id: '12', role: 'measurer' } } as unknown as MiniProgramContext;
  const owner = { mode: 'staff', enterpriseId: '7', staff: { _id: '13', role: 'enterprise_admin' } } as unknown as MiniProgramContext;
  assert.equal(requireMiniProgramStaffEarnings(designer), 'designer');
  assert.equal(requireMiniProgramStaffEarnings(measurer), 'measurer');
  assert.throws(() => requireMiniProgramStaffEarnings(customer), { status: 403, code: 'miniprogram_portal_forbidden' });
  assert.throws(() => requireMiniProgramStaffEarnings(referrer), { status: 403, code: 'miniprogram_portal_forbidden' });
  assert.throws(() => requireMiniProgramStaffEarnings(owner), { status: 403, code: 'miniprogram_portal_forbidden' });
  assert.throws(() => requireMiniProgramStaffEarnings({ ...designer, enterpriseId: undefined }), { status: 403, code: 'miniprogram_portal_forbidden' });
});

test('enterprise payout ledger rejects non-owner staff contexts', () => {
  const designer = { mode: 'staff', enterpriseId: '7', staff: { _id: '11', role: 'designer' } } as unknown as MiniProgramContext;
  const owner = { mode: 'staff', enterpriseId: '7', staff: { _id: '13', role: 'enterprise_admin' } } as unknown as MiniProgramContext;
  assert.equal(requireMiniProgramEnterpriseAdmin(owner), undefined);
  assert.throws(() => requireMiniProgramEnterpriseAdmin(designer), { status: 403, code: 'miniprogram_portal_forbidden' });
  assert.throws(() => requireMiniProgramEnterpriseAdmin(customer), { status: 403, code: 'miniprogram_portal_forbidden' });
  assert.throws(() => requireMiniProgramEnterpriseAdmin(referrer), { status: 403, code: 'miniprogram_portal_forbidden' });
  assert.throws(() => requireMiniProgramEnterpriseAdmin({ ...owner, enterpriseId: undefined }), { status: 403, code: 'miniprogram_portal_forbidden' });
});
