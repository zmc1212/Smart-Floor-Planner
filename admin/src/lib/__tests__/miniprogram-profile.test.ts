import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProfileAvatarSignature,
  decodeManagedAvatarReference,
  encodeManagedAvatarReference,
  resolveProfileAvatarUrl,
  serializeMiniProgramProfile,
  verifyProfileAvatarSignature,
} from '@/lib/miniprogram-profile';

test('referrer profile keeps the current display name and role from the signed context', () => {
  const profile = serializeMiniProgramProfile({
    request: new Request('https://api.example.com/api/miniprogram/profile'),
    context: {
      mode: 'referrer',
      referrerMembershipId: '9',
      enterpriseId: '7',
      enterprise: { _id: '7', name: '示例企业', code: 'demo' },
      staff: null,
      user: { _id: '12', nickname: '我设置的姓名', phone: '13800138000' },
    } as any,
  });

  assert.equal(profile.name, '我设置的姓名');
  assert.equal(profile.role, 'referrer');
  assert.equal(profile.roleLabel, '推广人');
  assert.equal(profile.isStaff, false);
});

test('managed profile avatar references round-trip without exposing storage details in URLs', () => {
  const encoded = encodeManagedAvatarReference({
    provider: 'local',
    objectKey: 'profile-avatars/12/avatar.jpg',
    mimeType: 'image/jpeg',
  });
  assert.match(encoded, /^sfp-avatar:v1:/);
  assert.deepEqual(decodeManagedAvatarReference(encoded), {
    provider: 'local',
    objectKey: 'profile-avatars/12/avatar.jpg',
    bucket: undefined,
    mimeType: 'image/jpeg',
  });
  const url = resolveProfileAvatarUrl({
    request: new Request('https://smartfloor.zlyun168.com/api/miniprogram/profile'),
    userId: '12',
    avatar: encoded,
  });
  assert.match(url, /^https:\/\/smartfloor\.zlyun168\.com\/api\/miniprogram\/profile\/avatar\/12\?/);
  assert.doesNotMatch(url, /profile-avatars/);
});

test('placeholder public origins fall back when resolving profile avatar URLs', () => {
  const previous = process.env.MINIPROGRAM_API_PUBLIC_ORIGIN;
  const encoded = encodeManagedAvatarReference({
    provider: 'local',
    objectKey: 'profile-avatars/12/avatar.jpg',
    mimeType: 'image/jpeg',
  });
  try {
    process.env.MINIPROGRAM_API_PUBLIC_ORIGIN = 'https://api.example.com';
    const url = resolveProfileAvatarUrl({
      request: new Request('http://192.168.10.111:3006/api/miniprogram/profile'),
      userId: '12',
      avatar: encoded,
    });
    assert.match(
      url,
      /^http:\/\/192\.168\.10\.111:3006\/api\/miniprogram\/profile\/avatar\/12\?/
    );
  } finally {
    if (previous === undefined) delete process.env.MINIPROGRAM_API_PUBLIC_ORIGIN;
    else process.env.MINIPROGRAM_API_PUBLIC_ORIGIN = previous;
  }
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
