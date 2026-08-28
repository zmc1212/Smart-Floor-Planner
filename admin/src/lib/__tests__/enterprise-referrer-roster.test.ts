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

test('Mini Program referrer roster list is owner-only and reuses the network repository', () => {
  assert.match(listRoute, /resolveMiniProgramContext\(request\)/);
  assert.match(listRoute, /requireMiniProgramEnterpriseAdmin/);
  assert.match(listRoute, /withMiniProgramPostgresTransaction/);
  assert.match(listRoute, /listEnterpriseReferrerMemberships/);
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
