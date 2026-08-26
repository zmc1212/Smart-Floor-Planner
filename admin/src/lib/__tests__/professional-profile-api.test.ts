import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('企业和单员工背书接口保持管理员权限与租户边界', () => {
  const enterpriseRoute = source('../../app/api/professional-profile-settings/route.ts');
  const staffRoute = source('../../app/api/staff/[id]/professional-profile/route.ts');

  for (const route of [enterpriseRoute, staffRoute]) {
    assert.match(route, /withTenantRoute/);
    assert.match(route, /enterprise_admin/);
    assert.match(route, /super_admin/);
    assert.match(route, /requireEnterprise:\s*true/);
  }
  assert.match(enterpriseRoute, /serviceThreshold[\s\S]*100/);
  assert.match(staffRoute, /professionalProfileLocked/);
  assert.match(staffRoute, /canShowActualServiceCount/);
});

test('员工本人接口限制职业角色、执行锁定并阻止不合格准确人数', () => {
  const route = source('../../app/api/miniprogram/staff/professional-profile/route.ts');

  assert.match(route, /context\.mode !== 'staff'/);
  assert.match(route, /isProfessionalProfileRole/);
  assert.match(route, /professionalProfileLocked/);
  assert.match(route, /status:\s*409/);
  assert.match(route, /!currentProfile\.canShowActualServiceCount/);
});

test('历史业绩统计按客户去重，设计师归属在发布时固化', () => {
  const profileRepository = source('../../db/repositories/professional-profile-repository.ts');
  const projectRepository = source('../../db/repositories/customer-project-repository.ts');
  const migration = source('../../../drizzle/0043_staff_professional_profiles.sql');

  assert.match(profileRepository, /countDistinct\(aiGenerationPublications\.leadId\)/);
  assert.match(profileRepository, /creditedDesignerId/);
  assert.match(profileRepository, /countDistinct\(leadFloorPlans\.leadId\)/);
  assert.match(profileRepository, /measurementMode[\s\S]*surveying/);
  assert.match(projectRepository, /creditedDesignerId:\s*lead\.assignedTo/);
  assert.match(projectRepository, /coalesce\(\$\{aiGenerationPublications\.creditedDesignerId\}/);
  assert.match(migration, /assignment_event\."created_at" <= publication\."published_at"/);
});

test('客户接口仅组装公开背书对象', () => {
  const route = source('../../app/api/miniprogram/customer-projects/[leadId]/route.ts');
  const serializer = source('../professional-profile.ts');
  const repository = source('../../db/repositories/professional-profile-repository.ts');

  assert.match(route, /publicProfessionalProfile\(result\.designerProfile\)/);
  assert.match(route, /publicProfessionalProfile\(result\.measurerProfile\)/);
  assert.match(route, /findForStaff\(project\.designer\.id,\s*'designer'\)/);
  assert.match(route, /findForStaff\(project\.measurer\.id,\s*'measurer'\)/);
  assert.match(repository, /displayRole\?: ProfessionalProfileRole/);
  assert.match(repository, /displayRole:\s*role/);
  assert.match(serializer, /serviceCountMode:\s*profile\.serviceCountMode/);
  assert.doesNotMatch(serializer, /replaceAll\('设计师'/);
  const publicBlock = serializer.slice(serializer.indexOf('export function publicProfessionalProfile'));
  assert.doesNotMatch(publicBlock, /actualServiceCount:\s*profile/);
});
