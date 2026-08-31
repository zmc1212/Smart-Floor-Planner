import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  openPendingClaimSource,
  openPendingReferralSource,
  sealPendingReferralSource,
  sealPendingStaffActivitySource,
} from '@/lib/referral-attribution';
import { resetWechatAccessTokenCacheForTests } from '@/lib/wechat-access-token';
import { normalizePlatformMiniProgramCodeConfig } from '@/lib/platform-mini-program-code-config';
import {
  buildEnterpriseOnboardingPath,
  buildPromotionServicePath,
  buildStaffActivityServicePath,
  createEnterpriseOnboardingCode,
  createPromotionServiceCode,
  createStaffActivityServiceCode,
  ENTERPRISE_ONBOARDING_PAGE,
  getMiniProgramCodeContentType,
  PROMOTION_SERVICE_PAGE,
  resolveMiniProgramCodeEnvironment,
} from '@/lib/wechat-miniprogram-code';

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
    kind: 'referrer',
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

test('pending staff activity sources are opaque and open through the claim union', () => {
  const now = new Date('2026-08-17T00:00:00.000Z');
  const token = sealPendingStaffActivitySource(
    {
      activityCodeId: BigInt(31),
      staffId: BigInt(41),
      enterpriseId: BigInt(51),
      version: 2,
    },
    { now, ttlSeconds: 600 }
  );

  assert.match(token, /^pas_[A-Za-z0-9_-]+$/);
  const packed = Buffer.from(token.slice(4), 'base64url').toString('utf8');
  assert.equal(packed.includes('"s":"41"'), false);

  const opened = openPendingClaimSource(token, {
    now: new Date('2026-08-17T00:09:59.000Z'),
  });
  assert.deepEqual(opened, {
    kind: 'staff_activity',
    activityCodeId: BigInt(31),
    staffId: BigInt(41),
    enterpriseId: BigInt(51),
    version: 2,
    expiresAt: new Date('2026-08-17T00:10:00.000Z'),
    expired: false,
  });
});

test('promotion service codes use the anonymous claim route and real WeChat image bytes', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  resetWechatAccessTokenCacheForTests();

  const token = `rp_${'A'.repeat(32)}`;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/cgi-bin/stable_token')) {
      return new Response(
        JSON.stringify({ access_token: 'wechat_access_token', expires_in: 7200 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;

  try {
    assert.equal(
      buildPromotionServicePath(token),
      `${PROMOTION_SERVICE_PAGE}?token=${token}`
    );
    const bytes = await createPromotionServiceCode(token, { fetchImpl });
    assert.deepEqual([...bytes], [...png]);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/wxa\/getwxacodeunlimit\?/);
    const body = JSON.parse(String(calls[1].init?.body));
    assert.equal(body.scene, 'A'.repeat(32));
    assert.equal(body.page, PROMOTION_SERVICE_PAGE);
    assert.equal(body.env_version, 'develop');
    assert.equal(body.check_path, false);
    assert.equal(body.width, 430);
    assert.deepEqual(body.line_color, { r: 8, g: 137, b: 57 });
    assert.equal(JSON.stringify(body).includes('enterprise'), false);
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});

test('staff activity service codes reuse the claim route and real WeChat image bytes', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  resetWechatAccessTokenCacheForTests();

  const token = `sa_${'C'.repeat(32)}`;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/cgi-bin/stable_token')) {
      return new Response(
        JSON.stringify({ access_token: 'wechat_access_token', expires_in: 7200 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;

  try {
    assert.equal(
      buildStaffActivityServicePath(token),
      `${PROMOTION_SERVICE_PAGE}?token=${token}`
    );
    const bytes = await createStaffActivityServiceCode(token, { fetchImpl });
    assert.deepEqual([...bytes], [...png]);
    const body = JSON.parse(String(calls[1].init?.body));
    assert.equal(body.scene, 'C'.repeat(32));
    assert.equal(body.page, PROMOTION_SERVICE_PAGE);
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});

test('enterprise onboarding codes use the dedicated Mini Program route and real WeChat image bytes', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  resetWechatAccessTokenCacheForTests();

  const token = `ej_${'B'.repeat(32)}`;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/cgi-bin/stable_token')) {
      return new Response(
        JSON.stringify({ access_token: 'wechat_access_token', expires_in: 7200 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;

  try {
    assert.equal(
      buildEnterpriseOnboardingPath(token),
      `${ENTERPRISE_ONBOARDING_PAGE}?token=${token}`
    );
    const bytes = await createEnterpriseOnboardingCode(token, { fetchImpl });
    assert.deepEqual([...bytes], [...png]);
    assert.match(calls[1].url, /\/wxa\/getwxacodeunlimit\?/);
    const body = JSON.parse(String(calls[1].init?.body));
    assert.equal(body.scene, 'B'.repeat(32));
    assert.equal(body.page, ENTERPRISE_ONBOARDING_PAGE);
    assert.equal(body.env_version, 'develop');
    assert.equal(body.check_path, false);
    assert.equal(body.width, 430);
    assert.deepEqual(body.line_color, { r: 8, g: 137, b: 57 });
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});

test('WeChat JPEG Mini Program code bytes are accepted and preserve their media type', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  resetWechatAccessTokenCacheForTests();

  const token = `ej_${'C'.repeat(32)}`;
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const fetchImpl = (async (input: string | URL | Request) => {
    if (String(input).includes('/cgi-bin/stable_token')) {
      return new Response(
        JSON.stringify({ access_token: 'wechat_access_token', expires_in: 7200 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(jpeg, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    });
  }) as typeof fetch;

  try {
    const bytes = await createEnterpriseOnboardingCode(token, { fetchImpl });
    assert.deepEqual([...bytes], [...jpeg]);
    assert.equal(getMiniProgramCodeContentType(bytes), 'image/jpeg');
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});

test('Mini Program codes use getwxacode with full path when env is release', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  const previousCodeEnv = process.env.WECHAT_MINIPROGRAM_CODE_ENV;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  process.env.WECHAT_MINIPROGRAM_CODE_ENV = 'release';
  resetWechatAccessTokenCacheForTests();

  const token = `ej_${'D'.repeat(32)}`;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/cgi-bin/stable_token')) {
      return new Response(
        JSON.stringify({ access_token: 'wechat_access_token', expires_in: 7200 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;

  try {
    await createEnterpriseOnboardingCode(token, { fetchImpl });
    assert.match(calls[1].url, /\/wxa\/getwxacode\?/);
    assert.doesNotMatch(calls[1].url, /getwxacodeunlimit/);
    const body = JSON.parse(String(calls[1].init?.body));
    assert.equal(body.path, `${ENTERPRISE_ONBOARDING_PAGE}?token=${token}`);
    assert.equal(body.scene, undefined);
    assert.equal(body.env_version, undefined);
    assert.equal(body.width, 430);
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
    if (previousCodeEnv === undefined) delete process.env.WECHAT_MINIPROGRAM_CODE_ENV;
    else process.env.WECHAT_MINIPROGRAM_CODE_ENV = previousCodeEnv;
  }
});

test('resolveMiniProgramCodeEnvironment respects explicit, env var, and NODE_ENV fallbacks', () => {
  const previousCodeEnv = process.env.WECHAT_MINIPROGRAM_CODE_ENV;
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    assert.equal(resolveMiniProgramCodeEnvironment('release'), 'release');
    assert.equal(resolveMiniProgramCodeEnvironment('trial'), 'trial');
    assert.equal(resolveMiniProgramCodeEnvironment('develop'), 'develop');
    assert.equal(resolveMiniProgramCodeEnvironment('invalid'), 'develop');

    process.env.WECHAT_MINIPROGRAM_CODE_ENV = 'trial';
    assert.equal(resolveMiniProgramCodeEnvironment(), 'trial');
    assert.equal(resolveMiniProgramCodeEnvironment(null), 'trial');
    assert.equal(resolveMiniProgramCodeEnvironment('release'), 'release');

    delete process.env.WECHAT_MINIPROGRAM_CODE_ENV;
    process.env.NODE_ENV = 'production';
    assert.equal(resolveMiniProgramCodeEnvironment(), 'release');

    process.env.NODE_ENV = 'development';
    assert.equal(resolveMiniProgramCodeEnvironment(), 'develop');
  } finally {
    if (previousCodeEnv === undefined) delete process.env.WECHAT_MINIPROGRAM_CODE_ENV;
    else process.env.WECHAT_MINIPROGRAM_CODE_ENV = previousCodeEnv;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('platform code environment only accepts the three WeChat deployment targets', () => {
  assert.deepEqual(normalizePlatformMiniProgramCodeConfig(), { environment: 'develop' });
  assert.deepEqual(normalizePlatformMiniProgramCodeConfig({ environment: 'trial' }), { environment: 'trial' });
  assert.deepEqual(normalizePlatformMiniProgramCodeConfig({ environment: 'release' }), { environment: 'release' });
  assert.deepEqual(normalizePlatformMiniProgramCodeConfig({ environment: 'invalid' as never }), { environment: 'develop' });
});

test('all Mini Program code image endpoints read the single platform environment', () => {
  const routes = [
    'src/app/api/enterprise/join-codes/[type]/image/route.ts',
    'src/app/api/miniprogram/enterprise-join-codes/[type]/image/route.ts',
    'src/app/api/miniprogram/referrer-memberships/[id]/promotion-code/image/route.ts',
    'src/app/api/miniprogram/staff-activity-code/image/route.ts',
    'src/lib/enterprise-registration-code-image.ts',
  ];

  for (const routePath of routes) {
    const route = readFileSync(path.join(process.cwd(), routePath), 'utf8');
    assert.match(route, /getPlatformMiniProgramCodeConfig/);
    assert.match(route, /envVersion:\s*environment/);
  }
});

test('promotion code image route keeps provider failures stable and private', () => {
  const route = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/miniprogram/referrer-memberships/[id]/promotion-code/image/route.ts'
    ),
    'utf8'
  );

  assert.match(route, /invalid_membership_id[\s\S]*status:\s*400/);
  assert.match(route, /promotion_code_lookup_failed[\s\S]*status:\s*500/);
  assert.match(route, /wechat_code_unavailable[\s\S]*status:\s*502/);
  assert.doesNotMatch(route, /error:\s*error\s+instanceof\s+Error/);
});

test('miniprogram enterprise join-code routes separate owner staff codes from personal referrer codes', () => {
  const route = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/miniprogram/enterprise-join-codes/[type]/image/route.ts'
    ),
    'utf8'
  );
  const list = readFileSync(
    path.join(process.cwd(), 'src/app/api/miniprogram/enterprise-join-codes/route.ts'),
    'utf8'
  );

  assert.match(list, /requireMiniProgramReferrerNetwork/);
  assert.match(list, /const isOwner = role === 'enterprise_admin'/);
  assert.match(list, /referrerInviterStaffId:\s*staffId/);
  assert.match(list, /const visibleTypes = isOwner/);
  assert.match(list, /canManageStaffCodes:\s*isOwner/);
  assert.doesNotMatch(list, /enterprise_admin_required/);
  assert.match(list, /listEnterpriseJoinCodes/);
  assert.match(list, /createEnterpriseJoinToken/);
  assert.match(list, /token:\s*active\s*\?\s*createEnterpriseJoinToken/);
  assert.match(route, /enterprise_admin_required/);
  assert.match(route, /if \(type === 'staff' && role !== 'enterprise_admin'\)/);
  assert.match(route, /revealActiveEnterpriseJoinCode/);
  assert.match(route, /createEnterpriseOnboardingCode/);
  assert.match(route, /wechat_code_unavailable[\s\S]*status:\s*502/);
  assert.match(route, /Cache-Control': 'private, no-store/);
});

test('legacy Admin join-code endpoints use the explicit enterprise-level referrer scope', () => {
  const routePaths = [
    'src/app/api/enterprise/join-codes/route.ts',
    'src/app/api/enterprise/referrer-network-readiness/route.ts',
    'src/app/api/enterprise/join-codes/[type]/rotate/route.ts',
    'src/app/api/enterprise/join-codes/[type]/disable/route.ts',
    'src/app/api/enterprise/join-codes/[type]/image/route.ts',
  ];

  for (const [index, routePath] of routePaths.entries()) {
    const source = readFileSync(path.join(process.cwd(), routePath), 'utf8');
    if (index < 2) {
      assert.match(source, /const referrerInviterStaffId = null/);
    } else {
      assert.match(source, /inviterStaffId:\s*null/);
    }
  }

  const list = readFileSync(
    path.join(process.cwd(), 'src/app/api/enterprise/join-codes/route.ts'),
    'utf8'
  );
  const readiness = readFileSync(
    path.join(process.cwd(), 'src/app/api/enterprise/referrer-network-readiness/route.ts'),
    'utf8'
  );
  assert.match(list, /const referrerInviterStaffId = null/);
  assert.match(readiness, /const referrerInviterStaffId = null/);
});

test('staff referrer-network migration backfills only unambiguous owners through temporary RLS policies', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'drizzle/0051_staff_referrer_network.sql'),
    'utf8'
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "inviter_staff_id"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "invited_by_staff_id"/);
  assert.match(migration, /HAVING count\(\*\) = 1/);
  assert.match(migration, /membership\.invited_by_staff_id IS NULL/);
  assert.match(
    migration,
    /CREATE POLICY "staff_referrer_network_migrator_admin_users"[\s\S]*FOR SELECT TO sfp_migrator/
  );
  assert.match(
    migration,
    /CREATE POLICY "staff_referrer_network_migrator_memberships"[\s\S]*FOR ALL TO sfp_migrator/
  );
  assert.match(
    migration,
    /DROP POLICY "staff_referrer_network_migrator_memberships"[\s\S]*DROP POLICY "staff_referrer_network_migrator_admin_users"/
  );
});

test('miniprogram enterprise join-code mutate routes mirror Admin rotate/disable', () => {
  const rotate = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/miniprogram/enterprise-join-codes/[type]/rotate/route.ts'
    ),
    'utf8'
  );
  const disable = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/miniprogram/enterprise-join-codes/[type]/disable/route.ts'
    ),
    'utf8'
  );

  assert.match(rotate, /enterprise_admin_required/);
  assert.match(rotate, /rotateEnterpriseJoinCode/);
  assert.match(rotate, /enterpriseJoinCodeToDto/);
  assert.doesNotMatch(rotate, /token:/);
  assert.match(disable, /enterprise_admin_required/);
  assert.match(disable, /disableEnterpriseJoinCode/);
  assert.match(disable, /active_code_not_found/);
  assert.doesNotMatch(disable, /token:/);
});

test('enterprise onboarding image route is tenant-protected and keeps provider failures private', () => {
  const route = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/enterprise/join-codes/[type]/image/route.ts'
    ),
    'utf8'
  );

  assert.match(route, /roles:\s*\['super_admin', 'admin', 'enterprise_admin'\]/);
  assert.match(route, /requireEnterprise:\s*true/);
  assert.match(route, /revealActiveEnterpriseJoinCode/);
  assert.match(route, /createEnterpriseOnboardingCode/);
  assert.match(route, /Cache-Control': 'private, no-store, max-age=0'/);
  assert.match(route, /wechat_code_unavailable[\s\S]*status:\s*502/);
  assert.doesNotMatch(route, /data:\s*\{[^}]*token/);
});

test('enterprise onboarding workbench accepts both WeChat image formats', () => {
  const helper = readFileSync(
    path.join(process.cwd(), 'src/components/admin/miniprogram-code-qr.tsx'),
    'utf8'
  );

  assert.match(helper, /image\.type !== 'image\/png' && image\.type !== 'image\/jpeg'/);
  assert.doesNotMatch(helper, /image\.type !== 'image\/png'\) throw new Error\('入驻二维码格式无效'\)/);
});

test('admin code pages show the current QR without rotating or a timed hide', () => {
  const joinCodes = readFileSync(
    path.join(process.cwd(), 'src/app/(admin)/(merchant)/join-codes/page.tsx'),
    'utf8'
  );
  const registration = readFileSync(
    path.join(
      process.cwd(),
      'src/app/(admin)/(platform)/enterprise-registration-codes/page.tsx'
    ),
    'utf8'
  );
  const helper = readFileSync(
    path.join(process.cwd(), 'src/components/admin/miniprogram-code-qr.tsx'),
    'utf8'
  );

  for (const page of [joinCodes, registration]) {
    assert.match(page, /MiniProgramCodeQr/);
    assert.match(page, /fetchMiniProgramCodeQr/);
    assert.match(page, /getCodeAuditEventTypeLabel/);
    assert.match(page, /getCodeAuditResultLabel/);
    assert.doesNotMatch(page, /90_000/);
    assert.doesNotMatch(page, /confirmText: '生成二维码'/);
    assert.doesNotMatch(page, /Drawer/);
    assert.doesNotMatch(page, /\{item\.result\}/);
    assert.doesNotMatch(page, /dataIndex: 'eventType', width: 140 \}/);
  }
  assert.match(joinCodes, /\/api\/enterprise\/join-codes\/\$\{codeType\}\/rotate/);
  assert.match(registration, /\/api\/admin\/enterprise-registration-codes\/rotate/);
  assert.match(helper, /method: 'POST'/);
  assert.match(helper, /当前有效二维码可直接查看/);
});

test('enterprise onboarding workbench links code-provider readiness to delivery diagnostics', () => {
  const page = readFileSync(
    path.join(
      process.cwd(),
      'src/app/(admin)/(merchant)/referrer-network-operations/page.tsx'
    ),
    'utf8'
  );

  assert.match(page, /微信小程序服务码能力[\s\S]*href: '\/workflow-logs'[\s\S]*actionLabel: '查看送达记录'/);
  assert.match(page, /getCodeAuditEventTypeLabel/);
  assert.match(page, /getCodeAuditResultLabel/);
  assert.doesNotMatch(page, /\{item\.result\}/);
  assert.doesNotMatch(page, /actionLabel: '查看通知配置'/);
});

test('enterprise onboarding readiness distinguishes active promotion codes from memberships', () => {
  const repository = readFileSync(
    path.join(process.cwd(), 'src/db/repositories/referrer-network-repository.ts'),
    'utf8'
  );
  const route = readFileSync(
    path.join(process.cwd(), 'src/app/api/enterprise/referrer-network-readiness/route.ts'),
    'utf8'
  );
  const page = readFileSync(
    path.join(
      process.cwd(),
      'src/app/(admin)/(merchant)/referrer-network-operations/page.tsx'
    ),
    'utf8'
  );

  assert.match(repository, /countActiveReferrerPromotionCodes[\s\S]*referrerPromotionCodes\.status, 'active'[\s\S]*referrerEnterpriseMemberships\.status, 'active'/);
  assert.match(route, /network\.countActiveReferrerPromotionCodes\(enterpriseId\)/);
  assert.match(page, /activeReferrerPromotionCodes/);
  assert.match(page, /活动推荐人成员关系已有服务码/);
});

test('referrer network operations workbench is a readiness hub without dual-code or roster tables', () => {
  const page = readFileSync(
    path.join(
      process.cwd(),
      'src/app/(admin)/(merchant)/referrer-network-operations/page.tsx'
    ),
    'utf8'
  );
  const sidebar = readFileSync(
    path.join(process.cwd(), 'src/components/Sidebar.tsx'),
    'utf8'
  );
  const roster = readFileSync(
    path.join(process.cwd(), 'src/app/(admin)/(merchant)/referrers/page.tsx'),
    'utf8'
  );
  const joinCodes = readFileSync(
    path.join(process.cwd(), 'src/app/api/enterprise/join-codes/route.ts'),
    'utf8'
  );

  assert.match(page, /href: '\/join-codes'/);
  assert.match(page, /href: '\/referrers'/);
  assert.doesNotMatch(page, /loadOnboardingCode/);
  assert.doesNotMatch(page, /停用后续扫码/);
  assert.match(sidebar, /title: '推荐网络'[\s\S]*href: '\/join-codes'[\s\S]*href: '\/referrers'[\s\S]*href: '\/appointment-settings'/);
  assert.match(roster, /dataIndex: 'phone'/);
  assert.match(roster, /\/api\/enterprise\/referrer-memberships/);
  assert.match(joinCodes, /codes:\s*codes\.map\(enterpriseJoinCodeToDto\)/);
  assert.match(joinCodes, /events:\s*events\.map\(enterpriseJoinCodeEventToDto\)/);
  assert.doesNotMatch(joinCodes, /token/);
});

test('enterprise join-code rotation does not return a plaintext token', () => {
  const route = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/enterprise/join-codes/[type]/rotate/route.ts'
    ),
    'utf8'
  );

  assert.match(route, /data:\s*enterpriseJoinCodeToDto\(result\.code\)/);
  assert.doesNotMatch(route, /token:\s*result\.token/);
});

test('claim resolve and authorize preserve an existing customer project instead of a new claim', () => {
  const resolve = readFileSync(
    path.join(process.cwd(), 'src/app/api/miniprogram/codes/resolve/route.ts'),
    'utf8'
  );
  const authorize = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/miniprogram/referrals/authorize-and-create-lead/route.ts'
    ),
    'utf8'
  );
  const repository = readFileSync(
    path.join(process.cwd(), 'src/db/repositories/referral-lead-repository.ts'),
    'utf8'
  );

  assert.match(repository, /async findActiveCustomerAttribution\(/);
  assert.match(repository, /releaseInactiveAttributionLocks/);
  assert.match(resolve, /findActiveCustomerAttribution/);
  assert.match(resolve, /existingAttribution:\s*true/);
  assert.match(resolve, /createdAt:\s*existing\.lead\.createdAt/);
  assert.match(resolve, /pendingSource:\s*null/);
  assert.match(authorize, /claim\.kind !== 'existing_attribution'/);
});

test('referrer onboarding requires a display name and does not fall back to a placeholder', () => {
  const route = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/miniprogram/onboarding/referrer/route.ts'
    ),
    'utf8'
  );
  const repository = readFileSync(
    path.join(process.cwd(), 'src/db/repositories/referrer-network-repository.ts'),
    'utf8'
  );

  assert.match(route, /display_name_required/);
  assert.doesNotMatch(route, /displayName \|\| authenticated\.user\.nickname/);
  assert.match(repository, /displayName !== profile\.displayName/);
  assert.match(repository, /nickname: displayName/);
});

test('onboarding code resolution returns its enterprise display name without exposing the token', () => {
  const route = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/miniprogram/codes/resolve/route.ts'
    ),
    'utf8'
  );

  assert.match(route, /EnterpriseRepository/);
  assert.match(route, /enterpriseName:\s*enterprise\?\.name\s*\?\?\s*null/);
  assert.doesNotMatch(route, /token:\s*joinCode/);
});

test('staff activity presenters include the enterprise owner for store-level acquisition', () => {
  const network = readFileSync(
    path.join(process.cwd(), 'src/db/repositories/referrer-network-repository.ts'),
    'utf8'
  );
  const leads = readFileSync(
    path.join(process.cwd(), 'src/db/repositories/referral-lead-repository.ts'),
    'utf8'
  );
  assert.match(network, /STAFF_ACTIVITY_PRESENTER_ROLES/);
  assert.match(network, /'enterprise_admin'/);
  assert.match(leads, /STAFF_ACTIVITY_PRESENTER_ROLES/);
  assert.match(leads, /enterprise_admin_activity_attribution/);
  assert.match(leads, /activitySource\?\.staff\.role === 'measurer'/);
});
