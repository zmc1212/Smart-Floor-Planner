import { AsyncLocalStorage } from 'async_hooks';

// 定义存储的内容结构
export interface TenantStore {
  enterpriseId: string | null;
  role: string;
  userId: string;
}

// 创建全局唯一的 AsyncLocalStorage 实例
export const tenantStorage = new AsyncLocalStorage<TenantStore>();

/**
 * 获取当前请求的租户信息
 */
export function getCurrentTenant(): TenantStore | undefined {
  return tenantStorage.getStore();
}

/**
 * 获取当前请求的租户 ID
 */
export function getCurrentEnterpriseId(): string | null {
  return tenantStorage.getStore()?.enterpriseId || null;
}

/**
 * 获取当前用户角色
 */
export function getCurrentUserRole(): string | undefined {
  return tenantStorage.getStore()?.role;
}

/**
 * 获取当前用户 ID
 */
export function getCurrentUserId(): string | undefined {
  return tenantStorage.getStore()?.userId;
}

/**
 * 检查当前用户是否为超级管理员
 */
export function isSuperAdmin(): boolean {
  const role = getCurrentUserRole();
  return role === 'super_admin' || role === 'admin';
}

/**
 * 检查当前用户是否有权限访问指定企业数据
 */
export function canAccessEnterprise(enterpriseId: string | null): boolean {
  const store = tenantStorage.getStore();
  if (!store) return false;

  // super_admin 和 admin 可以访问所有企业
  if (store.role === 'super_admin' || store.role === 'admin') {
    return true;
  }

  // 其他角色只能访问自己的企业
  return store.enterpriseId === enterpriseId;
}