import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  mergePlatformPromotionConfig,
  normalizePlatformPromotionConfig,
} from '../platform-promotion-config';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('saving a protection-period patch keeps the stored referrer membership limit', () => {
  const merged = mergePlatformPromotionConfig(
    {
      protectionPeriodDays: 30,
      protectionExtendDays: 15,
      maxProtectionExtends: 3,
      poolClaimRequiresApproval: true,
      referrerMembershipLimit: 5,
    },
    { protectionPeriodDays: 45 }
  );
  assert.equal(merged.protectionPeriodDays, 45);
  assert.equal(merged.protectionExtendDays, 15);
  assert.equal(merged.maxProtectionExtends, 3);
  assert.equal(merged.poolClaimRequiresApproval, true);
  assert.equal(merged.referrerMembershipLimit, 5);
});

test('referrerMembershipLimit patch is normalized to a positive integer', () => {
  assert.equal(
    mergePlatformPromotionConfig(undefined, { referrerMembershipLimit: 8 })
      .referrerMembershipLimit,
    8
  );
  assert.equal(
    normalizePlatformPromotionConfig({ referrerMembershipLimit: 0 })
      .referrerMembershipLimit,
    3
  );
  assert.equal(
    normalizePlatformPromotionConfig({ referrerMembershipLimit: 1.9 })
      .referrerMembershipLimit,
    1
  );
  const stored: Record<string, unknown> = { referrerMembershipLimit: '2' };
  assert.equal(
    normalizePlatformPromotionConfig(stored).referrerMembershipLimit,
    2
  );
});

test('promotion-config PATCH accepts referrerMembershipLimit and merge-saves', () => {
  const route = source('../../app/api/platform/promotion-config/route.ts');
  const saver = source('../platform-promotion-config.ts');
  const listPage = source(
    '../../app/(admin)/(platform)/enterprises/page.tsx'
  );
  assert.match(route, /referrerMembershipLimit\?: number/);
  assert.match(route, /roles: \['super_admin', 'admin'\]/);
  assert.match(saver, /ensureForUpdate\('default'\)/);
  assert.match(saver, /mergePlatformPromotionConfig\(stored, input\)/);
  assert.match(listPage, /推广人可加入企业数/);
  assert.match(listPage, /\/api\/platform\/promotion-config/);
  assert.match(listPage, /referrerMembershipLimit/);
  assert.match(listPage, /isPlatformAdminRole\(user\?\.role\)/);
  assert.match(listPage, /canEditJoinLimit/);
  assert.doesNotMatch(
    source('../../app/(admin)/(platform)/promotion-records/page.tsx'),
    /referrerMembershipLimit/
  );
});
