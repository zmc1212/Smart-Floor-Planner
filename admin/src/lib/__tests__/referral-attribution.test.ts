import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openPendingReferralSource,
  sealPendingReferralSource,
} from '@/lib/referral-attribution';

test('pending referral sources are opaque, authenticated, and time limited', () => {
  const now = new Date('2026-08-17T00:00:00.000Z');
  const token = sealPendingReferralSource(
    {
      promotionCodeId: BigInt(17),
      membershipId: BigInt(23),
      version: 4,
    },
    { now, ttlSeconds: 600 }
  );

  assert.match(token, /^prs_[A-Za-z0-9_-]+$/);
  const packed = Buffer.from(token.slice(4), 'base64url').toString('utf8');
  assert.equal(packed.includes('"p":"17"'), false);
  assert.equal(packed.includes('"m":"23"'), false);

  const opened = openPendingReferralSource(token, {
    now: new Date('2026-08-17T00:09:59.000Z'),
  });
  assert.deepEqual(opened, {
    promotionCodeId: BigInt(17),
    membershipId: BigInt(23),
    version: 4,
    expiresAt: new Date('2026-08-17T00:10:00.000Z'),
    expired: false,
  });

  assert.equal(
    openPendingReferralSource(token, {
      now: new Date('2026-08-17T00:10:01.000Z'),
    })?.expired,
    true
  );
  assert.equal(
    openPendingReferralSource(`${token.slice(0, -1)}x`, { now }),
    null
  );
});
