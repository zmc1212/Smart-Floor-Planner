import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultMiniProgramIdentityContext,
  isMiniProgramIdentityContextSupported,
  miniProgramIdentityContextToDto,
  signMiniProgramIdentityContextToken,
} from '@/lib/miniprogram-identity-context';
import {
  signMiniProgramToken,
  verifyMiniProgramToken,
} from '@/lib/miniprogram-jwt';

test('identity context tokens carry the base user and selected staff context', async () => {
  const token = await signMiniProgramIdentityContextToken({
    userId: BigInt(41),
    contextVersion: 7,
    source: 'phone',
    context: {
      mode: 'staff',
      enterpriseId: BigInt(9),
      enterpriseName: 'Tenant A',
      staffId: BigInt(17),
      staffRole: 'designer',
      staffDisplayName: 'Designer A',
      referrerMembershipId: null,
    },
  });
  const payload = await verifyMiniProgramToken(token);
  assert.equal(payload?.sub, '41');
  assert.equal(payload?.id, '41');
  assert.equal(payload?.mode, 'staff');
  assert.equal(payload?.enterpriseId, '9');
  assert.equal(payload?.staffId, '17');
  assert.equal(payload?.contextVersion, 7);
});

test('JWT verification rejects legacy tokens without identity context claims', async () => {
  const token = await signMiniProgramToken({
    sub: '1',
    id: '1',
    mode: 'customer',
    role: 'user',
    contextVersion: 1,
    source: 'wechat',
  });
  assert.ok(await verifyMiniProgramToken(token));

  const invalid = await signMiniProgramToken({
    sub: '',
    id: '1',
    mode: 'customer',
    role: 'user',
    contextVersion: 1,
    source: 'wechat',
  });
  assert.equal(await verifyMiniProgramToken(invalid), null);
});

test('identity context DTO serializes bigint identifiers explicitly', () => {
  assert.deepEqual(
    miniProgramIdentityContextToDto({
      mode: 'referrer',
      enterpriseId: BigInt(12),
      enterpriseName: 'Tenant B',
      staffId: null,
      staffRole: null,
      staffDisplayName: null,
      referrerMembershipId: BigInt(33),
    }),
    {
      mode: 'referrer',
      enterpriseId: '12',
      enterpriseName: 'Tenant B',
      staffId: null,
      staffRole: null,
      staffDisplayName: null,
      referrerMembershipId: '33',
    }
  );
});

test('platform-only staff contexts are supported Mini Program workbench roles', () => {
  const customer = {
    mode: 'customer' as const,
    enterpriseId: null,
    enterpriseName: null,
    staffId: null,
    staffRole: null,
    staffDisplayName: null,
    referrerMembershipId: null,
  };
  const platformAdmin = {
    ...customer,
    mode: 'staff' as const,
    enterpriseId: BigInt(8),
    staffId: BigInt(9),
    staffRole: 'admin',
    staffDisplayName: 'Platform Admin',
  };
  const referrer = {
    ...customer,
    mode: 'referrer' as const,
    enterpriseId: BigInt(8),
    enterpriseName: 'Tenant A',
    referrerMembershipId: BigInt(10),
  };

  assert.equal(isMiniProgramIdentityContextSupported(platformAdmin), true);
  assert.equal(
    defaultMiniProgramIdentityContext([customer, platformAdmin, referrer]),
    platformAdmin
  );
});

test('platform channel salesperson staff context is supported without an enterprise', () => {
  const customer = {
    mode: 'customer' as const,
    enterpriseId: null,
    enterpriseName: null,
    staffId: null,
    staffRole: null,
    staffDisplayName: null,
    referrerMembershipId: null,
  };
  const salesperson = {
    ...customer,
    mode: 'staff' as const,
    enterpriseId: null,
    staffId: BigInt(21),
    staffRole: 'salesperson',
    staffDisplayName: 'Gong Jie',
  };

  assert.equal(isMiniProgramIdentityContextSupported(salesperson), true);
  assert.equal(
    defaultMiniProgramIdentityContext([customer, salesperson]),
    salesperson
  );
});
