import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const listRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/miniprogram/enterprise-referrers/route.ts'),
  'utf8'
);
const disableRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/miniprogram/enterprise-referrers/[id]/disable/route.ts'),
  'utf8'
);
const adminListRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/enterprise/referrer-memberships/route.ts'),
  'utf8'
);
const adminRosterPage = fs.readFileSync(
  path.resolve(__dirname, '../../app/(admin)/(merchant)/referrers/page.tsx'),
  'utf8'
);

test('Mini Program referrer roster list scopes employees to their own invitees and owners to the network', () => {
  assert.match(listRoute, /resolveMiniProgramContext\(request\)/);
  assert.match(listRoute, /requireMiniProgramReferrerNetwork/);
  assert.match(listRoute, /withMiniProgramPostgresTransaction/);
  assert.match(listRoute, /listEnterpriseReferrerMemberships/);
  assert.match(listRoute, /listEnterpriseReferrerNetwork/);
  assert.match(listRoute, /inviterStaffId/);
  assert.match(listRoute, /requestedView/);
  assert.match(listRoute, /view === 'network'/);
  assert.match(listRoute, /parseEnterpriseReferrerRosterStatus/);
  assert.match(listRoute, /buildEnterpriseReferrerRosterItem/);
  assert.match(listRoute, /searchParams\.get\('query'\)/);
  assert.match(listRoute, /createPaginationMetadata/);
  assert.match(listRoute, /getPaginationParams/);
  assert.doesNotMatch(listRoute, /withTenantRoute/);
  assert.doesNotMatch(listRoute, /referrer-memberships/);
});

test('Mini Program referrer disable reuses the repository and returns idempotent', () => {
  assert.match(disableRoute, /export async function POST/);
  assert.match(disableRoute, /resolveMiniProgramContext\(request\)/);
  assert.match(disableRoute, /requireMiniProgramEnterpriseAdmin/);
  assert.match(disableRoute, /disableEnterpriseReferrerMembership/);
  assert.match(disableRoute, /idempotent: result\.idempotent/);
  assert.match(disableRoute, /推荐人成员不存在/);
  assert.doesNotMatch(disableRoute, /withTenantRoute/);
  assert.doesNotMatch(disableRoute, /enableEnterpriseReferrerMembership|reenable|resume/);
});

test('Admin referrer roster gives only enterprise owners the employee network view', () => {
  assert.match(adminListRoute, /withTenantRoute/);
  assert.match(adminListRoute, /requestedView/);
  assert.match(adminListRoute, /requestedView === 'network'/);
  assert.match(adminListRoute, /context\.role !== 'enterprise_admin'/);
  assert.match(adminListRoute, /仅企业负责人可查看推广网络/);
  assert.match(adminListRoute, /listEnterpriseReferrerNetwork/);
  assert.match(adminListRoute, /listEnterpriseReferrerMemberships/);
  assert.match(adminRosterPage, /isEnterpriseOwner/);
  assert.match(adminRosterPage, /推广网络/);
  assert.match(adminRosterPage, /全部推广人/);
  assert.match(adminRosterPage, /employeeCount/);
  assert.match(adminRosterPage, /Collapse items=\{networkPanels\}/);
  assert.match(adminRosterPage, /\?view=network/);
});
