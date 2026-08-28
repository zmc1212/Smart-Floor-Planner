import bcrypt from 'bcryptjs';
import { AdminUserRepository, EnterpriseRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { httpError } from '@/lib/http-error';

export const SENSITIVE_PASSWORD_MIN_LENGTH = 6;
export const SENSITIVE_PASSWORD_MAX_LENGTH = 32;

export type SensitivePasswordErrorCode =
  | 'sensitive_password_not_configured'
  | 'sensitive_password_invalid'
  | 'sensitive_password_mismatch'
  | 'sensitive_password_current_required';

export function isSensitivePasswordConfigured(
  hash: string | null | undefined
): boolean {
  return Boolean(hash && hash.trim());
}

export function validateSensitivePasswordInput(password: string, confirmPassword: string) {
  const normalized = String(password || '').trim();
  const normalizedConfirm = String(confirmPassword || '').trim();
  if (
    normalized.length < SENSITIVE_PASSWORD_MIN_LENGTH ||
    normalized.length > SENSITIVE_PASSWORD_MAX_LENGTH
  ) {
    throw Object.assign(
      httpError(
        `安全密码长度须为 ${SENSITIVE_PASSWORD_MIN_LENGTH}–${SENSITIVE_PASSWORD_MAX_LENGTH} 位`,
        400
      ),
      { code: 'sensitive_password_invalid' as const }
    );
  }
  if (normalized !== normalizedConfirm) {
    throw Object.assign(httpError('两次输入的安全密码不一致', 400), {
      code: 'sensitive_password_mismatch' as const,
    });
  }
  return normalized;
}

export async function hashSensitivePassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyEnterpriseSensitivePassword(
  transaction: PostgresTransaction,
  enterpriseId: bigint,
  password: string
) {
  const enterprise = await new EnterpriseRepository(transaction).findById(enterpriseId);
  if (!enterprise) {
    throw httpError('企业不存在', 404);
  }
  if (!isSensitivePasswordConfigured(enterprise.sensitiveOperationPasswordHash)) {
    throw Object.assign(httpError('请先设置企业安全密码', 400), {
      code: 'sensitive_password_not_configured' as const,
    });
  }
  const normalized = String(password || '').trim();
  if (!normalized) {
    throw Object.assign(httpError('请输入安全密码', 400), {
      code: 'sensitive_password_invalid' as const,
    });
  }
  const valid = await bcrypt.compare(
    normalized,
    enterprise.sensitiveOperationPasswordHash!
  );
  if (!valid) {
    throw Object.assign(httpError('安全密码不正确', 403), {
      code: 'sensitive_password_invalid' as const,
    });
  }
  return enterprise;
}

export async function setEnterpriseSensitivePassword(
  transaction: PostgresTransaction,
  enterpriseId: bigint,
  input: {
    password: string;
    confirmPassword: string;
    currentPassword?: string | null;
  }
) {
  const enterprise = await new EnterpriseRepository(transaction).findById(enterpriseId);
  if (!enterprise) {
    throw httpError('企业不存在', 404);
  }

  const configured = isSensitivePasswordConfigured(
    enterprise.sensitiveOperationPasswordHash
  );
  const nextPassword = validateSensitivePasswordInput(
    input.password,
    input.confirmPassword
  );

  if (configured) {
    const currentPassword = String(input.currentPassword || '').trim();
    if (!currentPassword) {
      throw Object.assign(httpError('修改安全密码须输入当前安全密码', 400), {
        code: 'sensitive_password_current_required' as const,
      });
    }
    const currentValid = await bcrypt.compare(
      currentPassword,
      enterprise.sensitiveOperationPasswordHash!
    );
    if (!currentValid) {
      throw Object.assign(httpError('当前安全密码不正确', 403), {
        code: 'sensitive_password_invalid' as const,
      });
    }
  }

  const passwordHash = await hashSensitivePassword(nextPassword);
  await new EnterpriseRepository(transaction).update(enterpriseId, {
    sensitiveOperationPasswordHash: passwordHash,
  });
  return { configured: true };
}

export async function verifyAdminSensitivePassword(
  transaction: PostgresTransaction,
  adminUserId: bigint,
  password: string
) {
  const admin = await new AdminUserRepository(transaction).findById(adminUserId);
  if (!admin) {
    throw httpError('用户不存在', 404);
  }
  if (!isSensitivePasswordConfigured(admin.sensitiveOperationPasswordHash)) {
    throw Object.assign(httpError('请先设置安全密码', 400), {
      code: 'sensitive_password_not_configured' as const,
    });
  }
  const normalized = String(password || '').trim();
  if (!normalized) {
    throw Object.assign(httpError('请输入安全密码', 400), {
      code: 'sensitive_password_invalid' as const,
    });
  }
  const valid = await bcrypt.compare(
    normalized,
    admin.sensitiveOperationPasswordHash!
  );
  if (!valid) {
    throw Object.assign(httpError('安全密码不正确', 403), {
      code: 'sensitive_password_invalid' as const,
    });
  }
  return admin;
}

export async function setAdminSensitivePassword(
  transaction: PostgresTransaction,
  adminUserId: bigint,
  input: {
    password: string;
    confirmPassword: string;
    currentPassword?: string | null;
  }
) {
  const admin = await new AdminUserRepository(transaction).findById(adminUserId);
  if (!admin) {
    throw httpError('用户不存在', 404);
  }

  const configured = isSensitivePasswordConfigured(
    admin.sensitiveOperationPasswordHash
  );
  const nextPassword = validateSensitivePasswordInput(
    input.password,
    input.confirmPassword
  );

  if (configured) {
    const currentPassword = String(input.currentPassword || '').trim();
    if (!currentPassword) {
      throw Object.assign(httpError('修改安全密码须输入当前安全密码', 400), {
        code: 'sensitive_password_current_required' as const,
      });
    }
    const currentValid = await bcrypt.compare(
      currentPassword,
      admin.sensitiveOperationPasswordHash!
    );
    if (!currentValid) {
      throw Object.assign(httpError('当前安全密码不正确', 403), {
        code: 'sensitive_password_invalid' as const,
      });
    }
  }

  const passwordHash = await hashSensitivePassword(nextPassword);
  await new AdminUserRepository(transaction).update(adminUserId, {
    sensitiveOperationPasswordHash: passwordHash,
  });
  return { configured: true };
}
