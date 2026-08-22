import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const assignRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/leads/[id]/assign-staff/route.ts'),
  'utf8'
);
const manualLib = fs.readFileSync(
  path.resolve(__dirname, '../lead-assignment-manual.ts'),
  'utf8'
);

test('assign-staff route is Mini Program enterprise-admin only', () => {
  assert.match(assignRoute, /resolveMiniProgramContext\(request\)/);
  assert.match(assignRoute, /requireMiniProgramEnterpriseAdmin/);
  assert.match(assignRoute, /assignLeadStaff/);
  assert.match(assignRoute, /designerId/);
  assert.match(assignRoute, /measurerId/);
  assert.match(assignRoute, /请至少选择一名设计师或测量员/);
  assert.doesNotMatch(assignRoute, /withTenantRoute/);
});

test('manual assign helper delegates to ReferralLeadRepository and notifies staff', () => {
  assert.match(manualLib, /ReferralLeadRepository\(transaction\)\.assignStaff/);
  assert.match(manualLib, /notifyDesignerOfAssignedLead/);
  assert.match(manualLib, /notifyEnterpriseAdminOfAssignmentPending/);
  assert.match(manualLib, /assignment_manual_pending/);
  assert.match(manualLib, /export async function assignLeadStaff/);
});
