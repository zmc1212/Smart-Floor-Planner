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
  assert.match(source, /notifyReferrerOfSigningCommission/);
  assert.match(source, /notifyEnterpriseAdminOfLeadConverted/);
  assert.match(source, /design_published/);
  assert.match(source, /enterprise_join_result/);
  assert.match(source, /signing_commission/);
  assert.match(source, /lead_converted/);
});

test('enterprise status approve and reject dispatch join-result notifications after commit', () => {
  const source = readFileSync(
    join(adminSrc, 'app/api/admin/enterprises/[id]/status/route.ts'),
    'utf8'
  );
  assert.match(source, /notifyEnterpriseContactOfJoinResult/);
  assert.match(source, /action === 'approve' \|\| action === 'reject'/);
});

test('lead convert notifies referrer commission and enterprise owner after commit', () => {
  const source = readFileSync(join(adminSrc, 'app/api/leads/[id]/convert/route.ts'), 'utf8');
  assert.match(source, /notifyConvertedLeadParties/);
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

test('reminder cron only runs appointment expiry and promotion routes no longer dispatch workflow notifications', () => {
  const scan = readFileSync(join(adminSrc, 'lib/postgres-workflow-automation.ts'), 'utf8');
  assert.match(scan, /expireOverdueAppointmentsAndNotify/);
  assert.match(scan, /Legacy promotion follow-up/);
  assert.doesNotMatch(scan, /notificationType: 'follow_up_overdue'/);
  assert.doesNotMatch(scan, /notificationType: 'measure_overdue'/);
  assert.doesNotMatch(scan, /notificationType: 'design_overdue'/);

  const promotionWorkflow = readFileSync(join(adminSrc, 'lib/postgres-promotion-workflow.ts'), 'utf8');
  assert.doesNotMatch(promotionWorkflow, /notificationJobs\.push/);
  assert.match(promotionWorkflow, /notificationJobs: \[\]/);

  for (const relative of [
    'app/api/promotion-records/route.ts',
    'app/api/promotion-records/[id]/route.ts',
    'app/api/promotion-records/conflicts/route.ts',
  ]) {
    const route = readFileSync(join(adminSrc, relative), 'utf8');
    assert.doesNotMatch(route, /dispatchWorkflowNotifications/);
  }
});
