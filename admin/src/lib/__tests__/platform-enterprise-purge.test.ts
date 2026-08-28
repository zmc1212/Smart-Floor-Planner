import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT,
  PLATFORM_ENTERPRISE_BATCH_PURGE_MAX,
} from '@/lib/platform-enterprise-purge';
import {
  PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT as CONTRACT_CONFIRM_TEXT,
  PLATFORM_ENTERPRISE_BATCH_PURGE_MAX as CONTRACT_PURGE_MAX,
} from '@/lib/platform-enterprise-purge-contract';

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

const singleDeleteRoute = source('../../app/api/admin/enterprises/[id]/route.ts');
const collectionRoute = source('../../app/api/admin/enterprises/route.ts');
const merchantPurgeRoute = source(
  '../../app/api/enterprise/enterprise-purge/route.ts'
);
const helper = source('../platform-enterprise-purge.ts');
const contract = source('../platform-enterprise-purge-contract.ts');
const schema = source('../../db/schema.ts');
const migration = source('../../../drizzle/0049_admin_sensitive_password.sql');
const listPage = source('../../app/(admin)/(platform)/enterprises/page.tsx');
const detailPage = source('../../app/(admin)/(platform)/enterprises/[id]/page.tsx');
const deleteModal = source(
  '../../components/admin/platform-enterprise-delete-modal.tsx'
);

test('platform single enterprise DELETE is a gated cascade purge', () => {
  assert.match(singleDeleteRoute, /export async function DELETE/);
  assert.match(
    singleDeleteRoute,
    /roles:\s*\['super_admin', 'admin'\], requireEnterprise:\s*false/
  );
  assert.match(singleDeleteRoute, /assertPlatformEnterprisePurgeAllowed/);
  assert.match(singleDeleteRoute, /verifyPlatformAdminSensitivePassword/);
  assert.match(singleDeleteRoute, /confirmEnterpriseName/);
  assert.match(singleDeleteRoute, /securityPassword/);
  assert.match(singleDeleteRoute, /purgePlatformEnterprise/);
  assert.doesNotMatch(
    singleDeleteRoute,
    /new EnterpriseRepository\(transaction\)\.delete/
  );
  assert.match(singleDeleteRoute, /请输入企业全名以确认删除整家企业/);
});

test('platform collection DELETE batches independent cascade purges', () => {
  assert.match(collectionRoute, /export async function DELETE/);
  assert.match(
    collectionRoute,
    /roles:\s*\['super_admin', 'admin'\], requireEnterprise:\s*false/
  );
  assert.match(collectionRoute, /assertPlatformEnterprisePurgeAllowed/);
  assert.match(collectionRoute, /verifyPlatformAdminSensitivePassword/);
  assert.match(collectionRoute, /PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT/);
  assert.match(collectionRoute, /PLATFORM_ENTERPRISE_BATCH_PURGE_MAX/);
  assert.match(collectionRoute, /purgePlatformEnterprise/);
  assert.match(collectionRoute, /deleted/);
  assert.match(collectionRoute, /failed/);
  assert.equal(PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT, '确认删除');
  assert.equal(PLATFORM_ENTERPRISE_BATCH_PURGE_MAX, 20);
});

test('platform purge helper verifies password before previewPurge and purge', () => {
  assert.match(helper, /isTenantEnterpriseResetAllowed/);
  assert.match(helper, /verifyAdminSensitivePassword/);
  assert.match(helper, /previewPurge/);
  assert.match(helper, /repository\.purge/);
  assert.match(helper, /企业全名不匹配，已取消删除/);
  assert.match(
    helper,
    /ALLOW_TENANT_ENTERPRISE_RESET=true/
  );
});

test('merchant enterprise-purge path stays full-name confirm without platform password', () => {
  assert.match(merchantPurgeRoute, /confirmEnterpriseName/);
  assert.doesNotMatch(merchantPurgeRoute, /verifyAdminSensitivePassword/);
  assert.doesNotMatch(merchantPurgeRoute, /verifyPlatformAdminSensitivePassword/);
  assert.match(merchantPurgeRoute, /isTenantEnterpriseResetAllowed/);
});

test('admin_users stores a dedicated sensitive password hash', () => {
  assert.match(schema, /sensitiveOperationPasswordHash: text\('sensitive_operation_password_hash'\)/);
  assert.match(
    migration,
    /ALTER TABLE "app"\."admin_users"/
  );
  assert.match(
    migration,
    /"sensitive_operation_password_hash"/
  );
});

test('batch purge confirm text and cap are shared with the UI contract', () => {
  assert.equal(PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT, '确认删除');
  assert.equal(PLATFORM_ENTERPRISE_BATCH_PURGE_MAX, 20);
  assert.equal(CONTRACT_CONFIRM_TEXT, PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT);
  assert.equal(CONTRACT_PURGE_MAX, PLATFORM_ENTERPRISE_BATCH_PURGE_MAX);
  assert.match(contract, /export const PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT/);
  assert.match(helper, /platform-enterprise-purge-contract/);
});

test('enterprises list exposes single and batch delete dialogs gated by admin sensitive password', () => {
  assert.match(listPage, /PlatformEnterpriseDeleteModal/);
  assert.match(listPage, /label: '删除企业'/);
  assert.match(listPage, /danger: true/);
  assert.match(listPage, /批量删除/);
  assert.match(listPage, /rowSelection/);
  assert.match(listPage, /mode="single"/);
  assert.match(listPage, /mode="batch"/);
  assert.match(listPage, /PLATFORM_ENTERPRISE_BATCH_PURGE_MAX/);
  assert.match(listPage, /isPlatformAdminRole\(user\?\.role\)/);
  assert.match(listPage, /canPurge/);
});

test('enterprise detail extra exposes single delete and returns to the list', () => {
  assert.match(detailPage, /PlatformEnterpriseDeleteModal/);
  assert.match(detailPage, /删除企业/);
  assert.match(detailPage, /mode="single"/);
  assert.match(detailPage, /router\.push\('\/enterprises'\)/);
  assert.match(detailPage, /canPurge/);
  assert.doesNotMatch(detailPage, /mode="batch"/);
});

test('platform delete modal confirms full name or 确认删除 plus personal security password', () => {
  assert.match(deleteModal, /PLATFORM_SENSITIVE_PASSWORD_API/);
  assert.match(deleteModal, /confirmEnterpriseName/);
  assert.match(deleteModal, /securityPassword/);
  assert.match(deleteModal, /PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT/);
  assert.match(deleteModal, /openSensitivePassword/);
  assert.match(deleteModal, /去设置安全密码/);
  assert.match(deleteModal, /此操作不可恢复/);
  assert.match(deleteModal, /notify\.success/);
  assert.match(deleteModal, /notify\.error/);
  assert.match(deleteModal, /\/api\/admin\/enterprises/);
  assert.doesNotMatch(deleteModal, /\/api\/enterprise\/sensitive-password/);
  assert.doesNotMatch(deleteModal, /\/api\/enterprise\/enterprise-purge/);
});
