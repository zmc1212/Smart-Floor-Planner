import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signMiniProgramToken, signFamilyInvite, verifyFamilyInvite } from '@/lib/miniprogram-jwt';

test('family invite round-trips and stays scoped to one project and owner', async () => {
  const invite = await signFamilyInvite({ projectId: '19', ownerId: '7', enterpriseId: '3' });
  const payload = await verifyFamilyInvite(invite.token);
  assert.equal(payload?.kind, 'construction-family-invite');
  assert.equal(payload?.projectId, '19');
  assert.equal(payload?.ownerId, '7');
  assert.equal(payload?.enterpriseId, '3');
  assert.ok(payload?.jti);
  assert.ok(new Date(invite.expiresAt).getTime() > Date.now());
});

test('tampered or unrelated tokens are rejected', async () => {
  const invite = await signFamilyInvite({ projectId: '19', ownerId: '7', enterpriseId: '3' });
  const [header, body, signature] = invite.token.split('.');
  const changed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  changed.projectId = '20';
  const tampered = [header, Buffer.from(JSON.stringify(changed)).toString('base64url'), signature].join('.');
  assert.equal(await verifyFamilyInvite(tampered), null);
  assert.equal(await verifyFamilyInvite(invite.token + 'x'), null);

  const session = await signMiniProgramToken({
    sub: '7', id: '7', mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat',
  });
  assert.equal(await verifyFamilyInvite(session), null);
});
