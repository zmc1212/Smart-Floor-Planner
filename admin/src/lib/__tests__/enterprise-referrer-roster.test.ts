import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  hasReferrersMenuPermission,
  isStaffReferrerRosterRole,
} from '../referrer-roster-access';

const adminListRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/enterprise/referrer-memberships/route.ts'),
  'utf8'
);
const adminRosterPage = fs.readFileSync(
  path.resolve(__dirname, '../../app/(admin)/(merchant)/referrers/page.tsx'),
  'utf8'
);
const proxyRoute = fs.readFileSync(
  path.resolve(__dirname, '../../proxy.ts'),
  'utf8'
);
const miniDisableRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/miniprogram/enterprise-referrers/[id]/disable/route.ts'),
  'utf8'
);

test('referrer roster access helpers distinguish staff viewers from operations admins', () => {
  assert.equal(isStaffReferrerRosterRole('designer'), true);
  assert.equal(isStaffReferrerRosterRole('measurer'), true);
  assert.equal(isStaffReferrerRosterRole('enterprise_admin'), false);
  assert.equal(
    hasReferrersMenuPermission(['referrer-network-operations']),
    true
  );
  assert.equal(hasReferrersMenuPermission(['referrers']), true);
  assert.equal(hasReferrersMenuPermission(['dashboard']), false);
});

test('Admin referrer roster exposes the employee network view to enterprise owners and selected-tenant platform admins', () => {
  assert.match(adminListRoute, /withTenantRoute/);
  assert.match(adminListRoute, /requestedView === 'network'/);
  assert.match(adminListRoute, /isStaffReferrerRosterRole/);
  assert.match(adminListRoute, /inviterStaffId/);
  assert.match(adminListRoute, /'designer'/);
  assert.match(adminListRoute, /'measurer'/);
  assert.match(adminListRoute, /listEnterpriseReferrerNetwork/);
  assert.match(adminListRoute, /listEnterpriseReferrerMemberships/);
  assert.match(adminRosterPage, /canViewReferrerNetwork/);
  assert.match(adminRosterPage, /isStaffReferrerViewer/);
  assert.match(adminRosterPage, /我的推广人/);
  assert.match(adminRosterPage, /推广网络/);
  assert.match(adminRosterPage, /全部推广人/);
  assert.match(adminRosterPage, /\?view=network/);
  assert.match(proxyRoute, /'\/referrers': 'referrers'/);
  assert.match(proxyRoute, /hasReferrersMenuPermission/);
  assert.match(miniDisableRoute, /requireMiniProgramReferrerNetwork/);
  assert.match(miniDisableRoute, /inviterStaffId/);
  assert.match(miniDisableRoute, /role === 'enterprise_admin'/);
});
