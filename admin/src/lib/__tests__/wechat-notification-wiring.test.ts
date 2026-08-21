import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const adminSrc = join(process.cwd(), 'src');

test('staff notification delivery resolves openid from wechat_identities when staff column is empty', () => {
  const source = readFileSync(join(adminSrc, 'lib/wechat-notification.ts'), 'utf8');
  assert.match(source, /enrichRecipientOpenid/);
  assert.match(source, /findWechatIdentityByUserId/);
  assert.match(source, /notifyCustomerOfDesignPublished/);
  assert.match(source, /notifyDesignerOfSurveyCompleted/);
  assert.match(source, /notifyEnterpriseContactOfJoinResult/);
  assert.match(source, /design_published/);
  assert.match(source, /enterprise_join_result/);
});

test('enterprise status approve and reject dispatch join-result notifications after commit', () => {
  const source = readFileSync(
    join(adminSrc, 'app/api/admin/enterprises/[id]/status/route.ts'),
    'utf8'
  );
  assert.match(source, /notifyEnterpriseContactOfJoinResult/);
  assert.match(source, /action === 'approve' \|\| action === 'reject'/);
});

test('assignment retry notifies measurer when distinct from designer', () => {
  const source = readFileSync(join(adminSrc, 'lib/lead-assignment-retry.ts'), 'utf8');
  assert.match(
    source,
    /measurerId[\s\S]*!==[\s\S]*assignedTo[\s\S]*notifyDesignerOfAssignedLead[\s\S]*measurerId/
  );
});

test('design publication routes notify the customer after commit', () => {
  const single = readFileSync(
    join(adminSrc, 'app/api/leads/[id]/ai-publications/route.ts'),
    'utf8'
  );
  const scheme = readFileSync(
    join(adminSrc, 'app/api/leads/[id]/ai-scheme-publications/route.ts'),
    'utf8'
  );
  assert.match(single, /notifyCustomerOfDesignPublished/);
  assert.match(scheme, /notifyCustomerOfDesignPublished/);
  assert.match(scheme, /newGenerationIds/);
});

test('formal floor-plan completion notifies the assigned designer', () => {
  const updateRoute = readFileSync(join(adminSrc, 'app/api/floorplans/[id]/route.ts'), 'utf8');
  const createRoute = readFileSync(join(adminSrc, 'app/api/floorplans/route.ts'), 'utf8');
  assert.match(updateRoute, /notifyDesignerOfSurveyCompleted/);
  assert.match(createRoute, /notifyDesignerOfSurveyCompleted/);
});
