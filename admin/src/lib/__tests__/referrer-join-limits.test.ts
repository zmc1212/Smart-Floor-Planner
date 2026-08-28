import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  isPlatformAdminRole,
  isReferrerProtectionLimitReached,
  parseReferrerAdditionalEnterpriseLimit,
} from '../referrer-join-limits';
import { referrerNetworkError } from '../referrer-network-api';
import { getCodeAuditResultLabel, getCodeAuditResultTagColor } from '../code-audit-labels';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('enterprise additional-limit parser accepts 0–99 or null', () => {
  assert.deepEqual(parseReferrerAdditionalEnterpriseLimit(null), {
    ok: true,
    value: null,
  });
  assert.deepEqual(parseReferrerAdditionalEnterpriseLimit(0), {
    ok: true,
    value: 0,
  });
  assert.deepEqual(parseReferrerAdditionalEnterpriseLimit(99), {
    ok: true,
    value: 99,
  });
  assert.equal(parseReferrerAdditionalEnterpriseLimit(-1).ok, false);
  assert.equal(parseReferrerAdditionalEnterpriseLimit(100).ok, false);
  assert.equal(parseReferrerAdditionalEnterpriseLimit('abc').ok, false);
});

test('protection takes the strictest M across target and existing enterprises', () => {
  assert.equal(
    isReferrerProtectionLimitReached({ activeCount: 0, limits: [0] }),
    false
  );
  assert.equal(
    isReferrerProtectionLimitReached({ activeCount: 1, limits: [0] }),
    true
  );
  assert.equal(
    isReferrerProtectionLimitReached({ activeCount: 1, limits: [1, null] }),
    false
  );
  assert.equal(
    isReferrerProtectionLimitReached({ activeCount: 2, limits: [1, 2] }),
    true
  );
});

test('enterprise PATCH writes referrerAdditionalEnterpriseLimit for platform admins only', () => {
  assert.equal(isPlatformAdminRole('admin'), true);
  assert.equal(isPlatformAdminRole('super_admin'), true);
  assert.equal(isPlatformAdminRole('enterprise_admin'), false);

  const route = source('../../app/api/admin/enterprises/[id]/route.ts');
  const dto = source('../../db/postgres-dto.ts');
  const schema = source('../../db/schema.ts');
  const migration = source('../../../drizzle/0046_referrer_join_limits.sql');
  const detailPage = source(
    '../../app/(admin)/(platform)/enterprises/[id]/page.tsx'
  );

  assert.match(route, /referrerAdditionalEnterpriseLimit/);
  assert.match(route, /isPlatformAdminRole\(context\.role\)/);
  assert.match(route, /status: 403/);
  assert.match(dto, /referrerAdditionalEnterpriseLimit:/);
  assert.match(schema, /referrer_additional_enterprise_limit/);
  assert.match(migration, /referrer_additional_enterprise_limit/);
  assert.match(detailPage, /推广人企业保护/);
  assert.match(detailPage, /referrerAdditionalEnterpriseLimit/);
  assert.match(detailPage, /isPlatformAdminRole\(user\?\.role\)/);
  assert.match(detailPage, /canEditProtection/);
  assert.match(detailPage, /0 表示只能服务本企业/);
  assert.doesNotMatch(
    source('../../components/enterprise/EnterpriseEditorDialog.tsx'),
    /referrerAdditionalEnterpriseLimit/
  );
});

test('referrer protection limit is a 409 onboarding error with Chinese audit copy', () => {
  assert.equal(referrerNetworkError('referrer_protection_limit').status, 409);
  assert.equal(
    getCodeAuditResultLabel('referrer_protection_limit'),
    '企业已限制推广人同时服务其他企业'
  );
  assert.equal(getCodeAuditResultTagColor('referrer_protection_limit'), 'red');
});
