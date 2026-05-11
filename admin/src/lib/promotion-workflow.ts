import mongoose from 'mongoose';
import { AdminUser } from '@/models/AdminUser';
import { CommissionRecord } from '@/models/CommissionRecord';
import { Enterprise } from '@/models/Enterprise';
import { EnterpriseOrder, IEnterpriseOrder } from '@/models/EnterpriseOrder';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { User } from '@/models/User';
import {
  buildNextFollowUpAt,
  dispatchWorkflowNotifications,
  getEnterpriseAutomationConfig,
  PLATFORM_PROMOTION_CONFIG,
} from '@/lib/workflow-automation';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export { 
  PLATFORM_PROMOTION_CONFIG, 
  buildNextFollowUpAt, 
  dispatchWorkflowNotifications,
  getEnterpriseAutomationConfig 
};

export function buildListQuery(searchParams: URLSearchParams) {
  const query: any = {};

  const search = searchParams.get('search');
  if (search) {
    query.$or = [
      { enterpriseName: { $regex: search, $options: 'i' } },
      { contactPerson: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const ownershipStatus = searchParams.get('ownershipStatus');
  if (ownershipStatus) query.ownershipStatus = ownershipStatus;

  const businessStage = searchParams.get('businessStage');
  if (businessStage) query.businessStage = businessStage;

  const poolStatus = searchParams.get('poolStatus');
  if (poolStatus) query.poolStatus = poolStatus;

  const city = searchParams.get('city');
  if (city) query.city = city;

  const industry = searchParams.get('industry');
  if (industry) query.industry = industry;

  return query;
}

export function getPopulateQuery(query: any) {
  return PromotionEnterpriseRecord.find(query)
    .populate('promoterId', 'displayName username role phone')
    .populate('enterpriseId', 'name')
    .populate('measureTask.assignedTo', 'displayName username phone')
    .populate('designTask.assignedTo', 'displayName username phone');
}

export async function getMiniProgramStaffContext(input: string | Request) {
  const context = typeof input === 'string' 
    ? await resolveMiniProgramContext(new Request('http://localhost?openid=' + input)) // Legacy fallback if still needed internally
    : await resolveMiniProgramContext(input);
    
  if (!context) return { user: null, staff: null };
  return { user: context.user, staff: context.staff };
}

export function buildPromotionAccessFilter(staff: { role: string; _id: unknown; enterpriseId?: unknown }) {
  const filter: Record<string, unknown> = {};

  // salesperson 是平台级角色，不按 enterpriseId 过滤
  if (staff.role === 'salesperson') {
    filter.promoterId = staff._id;
    return filter;
  }

  if (staff.enterpriseId) {
    filter.enterpriseId = staff.enterpriseId;
  }

  if (staff.role === 'measurer') {
    filter['measureTask.assignedTo'] = staff._id;
  } else if (staff.role === 'designer') {
    filter['designTask.assignedTo'] = staff._id;
  }

  return filter;
}

export function buildPromotionDuplicateQuery(input: {
  creditCode?: string;
  enterpriseName: string;
  phone: string;
}) {
  // 全平台范围查重（不限 enterpriseId）
  const orConditions: Record<string, unknown>[] = [];
  if (input.creditCode) {
    orConditions.push({ creditCode: input.creditCode.trim().toUpperCase() });
  }

  orConditions.push({
    enterpriseName: input.enterpriseName.trim(),
    phone: input.phone.trim(),
  });

  return { $or: orConditions };
}

export async function syncCommissionForOrder(order: IEnterpriseOrder, settledBy?: string) {
  const record = await PromotionEnterpriseRecord.findById(order.recordId).lean();
  if (!record || record.ownershipStatus === 'conflict_pending' || !record.promoterId) {
    return null;
  }

  if (order.status === 'cancelled') {
    return CommissionRecord.findOneAndUpdate(
      { orderId: order._id },
      { $set: { status: 'voided', settledBy: settledBy || undefined, settledAt: new Date() } },
      { new: true }
    );
  }

  if (order.status !== 'paid') {
    return null;
  }

  const enterprise = record.enterpriseId ? await Enterprise.findById(record.enterpriseId).lean() : null;
  const automationConfig = getEnterpriseAutomationConfig(enterprise);
  // 提成金额：优先使用企业覆盖值，否则用平台默认配置
  const commissionAmount = Math.max(
    Number(enterprise?.groundPromotionFixedCommission || PLATFORM_PROMOTION_CONFIG.defaultCommissionAmount),
    0
  );

  await PromotionEnterpriseRecord.findByIdAndUpdate(record._id, {
    $set: {
      businessStage: 'paid',
      pendingActionRole: 'none',
      lastActivityAt: new Date(),
    },
    $unset: {
      nextFollowUpAt: 1,
      'measureTask.dueAt': 1,
      'designTask.dueAt': 1,
    },
  });

  const commission = await CommissionRecord.findOneAndUpdate(
    { orderId: order._id },
    {
      $set: {
        recordId: record._id,
        orderId: order._id,
        promoterId: record.promoterId,
        enterpriseId: record.enterpriseId,
        commissionType: 'fixed_per_paid_order',
        commissionAmount,
        status: 'pending_settlement',
        generatedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await dispatchWorkflowNotifications({
    record: {
      ...record,
      businessStage: 'paid',
      nextFollowUpAt: buildNextFollowUpAt(new Date(), { automationConfig }),
    },
    notificationType: 'record_closed',
    recipientRoles: ['salesperson', 'enterprise_admin'],
    message: `【流程关闭】${record.enterpriseName} 已完成付款，当前协作待办已自动关闭。`,
    dedupeSuffix: `paid-${String(order._id)}`,
  });

  return commission;
}

export async function findPromotionRecordIdsForPromoter(promoterId: unknown) {
  const records = await PromotionEnterpriseRecord.find({ promoterId: promoterId as any }).select('_id').lean();
  return records.map((item) => item._id);
}

export async function findOrdersForOpenidStaff(staff: { role: string; _id: unknown; enterpriseId?: unknown }) {
  if (staff.role === 'salesperson') {
    const recordIds = await findPromotionRecordIdsForPromoter(staff._id);
    return EnterpriseOrder.find({ recordId: { $in: recordIds } });
  }

  if (staff.enterpriseId) {
    return EnterpriseOrder.find({ enterpriseId: staff.enterpriseId });
  }

  return EnterpriseOrder.find({ _id: null });
}

export function asObjectId(value?: string | null) {
  return value && mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : undefined;
}

/**
 * 从公海池认领报备记录
 */
export async function claimFromPool(recordId: string, salespersonId: string) {
  const record = await PromotionEnterpriseRecord.findOne({
    _id: recordId,
    poolStatus: 'in_pool',
  });
  if (!record) return null;

  const config = PLATFORM_PROMOTION_CONFIG;
  const now = new Date();
  const protectionExpiresAt = new Date(now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000);

  if (config.poolClaimRequiresApproval) {
    // 待审批模式：标记为 claimed 但保留原 promoterId，等待管理员确认
    record.poolStatus = 'claimed';
    record.lastActivityAt = now;
    record.followUpRecords.push({
      content: `地推员申请认领，等待管理员审批`,
      operator: 'System',
      createdAt: now,
    } as any);
    await record.save();
    return record;
  }

  // 直接认领模式
  record.promoterId = new mongoose.Types.ObjectId(salespersonId);
  record.poolStatus = 'protected';
  record.protectionExpiresAt = protectionExpiresAt;
  record.protectionExtendedCount = 0;
  record.ownershipStatus = 'auto_locked';
  record.pendingActionRole = 'salesperson';
  record.businessStage = record.businessStage === 'closed_lost' ? 'reported' : record.businessStage;
  record.lastActivityAt = now;
  record.followUpRecords.push({
    content: `从公海池认领`,
    operator: 'System',
    createdAt: now,
  } as any);
  await record.save();
  return record;
}

/**
 * 手动释放报备记录到公海池
 */
export async function releaseToPool(recordId: string) {
  return PromotionEnterpriseRecord.findByIdAndUpdate(
    recordId,
    {
      $set: {
        poolStatus: 'in_pool',
        pendingActionRole: 'none',
        lastActivityAt: new Date(),
      },
      $unset: { nextFollowUpAt: 1 },
    },
    { new: true }
  );
}

/**
 * 提交跟进后延长保护期
 */
export function extendProtectionPeriod(record: any) {
  const config = PLATFORM_PROMOTION_CONFIG;
  if (
    record.poolStatus !== 'protected' ||
    record.protectionExtendedCount >= config.maxProtectionExtends
  ) {
    return null;
  }

  const now = new Date();
  const currentExpiry = record.protectionExpiresAt ? new Date(record.protectionExpiresAt) : now;
  const base = currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  const newExpiry = new Date(base.getTime() + config.protectionExtendDays * 24 * 60 * 60 * 1000);

  return {
    protectionExpiresAt: newExpiry,
    protectionExtendedCount: (record.protectionExtendedCount || 0) + 1,
  };
}
