import { Schema, Query, Aggregate } from 'mongoose';
import { tenantStorage } from './tenant-context';

/**
 * 租户隔离配置选项
 */
export interface TenantPluginOptions {
  // 是否启用角色级别的数据隔离
  enableRoleBasedFiltering?: boolean;
  // 针对特定角色的自定义过滤字段
  roleFilterFields?: {
    designer?: string;  // 例如: 'staffId'
    salesperson?: string; // 例如: 'creator'
  };
  // 自定义过滤逻辑函数
  customFilter?: (store: any) => any;
}

/**
 * Mongoose多租户隔离插件
 * 自动在所有查询中注入租户过滤条件
 */
export function multiTenantPlugin(schema: Schema, options: TenantPluginOptions = {}) {
  const {
    enableRoleBasedFiltering = true,
    roleFilterFields = {},
    customFilter
  } = options;
  // 定义需要拦截的查询方法
  const queryMethods = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'countDocuments',
    'findById',
    'findByIdAndUpdate',
    'findByIdAndDelete'
  ];

  // 为每个查询方法添加前置钩子
  queryMethods.forEach((method) => {
    schema.pre(method as any, function (this: Query<any, any>, next) {
      console.log(`[MultiTenantPlugin] 插件被调用，方法: ${method}`);
      const store = tenantStorage.getStore();

      // 如果没有上下文，或者用户是超级管理员，则不进行强制过滤
      if (!store || store.role === 'super_admin' || store.role === 'admin') {
        return next();
      }

      // 如果已经有enterpriseId过滤条件，则不再注入（允许特殊情况覆盖）
      const existingFilter = this.getFilter();
      if (existingFilter.enterpriseId) {
        return next();
      }

      // 构建租户过滤条件
      const tenantFilter: any = {};

      // 1. 企业级别隔离 - 所有非管理员都需要
      if (store.enterpriseId) {
        tenantFilter.enterpriseId = store.enterpriseId;
      }

      // 2. 角色级别隔离 - 如果启用
      if (enableRoleBasedFiltering) {
        // 使用自定义过滤逻辑
        if (customFilter) {
          const customFilterResult = customFilter(store);
          Object.assign(tenantFilter, customFilterResult);
        } else {
          // 默认角色过滤逻辑
          const filterField = roleFilterFields[store.role as keyof typeof roleFilterFields] || 'staffId';

          if (store.role === 'designer' || store.role === 'salesperson') {
            // 设计师和销售只能看到自己创建的数据
            tenantFilter[filterField] = store.userId;
          }
        }
      }

      // 应用过滤条件
      if (Object.keys(tenantFilter).length > 0) {
        console.log(`[MultiTenantPlugin] 注入过滤条件:`, tenantFilter, '用户角色:', store.role);
        this.where(tenantFilter);
      }

      next();
    });
  });

  // 针对聚合查询 (Aggregation) 的特殊处理
  schema.pre('aggregate', function (this: Aggregate<any>, next) {
    const store = tenantStorage.getStore();

    if (store && store.role !== 'super_admin' && store.role !== 'admin') {
      const pipeline = this.pipeline();

      // 检查是否已经有匹配条件
      const hasEnterpriseMatch = pipeline.some(stage =>
        stage.$match && (stage.$match.enterpriseId || stage.$match.staffId)
      );

      // 如果没有匹配条件，则自动注入租户过滤
      if (!hasEnterpriseMatch) {
        const matchConditions: any = {};

        // 企业级别隔离
        if (store.enterpriseId) {
          matchConditions.enterpriseId = store.enterpriseId;
        }

        // 角色级别隔离
        if (enableRoleBasedFiltering) {
          if (customFilter) {
            const customFilterResult = customFilter(store);
            Object.assign(matchConditions, customFilterResult);
          } else {
            const filterField = roleFilterFields[store.role as keyof typeof roleFilterFields] || 'staffId';
            if (store.role === 'designer' || store.role === 'salesperson') {
              matchConditions[filterField] = store.userId;
            }
          }
        }

        if (Object.keys(matchConditions).length > 0) {
          this.pipeline().unshift({
            $match: matchConditions
          });
        }
      }
    }

    next();
  });

  // 针对save操作的预处理（确保新建数据包含enterpriseId）
  schema.pre('save', function (this: any, next) {
    const store = tenantStorage.getStore();

    // 如果是新文档且没有enterpriseId，自动注入
    if (this.isNew && store && store.enterpriseId && !this.enterpriseId) {
      // 只有非超级管理员才自动注入
      if (store.role !== 'super_admin' && store.role !== 'admin') {
        this.enterpriseId = store.enterpriseId;
      }
    }

    next();
  });
}

/**
 * 工具函数：检查查询是否安全（包含租户隔离）
 */
export function validateQuerySafety(model: any, query: Query<any, any>): boolean {
  const store = tenantStorage.getStore();

  // 超级管理员总是安全的
  if (store?.role === 'super_admin' || store?.role === 'admin') {
    return true;
  }

  // 检查查询条件中是否包含enterpriseId
  const filter = query.getFilter();
  return !!filter.enterpriseId;
}

/**
 * 工具函数：为跨租户操作创建安全查询
 */
export function createSafeQuery<T>(model: any, filter: any = {}): Query<T, any> {
  const store = tenantStorage.getStore();

  // 超级管理员可以访问所有数据
  if (store?.role === 'super_admin' || store?.role === 'admin') {
    return model.find(filter);
  }

  // 其他用户只能访问自己的企业数据
  const safeFilter = {
    ...filter,
    enterpriseId: store?.enterpriseId
  };

  return model.find(safeFilter);
}