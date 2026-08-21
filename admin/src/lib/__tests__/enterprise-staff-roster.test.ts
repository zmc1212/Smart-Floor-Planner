import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const listRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/miniprogram/enterprise-staff/route.ts'),
  'utf8'
);
const assignmentRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/miniprogram/enterprise-staff/[id]/assignment/route.ts'),
  'utf8'
);

test('Mini Program staff roster list is owner-only and uses the roster DTO', () => {
  assert.match(listRoute, /resolveMiniProgramContext\(request\)/);
  assert.match(listRoute, /requireMiniProgramEnterpriseAdmin/);
  assert.match(listRoute, /parseEnterpriseStaffRosterRoles/);
  assert.match(listRoute, /buildEnterpriseStaffRosterItem/);
  assert.match(listRoute, /roles:\s*\['designer',\s*'measurer'\]|parseEnterpriseStaffRosterRoles/);
  assert.match(listRoute, /status:\s*'active'/);
  assert.doesNotMatch(listRoute, /withTenantRoute/);
});

test('Mini Program staff assignment pause uses Mini Program auth and retries on resume', () => {
  assert.match(assignmentRoute, /export async function PATCH/);
  assert.match(assignmentRoute, /resolveMiniProgramContext\(request\)/);
  assert.match(assignmentRoute, /requireMiniProgramEnterpriseAdmin/);
  assert.match(assignmentRoute, /assignmentPaused/);
  assert.match(assignmentRoute, /retryPendingLeadAssignmentsForEnterprise/);
  assert.match(assignmentRoute, /staff_profile_or_assignment_availability_changed/);
  assert.match(assignmentRoute, /role === 'designer' \|\| [\s\S]*role === 'measurer'|designer.*measurer/);
  assert.doesNotMatch(assignmentRoute, /withTenantRoute/);
  assert.doesNotMatch(assignmentRoute, /password/);
});
