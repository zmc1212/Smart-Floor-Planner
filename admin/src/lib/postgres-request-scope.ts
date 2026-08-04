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

/**
 * Platform-owned devices can be independent from an enterprise. Keep their
 * assignment visible when a platform administrator has selected a tenant.
 */
export function withDevicePostgresTransaction<T>(
  context: TenantContext,
  callback: TransactionCallback<T>
) {
  if (isPlatformRole(context.role)) {
    return withPlatformTransaction(callback);
  }
  return withAdminPostgresTransaction(context, callback);
}

/**
 * B2B promotion staff are platform employees until a prospect becomes an
 * enterprise customer. Callers must still apply actor-scoped repository filters.
 */
export function withPromotionPostgresTransaction<T>(
  context: TenantContext,
  callback: TransactionCallback<T>
) {
  if (context.enterpriseId) {
    return withTenantTransaction(context.enterpriseId, callback);
  }
  if (isPlatformRole(context.role) || context.role === 'salesperson') {
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
