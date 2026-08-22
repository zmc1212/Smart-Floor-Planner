import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildEnterpriseAdminUsername } from '@/lib/enterprise-admin-provision';

test('buildEnterpriseAdminUsername keeps the first store on bare phone', () => {
  assert.equal(buildEnterpriseAdminUsername('13800138000', 42n), '13800138000');
  assert.equal(
    buildEnterpriseAdminUsername(' 13800138000 ', 42n, { additionalStore: false }),
    '13800138000'
  );
});

test('buildEnterpriseAdminUsername suffixes enterprise id for additional stores', () => {
  assert.equal(
    buildEnterpriseAdminUsername('13800138000', 42n, { additionalStore: true }),
    '13800138000_e42'
  );
});

test('admin user identity lookups refuse silent multi-match limit(1)', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../db/repositories/admin-user-repository.ts'),
    'utf8'
  );
  assert.match(source, /async listByUsernameOrPhone/);
  assert.match(source, /async listByOpenidOrPhone/);
  assert.match(source, /code: 'AMBIGUOUS_ADMIN_USER'/);
  assert.match(source, /existsWithPhone\([\s\S]*enterpriseId/);
  const findByUsernameBody = source.slice(
    source.indexOf('async findByUsernameOrPhone'),
    source.indexOf('async listByOpenidOrPhone')
  );
  assert.doesNotMatch(findByUsernameBody, /\.limit\(1\)/);
});

test('miniprogram identity listContexts returns every active staff row', () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../db/repositories/miniprogram-identity-repository.ts'
    ),
    'utf8'
  );
  assert.match(source, /async listActiveStaffByPhone/);
  assert.match(source, /linkActiveStaffPhoneToUser/);
  assert.match(source, /orderBy\(asc\(adminUsers\.id\)\)/);
  assert.doesNotMatch(
    source,
    /eq\(adminUsers\.userId, userId\), eq\(adminUsers\.status, 'active'\)\)\s*\)\s*\.limit\(1\)/
  );
});

test('device verify-binding openid fallback is enterprise-scoped', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/devices/verify-binding/route.ts'),
    'utf8'
  );
  assert.match(
    source,
    /findByOpenidOrPhone\(\s*openid\.trim\(\),\s*null,\s*\{\s*enterpriseId: matchedDevice\.enterpriseId\s*\}\s*\)/
  );
});
