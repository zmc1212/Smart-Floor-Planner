import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import {
  ENTERPRISE_ADMIN_INITIAL_PASSWORD,
  hashEnterpriseAdminInitialPassword,
} from '@/lib/enterprise-admin-provision';

test('enterprise admin initial password is 123456 and is hashed from one constant', async () => {
  assert.equal(ENTERPRISE_ADMIN_INITIAL_PASSWORD, '123456');
  const hash = await hashEnterpriseAdminInitialPassword();
  assert.equal(await bcrypt.compare('123456', hash), true);
  assert.equal(await bcrypt.compare('Admin123456', hash), false);

  const sources = [
    'src/lib/enterprise-admin-provision.ts',
    'src/app/api/admin/enterprises/route.ts',
    'src/app/api/admin/enterprises/activate/route.ts',
  ].map((relativePath) =>
    readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  );
  for (const source of sources) {
    assert.match(source, /hashEnterpriseAdminInitialPassword/);
    assert.doesNotMatch(source, /Admin123456/);
  }
  assert.match(sources[0], /export const ENTERPRISE_ADMIN_INITIAL_PASSWORD = '123456'/);
});
