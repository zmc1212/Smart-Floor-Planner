import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { EnterpriseStatusTransitionError } from '@/lib/enterprise-status';
import {
  enterpriseJoinNotifyResult,
  enterpriseStatusChangeErrorResponse,
  enterpriseStatusChangeHttpStatus,
} from '@/lib/enterprise-status-change';

const adminSrc = join(process.cwd(), 'src');

function source(relativePath: string) {
  return readFileSync(join(adminSrc, relativePath), 'utf8');
}

test('join-result notify maps only approve and reject', () => {
  assert.equal(enterpriseJoinNotifyResult('approve'), 'approved');
  assert.equal(enterpriseJoinNotifyResult('reject'), 'rejected');
  assert.equal(enterpriseJoinNotifyResult('disable'), null);
  assert.equal(enterpriseJoinNotifyResult('enable'), null);
  assert.equal(enterpriseJoinNotifyResult('resubmit_review'), null);
});

test('status-change HTTP mapping keeps FSM and account-conflict as 400', () => {
  const transition = new EnterpriseStatusTransitionError(
    'INVALID_TRANSITION',
    '当前状态不允许执行该操作'
  );
  assert.equal(enterpriseStatusChangeHttpStatus(transition), 400);
  assert.deepEqual(enterpriseStatusChangeErrorResponse(transition), {
    status: 400,
    body: {
      success: false,
      error: '当前状态不允许执行该操作',
      code: 'INVALID_TRANSITION',
    },
  });

  assert.equal(
    enterpriseStatusChangeHttpStatus(
      Object.assign(new Error('手机号已被其他企业账号使用'), {
        code: 'ACCOUNT_CONFLICT',
      })
    ),
    400
  );
  assert.equal(
    enterpriseStatusChangeHttpStatus({ code: '23505' }),
    400
  );
  assert.equal(
    enterpriseStatusChangeHttpStatus(new Error('db down')),
    500
  );
});

test('shared helper applies FSM, provisions owner on active, then notifies after commit', () => {
  const helper = source('lib/enterprise-status-change.ts');
  assert.match(helper, /applyStatusAction/);
  assert.match(
    helper,
    /toStatus === 'active'[\s\S]*ensureEnterpriseAdminForActiveEnterprise/
  );
  assert.match(helper, /notifyEnterpriseContactOfJoinResult/);
  assert.match(
    helper,
    /await withPlatformTransaction\(async \(transaction\) => \{[\s\S]*return \{ applied, statusEvents \};[\s\S]*\}\);\s*if \(result\) \{\s*dispatchEnterpriseJoinResultNotification\(result\);/
  );
  assert.doesNotMatch(
    helper,
    /await withPlatformTransaction\(async \(transaction\) => \{[\s\S]*notifyEnterpriseContactOfJoinResult[\s\S]*\}\);/
  );
});

test('Admin and Mini Program status routes reuse the shared helper instead of duplicating provision or notify', () => {
  for (const relative of [
    'app/api/admin/enterprises/[id]/status/route.ts',
    'app/api/miniprogram/platform/enterprises/[id]/status/route.ts',
  ]) {
    const route = source(relative);
    assert.match(route, /applyEnterpriseStatusChange/);
    assert.match(route, /enterpriseStatusChangeErrorResponse/);
    assert.doesNotMatch(route, /applyStatusAction/);
    assert.doesNotMatch(route, /ensureEnterpriseAdminForActiveEnterprise/);
    assert.doesNotMatch(route, /notifyEnterpriseContactOfJoinResult/);
  }
});
