import { Schema, Query, Aggregate } from 'mongoose';
import { tenantStorage } from './tenant-context';

/**
 * Mongoose多租户隔离插件
 * 自动在所有查询中注入租户过滤条件
 */
export function multiTenantPlugin(schema: Schema) {
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

      // 自动注入 enterpriseId 过滤条件
      if (store.enterpriseId) {
        this.where({ enterpriseId: store.enterpriseId });
      }

      next();
    });
  });

  // 针对聚合查询 (Aggregation) 的特殊处理
  schema.pre('aggregate', function (this: Aggregate<any>, next) {
    const store = tenantStorage.getStore();

    if (store && store.role !== 'super_admin' && store.role !== 'admin') {
      // 检查是否已经有enterpriseId匹配条件
      const pipeline = this.pipeline();
      const hasEnterpriseMatch = pipeline.some(stage =>
        stage.$match && stage.$match.enterpriseId
      );

      // 如果没有enterpriseId过滤，则自动注入
      if (!hasEnterpriseMatch && store.enterpriseId) {
        this.pipeline().unshift({
          $match: { enterpriseId: store.enterpriseId }
        });
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