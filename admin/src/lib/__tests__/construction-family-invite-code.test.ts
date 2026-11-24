import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY_INVITE_CODE_TTL_SECONDS,
  signFamilyInviteCode,
  verifyFamilyInviteCode,
} from '@/lib/construction/family-invite-code';

test('a family invite code fits the 32-character Mini Program scene and round-trips', () => {
  const { code, expiresAt } = signFamilyInviteCode('19');
  assert.match(code, /^f1\.19\.[0-9a-z]+\.[A-Za-z0-9_-]{12}$/);
  assert.ok(code.length <= 32, code);
  assert.match(code, /^[A-Za-z0-9_.-]+$/);
  assert.ok(new Date(expiresAt).getTime() > Date.now());
  assert.deepEqual(verifyFamilyInviteCode(code), { projectId: '19', expiresAt });
});

test('a family invite code expires and rejects a tampered project', () => {
  const now = Date.now();
  const { code } = signFamilyInviteCode('19', { now });
  assert.ok(verifyFamilyInviteCode(code, { now }));
  assert.equal(
    verifyFamilyInviteCode(code, { now: now + FAMILY_INVITE_CODE_TTL_SECONDS * 1000 + 1000 }),
    null,
  );
  const swapped = code.replace('f1.19.', 'f1.20.');
  assert.equal(verifyFamilyInviteCode(swapped), null);
  assert.equal(verifyFamilyInviteCode(code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A')), null);
});

test('an unrelated or malformed value is not an invitation', () => {
  assert.equal(verifyFamilyInviteCode(''), null);
  assert.equal(verifyFamilyInviteCode('signed-jwt-card'), null);
  assert.equal(verifyFamilyInviteCode('f1.0.zzzzzz.abcdefghijkl'), null);
});

test('project identifiers that would overflow the scene are refused', () => {
  assert.throws(() => signFamilyInviteCode('1234567890'));
  assert.throws(() => signFamilyInviteCode('project-19'));
});
