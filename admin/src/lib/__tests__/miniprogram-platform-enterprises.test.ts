import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { EnterpriseRecord } from '@/db/repositories';
import type { MiniProgramContext } from '@/lib/miniprogram-auth';
import {
  escapeIlikePattern,
  isMiniProgramPlatformAdmin,
  parsePlatformAdminActorId,
  parsePlatformEnterpriseListQuery,
  parsePlatformEnterpriseListStatus,
  platformEnterpriseSearchTerms,
  toPlatformEnterpriseReviewDto,
} from '@/lib/miniprogram-platform-enterprises';

const adminSrc = join(process.cwd(), 'src');

function source(relativePath: string) {
  return readFileSync(join(adminSrc, relativePath), 'utf8');
}

function sampleEnterprise(
  overrides: Partial<EnterpriseRecord> = {}
): EnterpriseRecord {
  return {
    id: 41n,
    name: '杭州市西湖装修有限公司',
    code: '91330100MA2EXAMPLE',
    status: 'pending_approval',
    registrationMode: 'self_service',
    contactPerson: { name: '王经理', phone: '13800138000' },
    address: '杭州市西湖区',
    industry: '装修',
    description: 'secret ops note',
    logo: null,
    branding: { primaryColor: '#00c365' },
    professionalDesignerTitle: '金牌家装设计顾问',
    professionalMeasurerTitle: '资深家装现场顾问',
    professionalDefaultExperienceYears: 7,
    professionalServiceThreshold: 100,
    professionalForceEnterpriseProfile: false,
    professionalTitleVisibilityPolicy: 'follow_staff',
    groundPromotionFixedCommission: '0',
    automationConfig: { followUpSlaHours: 24 },
    aiConfig: { provider: 'hidden', pollinationsKeyRef: 'secret-key' },
    aiPolicy: { keyMode: 'platform' },
    statusReason: null,
    statusChangedAt: null,
    statusChangedByAdminId: null,
    sensitiveOperationPasswordHash: 'hash',
    referrerAdditionalEnterpriseLimit: 3,
    createdAt: new Date('2026-08-20T02:00:00.000Z'),
    updatedAt: new Date('2026-08-20T02:00:00.000Z'),
    ...overrides,
  } as EnterpriseRecord;
}

test('platform enterprise list status defaults to pending_approval and accepts all', () => {
  assert.deepEqual(parsePlatformEnterpriseListStatus(null), {
    status: 'pending_approval',
  });
  assert.deepEqual(parsePlatformEnterpriseListStatus(''), {
    status: 'pending_approval',
  });
  assert.deepEqual(parsePlatformEnterpriseListStatus('pending_approval'), {
    status: 'pending_approval',
  });
  assert.deepEqual(parsePlatformEnterpriseListStatus('all'), { status: null });
  assert.deepEqual(parsePlatformEnterpriseListStatus('rejected'), {
    status: 'rejected',
  });
  assert.deepEqual(parsePlatformEnterpriseListStatus('disabled'), {
    status: 'disabled',
  });
  assert.deepEqual(parsePlatformEnterpriseListStatus('mystery'), {
    error: '不支持的企业状态筛选',
  });
});

test('platform enterprise list query trims, caps length, and extracts phone digits', () => {
  assert.deepEqual(parsePlatformEnterpriseListQuery(null), { q: null });
  assert.deepEqual(parsePlatformEnterpriseListQuery('  '), { q: null });
  assert.deepEqual(parsePlatformEnterpriseListQuery(' 西湖装修 '), { q: '西湖装修' });
  assert.equal(parsePlatformEnterpriseListQuery('x'.repeat(80)).q?.length, 64);
  assert.equal(escapeIlikePattern('100%_off\\'), '100\\%\\_off\\\\');
  assert.deepEqual(platformEnterpriseSearchTerms('西湖'), {
    text: '西湖',
    digits: null,
  });
  assert.deepEqual(platformEnterpriseSearchTerms('138-0013-8000'), {
    text: '138-0013-8000',
    digits: '13800138000',
  });
  assert.deepEqual(platformEnterpriseSearchTerms('12'), {
    text: '12',
    digits: null,
  });
});

test('Mini platform review role matrix allows only admin and super_admin', () => {
  assert.equal(isMiniProgramPlatformAdmin('admin'), true);
  assert.equal(isMiniProgramPlatformAdmin('super_admin'), true);
  for (const role of [
    'enterprise_admin',
    'designer',
    'measurer',
    'salesperson',
    'viewer',
    'customer',
    'referrer',
    null,
    undefined,
    '',
  ]) {
    assert.equal(isMiniProgramPlatformAdmin(role), false, String(role));
  }
});

test('Mini platform status actor id is the signed staff._id', () => {
  assert.equal(
    parsePlatformAdminActorId({
      staff: { _id: '12' },
    } as unknown as MiniProgramContext),
    12n
  );
  assert.throws(
    () => parsePlatformAdminActorId({} as unknown as MiniProgramContext),
    /actor admin id must be a positive PostgreSQL bigint/
  );
});

test('platform enterprise review DTO keeps contact facts and omits secrets', () => {
  const dto = toPlatformEnterpriseReviewDto(sampleEnterprise(), [
    {
      id: 9n,
      enterpriseId: 41n,
      fromStatus: 'pending_approval',
      toStatus: 'rejected',
      action: 'reject',
      reason: '信用代码无法核验',
      actorAdminId: 7n,
      createdAt: new Date('2026-08-21T04:00:00.000Z'),
    },
  ]);
  assert.equal(dto._id, '41');
  assert.equal(dto.name, '杭州市西湖装修有限公司');
  assert.equal(dto.registrationMode, 'self_service');
  assert.deepEqual(dto.contactPerson, {
    name: '王经理',
    phone: '13800138000',
  });
  assert.deepEqual(dto.allowedActions, ['approve', 'reject']);
  assert.deepEqual(dto.statusEvents, [
    {
      _id: '9',
      fromStatus: 'pending_approval',
      toStatus: 'rejected',
      action: 'reject',
      reason: '信用代码无法核验',
      createdAt: new Date('2026-08-21T04:00:00.000Z'),
    },
  ]);
  assert.equal('aiConfig' in dto, false);
  assert.equal('automationConfig' in dto, false);
  assert.equal('aiPolicy' in dto, false);
  assert.equal('description' in dto, false);
  assert.equal('address' in dto, false);
  assert.equal('branding' in dto, false);
  assert.equal('sensitiveOperationPasswordHash' in dto, false);
  assert.equal('referrerAdditionalEnterpriseLimit' in dto, false);
  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes('secret-key'), false);
  assert.equal(serialized.includes('secret ops note'), false);
  assert.equal(serialized.includes('pollinations'), false);
  assert.equal(serialized.includes('actorAdminId'), false);

  const listDto = toPlatformEnterpriseReviewDto(sampleEnterprise());
  assert.equal('statusEvents' in listDto, false);
  assert.equal('aiConfig' in listDto, false);
  assert.deepEqual(Object.keys(listDto).sort(), [
    '_id',
    'allowedActions',
    'code',
    'contactPerson',
    'createdAt',
    'name',
    'registrationMode',
    'status',
    'statusChangedAt',
    'statusReason',
  ]);
});

test('Mini platform enterprise routes require platform admin JWT and reuse the shared status helper', () => {
  const listRoute = source('app/api/miniprogram/platform/enterprises/route.ts');
  const detailRoute = source(
    'app/api/miniprogram/platform/enterprises/[id]/route.ts'
  );
  const statusRoute = source(
    'app/api/miniprogram/platform/enterprises/[id]/status/route.ts'
  );

  for (const route of [listRoute, detailRoute, statusRoute]) {
    assert.match(route, /resolveMiniProgramPlatformAdmin/);
    assert.match(route, /platformAdminForbiddenResponse/);
    assert.doesNotMatch(route, /withTenantRoute/);
    assert.doesNotMatch(route, /aud=miniprogram/);
  }

  assert.match(listRoute, /parsePlatformEnterpriseListStatus/);
  assert.match(listRoute, /parsePlatformEnterpriseListQuery/);
  assert.match(listRoute, /listForPlatformReview/);
  assert.match(listRoute, /toPlatformEnterpriseReviewDto/);
  assert.match(detailRoute, /listStatusEvents/);
  assert.match(statusRoute, /applyEnterpriseStatusChange/);
  assert.match(statusRoute, /parsePlatformAdminActorId/);
  assert.match(statusRoute, /enterpriseStatusChangeErrorResponse/);
  assert.doesNotMatch(statusRoute, /applyStatusAction/);
  assert.doesNotMatch(statusRoute, /ensureEnterpriseAdminForActiveEnterprise/);
  assert.doesNotMatch(statusRoute, /notifyEnterpriseContactOfJoinResult/);
});

test('platform admin helper treats only admin and super_admin as Mini reviewers', () => {
  const helper = source('lib/miniprogram-platform-enterprises.ts');
  assert.match(
    helper,
    /role === 'super_admin' \|\| role === 'admin'/
  );
  assert.match(helper, /需要平台管理员身份/);
  assert.match(helper, /parsePostgresId\(context\.staff\?._id, 'actor admin id'\)/);
});

test('Mini platform registration-code routes are read-only and omit the token', () => {
  const metaRoute = source(
    'app/api/miniprogram/platform/enterprise-registration-code/route.ts'
  );
  const imageRoute = source(
    'app/api/miniprogram/platform/enterprise-registration-code/image/route.ts'
  );
  const helper = source('lib/enterprise-registration-code-image.ts');
  const repository = source('db/repositories/enterprise-repository.ts');

  for (const route of [metaRoute, imageRoute]) {
    assert.match(route, /resolveMiniProgramPlatformAdmin/);
    assert.match(route, /platformAdminForbiddenResponse/);
    assert.doesNotMatch(route, /withTenantRoute/);
    assert.doesNotMatch(route, /\.rotate\(/);
    assert.doesNotMatch(route, /\.disable\(/);
  }

  assert.match(metaRoute, /getActiveCode/);
  assert.match(metaRoute, /enterpriseRegistrationCodeToDto/);
  assert.doesNotMatch(metaRoute, /token:/);
  assert.match(imageRoute, /loadActiveEnterpriseRegistrationCodeImage/);
  assert.match(imageRoute, /loadActiveEnterpriseRegistrationCodePoster/);
  assert.match(imageRoute, /parseVariant/);
  assert.match(imageRoute, /parsePlatformAdminActorId/);
  assert.match(helper, /revealActive/);
  assert.match(helper, /createEnterpriseRegistrationCode/);
  assert.match(helper, /getPlatformMiniProgramCodeConfig/);
  assert.match(helper, /envVersion:\s*environment/);
  assert.match(helper, /Cache-Control': 'private, no-store/);
  assert.match(helper, /image: Uint8Array/);
  assert.match(helper, /new Uint8Array\(result\.image\)/);
  assert.doesNotMatch(helper, /\.rotate\(/);
  assert.match(repository, /listForPlatformReview/);
  assert.match(repository, /contactPerson\}\s*->>\s*'phone'/);
  const adminImage = source(
    'app/api/admin/enterprise-registration-codes/image/route.ts'
  );
  assert.match(adminImage, /loadActiveEnterpriseRegistrationCodeImage/);
  assert.match(adminImage, /loadActiveEnterpriseRegistrationCodePoster/);
  assert.match(adminImage, /parseVariant/);
  assert.doesNotMatch(adminImage, /\.rotate\(/);
});

test('platform admin badges load pending_approval into counts.review', () => {
  const badges = source('lib/miniprogram-badges.ts');
  assert.match(badges, /role === 'platform_admin'/);
  assert.match(badges, /countByStatus\('pending_approval'\)/);
  assert.match(badges, /counted\('review'/);
  assert.match(badges, /reviewPendingCount/);
});
