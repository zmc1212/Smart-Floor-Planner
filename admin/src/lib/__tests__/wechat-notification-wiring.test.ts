import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const adminSrc = join(process.cwd(), 'src');

test('staff lead notifications deep-link to lead detail; customer notifications use project archive', () => {
  const source = readFileSync(join(adminSrc, 'lib/wechat-notification.ts'), 'utf8');
  assert.match(source, /function staffLeadDetailPage/);
  assert.match(source, /function customerProjectPage/);
  assert.match(
    source,
    /staffLeadDetailPage\(lead\.id!\)[\s\S]*buildNewLeadPayload/
  );
  assert.match(
    source,
    /staffLeadDetailPage\(lead\.id!\)[\s\S]*buildLeadAssignmentPayload/
  );
  assert.match(source, /page: staffLeadDetailPage\(input\.leadId\)/);
  assert.match(source, /page: customerProjectPage\(input\.leadId\)/);
  assert.doesNotMatch(
    source,
    /page: '\/pages\/leads-management\/leads-management'/
  );
  assert.doesNotMatch(
    source,
    /notifyAppointmentStaff[\s\S]*customer-project\/customer-project/
  );
});

test('staff notification delivery resolves openid from wechat_identities when staff column is empty', () => {
  const source = readFileSync(join(adminSrc, 'lib/wechat-notification.ts'), 'utf8');
  assert.match(source, /enrichRecipientOpenid/);
  assert.match(source, /findWechatIdentityByUserId/);
  assert.match(source, /notifyCustomerOfDesignPublished/);
  assert.match(source, /notifyDesignerOfSurveyCompleted/);
  assert.match(source, /notifyEnterpriseContactOfJoinResult/);
  assert.match(source, /notifyReferrerOfSigningCommission/);
  assert.match(source, /notifyStaffOfSigningCommission/);
  assert.match(source, /notifyEnterpriseAdminOfLeadConverted/);
  assert.match(source, /design_published/);
  assert.match(source, /enterprise_join_result/);
  assert.match(source, /signing_commission/);
  assert.match(source, /staff_signing_commission/);
  assert.match(source, /lead_converted/);
  assert.match(source, /templateKind: 'workflow_todo'/);
  assert.match(source, /staff-earnings\/staff-earnings/);
  assert.doesNotMatch(source, /commission-records\/commission-records/);
  assert.doesNotMatch(source, /formatWeChatAmount/);
});

test('sendSubscriptionMessage gates WeChat delivery on subscriptionMessagesEnabled', () => {
  const source = readFileSync(join(adminSrc, 'lib/wechat-notification.ts'), 'utf8');
  assert.match(source, /getPlatformNotificationConfig/);
  assert.match(
    source,
    /if\s*\(\s*!config\.subscriptionMessagesEnabled\s*\)[\s\S]*skipped:\s*true[\s\S]*subscription messages disabled/
  );
  assert.match(
    source,
    /export async function sendSubscriptionMessage[\s\S]*getPlatformNotificationConfig[\s\S]*cgi-bin\/message\/subscribe\/send/
  );
});

test('enterprise status approve and reject dispatch join-result notifications after commit', () => {
  const source = readFileSync(
    join(adminSrc, 'app/api/admin/enterprises/[id]/status/route.ts'),
    'utf8'
  );
  assert.match(source, /notifyEnterpriseContactOfJoinResult/);
  assert.match(source, /action === 'approve' \|\| action === 'reject'/);
});

test('lead convert notifies referrer, staff earnings via workflow_todo, and enterprise owner after commit', () => {
  const source = readFileSync(join(adminSrc, 'app/api/leads/[id]/convert/route.ts'), 'utf8');
  assert.match(source, /notifyConvertedLeadParties/);
  const notifier = readFileSync(join(adminSrc, 'lib/wechat-notification.ts'), 'utf8');
  assert.match(
    notifier,
    /notifyConvertedLeadParties[\s\S]*notifyReferrerOfSigningCommission[\s\S]*notifyStaffOfSigningCommission[\s\S]*notifyEnterpriseAdminOfLeadConverted/
  );
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

test('customer and internal reschedule notify staff and customer after the write commits', () => {
  const customerRoute = readFileSync(
    join(adminSrc, 'app/api/appointments/[id]/customer-reschedule/route.ts'),
    'utf8'
  );
  const internalRoute = readFileSync(
    join(adminSrc, 'app/api/appointments/[id]/internal-reschedule/route.ts'),
    'utf8'
  );
  const createRoute = readFileSync(join(adminSrc, 'app/api/appointments/route.ts'), 'utf8');
  for (const source of [customerRoute, internalRoute, createRoute]) {
    assert.match(source, /notifyAppointmentStaff/);
    assert.match(source, /notifyCustomerOfAppointment/);
  }
  assert.match(customerRoute, /eventType: 'customer_rescheduled'/);
  assert.match(internalRoute, /eventType: 'internal_rescheduled'/);
});

test('appointment POST mints on-site visits and floor-plan submit retries that mint', () => {
  const appointments = readFileSync(join(adminSrc, 'app/api/appointments/route.ts'), 'utf8');
  const updateRoute = readFileSync(join(adminSrc, 'app/api/floorplans/[id]/route.ts'), 'utf8');
  const createRoute = readFileSync(join(adminSrc, 'app/api/floorplans/route.ts'), 'utf8');
  assert.match(appointments, /source === 'on_site'/);
  assert.match(appointments, /createOnSiteVisit/);
  assert.match(updateRoute, /tryCreateOnSiteVisit/);
  assert.match(createRoute, /tryCreateOnSiteVisit/);
});

test('formal visit confirmation notifies the assigned designer', () => {
  const completeRoute = readFileSync(join(adminSrc, 'app/api/appointments/[id]/complete/route.ts'), 'utf8');
  const updateRoute = readFileSync(join(adminSrc, 'app/api/floorplans/[id]/route.ts'), 'utf8');
  const createRoute = readFileSync(join(adminSrc, 'app/api/floorplans/route.ts'), 'utf8');
  assert.match(completeRoute, /notifyDesignerOfSurveyCompleted/);
  assert.doesNotMatch(updateRoute, /notifyDesignerOfSurveyCompleted/);
  assert.doesNotMatch(createRoute, /notifyDesignerOfSurveyCompleted/);
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
