import {
  isTenantEnterpriseResetAllowed,
  TenantEnterpriseResetRepository,
  type EnterpriseResetResult,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { verifyAdminSensitivePassword } from '@/lib/enterprise-sensitive-password';
import { httpError } from '@/lib/http-error';
import {
  PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT,
  PLATFORM_ENTERPRISE_BATCH_PURGE_MAX,
} from '@/lib/platform-enterprise-purge-contract';

export {
  PLATFORM_ENTERPRISE_BATCH_CONFIRM_TEXT,
  PLATFORM_ENTERPRISE_BATCH_PURGE_MAX,
};

export function assertPlatformEnterprisePurgeAllowed() {
  if (!isTenantEnterpriseResetAllowed()) {
    throw Object.assign(
      httpError(
        '当前环境禁止企业一键清空。生产环境需显式设置 ALLOW_TENANT_ENTERPRISE_RESET=true',
        403
      ),
      { code: 'tenant_enterprise_reset_forbidden' as const }
    );
  }
}

export async function verifyPlatformAdminSensitivePassword(
  adminUserId: bigint,
  password: string
) {
  return withPlatformTransaction((transaction) =>
    verifyAdminSensitivePassword(transaction, adminUserId, password)
  );
}

export async function purgePlatformEnterprise(options: {
  enterpriseId: bigint;
  confirmEnterpriseName?: string;
}): Promise<EnterpriseResetResult> {
  return withPlatformTransaction(async (transaction) => {
    const repository = new TenantEnterpriseResetRepository(transaction);
    const preview = await repository.previewPurge(options.enterpriseId);
    if (
      options.confirmEnterpriseName !== undefined &&
      preview.enterpriseName !== options.confirmEnterpriseName
    ) {
      throw Object.assign(httpError('企业全名不匹配，已取消删除', 400), {
        code: 'enterprise_name_mismatch' as const,
      });
    }
    return repository.purge(options.enterpriseId);
  });
}
