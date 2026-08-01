import type { PostgresTransaction } from '@/db/transaction';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import type { TenantContext } from '@/lib/auth';
import type { MiniProgramContext } from '@/lib/miniprogram-auth';

type TransactionCallback<T> = (
  transaction: PostgresTransaction
) => Promise<T>;

export function isPlatformRole(role: string) {
  return role === 'super_admin' || role === 'admin';
}

export function withAdminPostgresTransaction<T>(
  context: TenantContext,
  callback: TransactionCallback<T>
) {
  if (context.enterpriseId) {
    return withTenantTransaction(context.enterpriseId, callback);
  }
  if (isPlatformRole(context.role)) {
    return withPlatformTransaction(callback);
  }
  throw new Error('Enterprise context is required');
}

export function withMiniProgramPostgresTransaction<T>(
  context: MiniProgramContext,
  callback: TransactionCallback<T>
) {
  return context.enterpriseId
    ? withTenantTransaction(context.enterpriseId, callback)
    : withPlatformTransaction(callback);
}
