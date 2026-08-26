import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AdminUserRecord, EnterpriseRecord } from '@/db/repositories';
import {
  buildProfessionalProfile,
  publicProfessionalProfile,
} from '@/lib/professional-profile';

const currentYear = new Date().getFullYear();

function enterprise(overrides: Partial<EnterpriseRecord> = {}) {
  return {
    professionalDesignerTitle: '金牌家装设计顾问',
    professionalMeasurerTitle: '资深家装现场顾问',
    professionalDefaultExperienceYears: 7,
    professionalServiceThreshold: 100,
    professionalForceEnterpriseProfile: true,
    professionalTitleVisibilityPolicy: 'follow_staff',
    ...overrides,
  } as EnterpriseRecord;
}

function staff(overrides: Partial<AdminUserRecord> = {}) {
  return {
    role: 'designer',
    professionalTitle: '',
    professionalCareerStartYear: null,
    professionalTitleVisible: true,
    professionalTitleAdminOverride: '',
    professionalProfileLocked: false,
    professionalShowActualServiceCount: false,
    ...overrides,
  } as AdminUserRecord;
}

test('客户侧在 0、50、100 人时只显示企业 100+ 背书', () => {
  for (const count of [0, 50, 100]) {
    const profile = buildProfessionalProfile({
      enterprise: enterprise(),
      staff: staff({ professionalShowActualServiceCount: true }),
      actualServiceCount: count,
    });
    assert.ok(profile);
    assert.equal(profile.serviceLabel, '已免费服务客户100+');
    assert.equal(profile.serviceCountMode, 'enterprise_default');
    assert.equal(profile.canShowActualServiceCount, false);
  }
});

test('真实人数超过门槛后，仅在员工开启时展示准确数字', () => {
  const hidden = buildProfessionalProfile({
    enterprise: enterprise(),
    staff: staff(),
    actualServiceCount: 101,
  });
  assert.equal(hidden?.serviceLabel, '已免费服务客户100+');

  for (const count of [101, 137]) {
    const profile = buildProfessionalProfile({
      enterprise: enterprise(),
      staff: staff({ professionalShowActualServiceCount: true }),
      actualServiceCount: count,
    });
    assert.equal(profile?.serviceLabel, `已免费服务${count}位客户`);
    assert.equal(profile?.serviceCountMode, 'actual');
  }
});

test('企业强制显示和强制隐藏覆盖员工显示开关', () => {
  const shown = buildProfessionalProfile({
    enterprise: enterprise({ professionalTitleVisibilityPolicy: 'force_show' }),
    staff: staff({ professionalTitleVisible: false }),
    actualServiceCount: 0,
  });
  assert.equal(shown?.titleVisible, true);
  assert.equal(shown?.title, '金牌家装设计顾问');

  const hidden = buildProfessionalProfile({
    enterprise: enterprise({ professionalTitleVisibilityPolicy: 'force_hide' }),
    staff: staff({
      professionalTitleVisible: true,
      professionalTitleAdminOverride: '首席空间家装设计顾问',
    }),
    actualServiceCount: 137,
  });
  assert.equal(hidden?.titleVisible, false);
  assert.equal(hidden?.title, null);
  assert.equal(hidden?.experienceLabel, '7年设计经验');
  assert.equal(hidden?.serviceLabel, '已免费服务客户100+');
});

test('单员工管理员头衔最高优先，员工资料仅在企业未统一时生效', () => {
  const adminOverride = buildProfessionalProfile({
    enterprise: enterprise(),
    staff: staff({
      professionalTitle: '全案家装设计顾问',
      professionalTitleAdminOverride: '首席设计顾问',
    }),
    actualServiceCount: 0,
  });
  assert.equal(adminOverride?.title, '首席设计顾问');
  assert.equal(adminOverride?.titleSource, 'admin_override');

  const selfConfigured = buildProfessionalProfile({
    enterprise: enterprise({ professionalForceEnterpriseProfile: false }),
    staff: staff({
      professionalTitle: '全案家装设计顾问',
      professionalCareerStartYear: currentYear - 9,
    }),
    actualServiceCount: 0,
  });
  assert.equal(selfConfigured?.title, '全案家装设计顾问');
  assert.equal(selfConfigured?.titleSource, 'staff');
  assert.equal(selfConfigured?.experienceLabel, '9年设计经验');
  assert.equal(selfConfigured?.experienceSource, 'staff');
});

test('企业录入的默认头衔按原文展示，不改写岗位词', () => {
  const designerProfile = buildProfessionalProfile({
    enterprise: enterprise({
      professionalDesignerTitle: '金牌设计师',
      professionalForceEnterpriseProfile: true,
    }),
    staff: staff(),
    actualServiceCount: 0,
  });
  assert.equal(designerProfile?.title, '金牌设计师');

  const measurerProfile = buildProfessionalProfile({
    enterprise: enterprise({
      professionalMeasurerTitle: '资深施工监理',
      professionalForceEnterpriseProfile: true,
    }),
    staff: staff({ role: 'measurer' }),
    actualServiceCount: 0,
  });
  assert.equal(measurerProfile?.title, '资深施工监理');
});

test('同一员工出现在测量员卡时使用测量员默认头衔和量房经验', () => {
  const profile = buildProfessionalProfile({
    enterprise: enterprise({
      professionalDesignerTitle: '金牌设计师',
      professionalMeasurerTitle: '资深施工监理',
      professionalForceEnterpriseProfile: true,
    }),
    staff: staff({ role: 'designer' }),
    actualServiceCount: 0,
    displayRole: 'measurer',
  });
  assert.equal(profile?.role, 'measurer');
  assert.equal(profile?.title, '资深施工监理');
  assert.equal(profile?.experienceLabel, '7年量房经验');
  assert.equal(profile?.titleSource, 'enterprise');
});

test('家装现场顾问使用量房经验文案，公开对象不泄露真实服务人数', () => {
  const profile = buildProfessionalProfile({
    enterprise: enterprise(),
    staff: staff({ role: 'measurer' }),
    actualServiceCount: 50,
  });
  assert.equal(profile?.title, '资深家装现场顾问');
  assert.equal(profile?.experienceLabel, '7年量房经验');

  const publicProfile = publicProfessionalProfile(profile);
  assert.ok(publicProfile);
  assert.equal('actualServiceCount' in publicProfile, false);
  assert.deepEqual(Object.keys(publicProfile).sort(), [
    'experienceLabel',
    'serviceCountMode',
    'serviceLabel',
    'title',
    'titleVisible',
  ]);
});
