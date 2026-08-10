import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProfileAvatarSignature,
  decodeManagedAvatarReference,
  encodeManagedAvatarReference,
  resolveProfileAvatarUrl,
  verifyProfileAvatarSignature,
} from '@/lib/miniprogram-profile';

test('managed profile avatar references round-trip without exposing storage details in URLs', () => {
  const encoded = encodeManagedAvatarReference({
    provider: 'local',
    objectKey: 'profile-avatars/12/avatar.webp',
    mimeType: 'image/webp',
  });
  assert.match(encoded, /^sfp-avatar:v1:/);
  assert.deepEqual(decodeManagedAvatarReference(encoded), {
    provider: 'local',
    objectKey: 'profile-avatars/12/avatar.webp',
    bucket: undefined,
    mimeType: 'image/webp',
  });
  const url = resolveProfileAvatarUrl({
    request: new Request('https://api.example.com/api/miniprogram/profile'),
    userId: '12',
    avatar: encoded,
  });
  assert.match(url, /^https:\/\/api\.example\.com\/api\/miniprogram\/profile\/avatar\/12\?/);
  assert.doesNotMatch(url, /profile-avatars/);
});

test('profile avatar signatures reject expiry and tampering', () => {
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signature = createProfileAvatarSignature('12', expires);
  assert.equal(
    verifyProfileAvatarSignature({ userId: '12', expires, signature }),
    true
  );
  assert.equal(
    verifyProfileAvatarSignature({ userId: '13', expires, signature }),
    false
  );
  assert.equal(
    verifyProfileAvatarSignature({
      userId: '12',
      expires: Math.floor(Date.now() / 1000) - 1,
      signature: createProfileAvatarSignature(
        '12',
        Math.floor(Date.now() / 1000) - 1
      ),
    }),
    false
  );
});

test('legacy avatar URLs remain directly readable', () => {
  const legacy = 'https://images.example.com/avatar.jpg';
  assert.equal(decodeManagedAvatarReference(legacy), null);
  assert.equal(
    resolveProfileAvatarUrl({
      request: new Request('https://api.example.com/api/miniprogram/profile'),
      userId: '12',
      avatar: legacy,
    }),
    legacy
  );
});
