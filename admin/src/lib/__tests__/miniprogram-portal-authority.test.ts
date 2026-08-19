import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireMiniProgramPortalMode } from '@/lib/miniprogram-portal-authority';
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
