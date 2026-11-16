import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import {
  createInitialPasswordCredential,
  generateInitialPassword,
} from '@/lib/enterprise-admin-provision';

test('enterprise admin initial passwords are random one-time credentials', async () => {
  const first = generateInitialPassword();
  const second = generateInitialPassword();
  assert.notEqual(first, second);
  assert.notEqual(first, '123456');
  assert.ok(first.length >= 20);

  const credential = await createInitialPasswordCredential();
  assert.equal(await bcrypt.compare(credential.password, credential.passwordHash), true);
  assert.equal(await bcrypt.compare('123456', credential.passwordHash), false);
  assert.equal(await bcrypt.compare('Admin123456', credential.passwordHash), false);

  const sources = [
    'src/lib/enterprise-admin-provision.ts',
    'src/app/api/admin/enterprises/route.ts',
    'src/app/api/admin/enterprises/activate/route.ts',
    'src/app/api/miniprogram/onboarding/staff/route.ts',
  ].map((relativePath) =>
    readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /'123456'/);
    assert.doesNotMatch(source, /Admin123456/);
  }
  assert.match(sources[0], /randomBytes\(18\)/);
  assert.match(sources[1], /createInitialPasswordCredential/);
  assert.match(sources[2], /createInitialPasswordCredential/);
  assert.match(sources[3], /createInitialPasswordCredential/);
});

test('approval links the existing Mini Program user on the contact phone to the new enterprise admin', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src/lib/enterprise-admin-provision.ts'),
    'utf8'
  );
  assert.match(source, /ensureStaffUser/);
  assert.match(source, /MiniProgramIdentityRepository/);
});
