import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const assignRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/leads/[id]/assign-staff/route.ts'),
  'utf8'
);
const assignableRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/leads/[id]/assignable-staff/route.ts'),
  'utf8'
);
const manualLib = fs.readFileSync(
  path.resolve(__dirname, '../lead-assignment-manual.ts'),
  'utf8'
);
const leadDetailRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/leads/[id]/route.ts'),
  'utf8'
);
const leadListRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/leads/route.ts'),
  'utf8'
);
const adminLeadsPage = fs.readFileSync(
  path.resolve(__dirname, '../../app/(admin)/(merchant)/leads/page.tsx'),
  'utf8'
);

test('assign-staff accepts Mini Program JWT or Admin Cookie and enforces the role matrix', () => {
  assert.match(assignRoute, /resolveLeadAssignmentRequest\(request\)/);
  assert.match(assignRoute, /assignLeadStaff/);
  assert.match(assignRoute, /actorRole: actor\.role/);
  assert.match(assignRoute, /designerId/);
  assert.match(assignRoute, /measurerId/);
  assert.match(assignRoute, /请至少选择一名设计师或测量员/);
  assert.match(assignRoute, /attachLeadAssignmentActions/);
  assert.doesNotMatch(assignRoute, /requireMiniProgramEnterpriseAdmin/);
});

test('assign-staff keeps lead DTO staff summaries instead of overwriting measurerId with a string id', () => {
  assert.match(assignRoute, /\.\.\.leadToDto\(result\.lead\)/);
  assert.doesNotMatch(
    assignRoute,
    /measurerId:\s*result\.lead\.measurerId\?\.toString\(\)/
  );
  assert.doesNotMatch(
    assignRoute,
    /assignedTo:\s*result\.lead\.assignedTo\?\.toString\(\)/
  );
});

test('assignable-staff is lead-scoped and uses the same assignment actor', () => {
  assert.match(assignableRoute, /resolveLeadAssignmentRequest\(request\)/);
  assert.match(assignableRoute, /listAssignableStaff/);
  assert.match(assignableRoute, /roleParam !== 'designer' && roleParam !== 'measurer'/);
  assert.match(assignableRoute, /canAssignDesigner/);
  assert.match(assignableRoute, /canAssignMeasurer/);
  assert.doesNotMatch(assignableRoute, /requireMiniProgramEnterpriseAdmin/);
});

test('manual assign helper notifies assigned staff and rewritten appointment staff', () => {
  assert.match(manualLib, /ReferralLeadRepository\(transaction\)\.assignStaff/);
  assert.match(manualLib, /notifyDesignerOfAssignedLead/);
  assert.match(manualLib, /notifyEnterpriseAdminOfAssignmentPending/);
  assert.match(manualLib, /notifyAppointmentStaff/);
  assert.match(manualLib, /staff_reassigned/);
  assert.match(manualLib, /export async function assignLeadStaff/);
});

test('lead list and detail DTOs expose assignmentActions', () => {
  assert.match(leadDetailRoute, /assignmentActions: getLeadAssignmentActions/);
  assert.match(leadListRoute, /attachLeadAssignmentActions/);
});

test('admin leads cards open assign/replace through shared notify', () => {
  assert.match(adminLeadsPage, /assignmentActions\?\.canAssignDesigner/);
  assert.match(adminLeadsPage, /assignmentActions\?\.canAssignMeasurer/);
  assert.match(adminLeadsPage, /\/assignable-staff\?role=/);
  assert.match(adminLeadsPage, /\/assign-staff/);
  assert.match(adminLeadsPage, /notify\.success/);
  assert.match(adminLeadsPage, /notify\.error/);
  assert.match(adminLeadsPage, /选择后将替换当前人员/);
});
