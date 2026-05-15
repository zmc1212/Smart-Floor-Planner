import mongoose from 'mongoose';
import { AdminUser } from '@/models/AdminUser';
import { CommissionRecord } from '@/models/CommissionRecord';
import { Enterprise } from '@/models/Enterprise';
import { EnterpriseOrder, IEnterpriseOrder } from '@/models/EnterpriseOrder';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { User } from '@/models/User';
import { Package } from '@/models/Package';
import {
  buildNextFollowUpAt,
  dispatchWorkflowNotifications,
  getEnterpriseAutomationConfig,
} from '@/lib/workflow-automation';
import { getPlatformPromotionConfig } from '@/lib/platform-promotion-config';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { createPromotionTimelineEntry, resolveOperatorName } from '@/lib/promotion-timeline';

export { 
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
    .populate('claimRequest.requestedBy', 'displayName username role phone')
    .populate('claimRequest.reviewedBy', 'displayName username role phone')
    .populate('followUpRecords.operatorId', 'displayName username role phone')
    .populate('measureTask.assignedTo', 'displayName username phone')
    .populate('designTask.assignedTo', 'displayName username phone');
}

export function getPromotionRecordByIdQuery(id: string | mongoose.Types.ObjectId) {
  return getPopulateQuery({ _id: id }).findOne();
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
    filter.$or = [
      { promoterId: staff._id },
      {
        'claimRequest.requestedBy': staff._id,
        'claimRequest.status': 'pending',
      },
    ];
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
  const platformPromotionConfig = await getPlatformPromotionConfig();
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
  
  // 提成金额计算优先级：
  // 1. 套餐级配置 (匹配 order.packageName)
  // 2. 企业级覆盖 (enterprise.groundPromotionFixedCommission)
  // 3. 平台默认值 (PLATFORM_PROMOTION_CONFIG.defaultCommissionAmount)
  let commissionAmount = 0;
  
  const packageDoc = await Package.findOne({ name: order.packageName }).lean();
  if (packageDoc && (packageDoc.promotionCommission ?? 0) > 0) {
    commissionAmount = packageDoc.promotionCommission;
  } else if (enterprise?.groundPromotionFixedCommission) {
    commissionAmount = Number(enterprise.groundPromotionFixedCommission);
  } else {
    commissionAmount = Number(platformPromotionConfig.defaultCommissionAmount);
  }

  commissionAmount = Math.max(commissionAmount, 0);

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

async function getActiveSalespersonById(salespersonId: string) {
  return AdminUser.findOne({
    _id: salespersonId,
    role: 'salesperson',
    status: 'active',
  }).select('displayName username role phone');
}

/**
 * 从公海池认领报备记录
 */
export async function claimFromPool(recordId: string, salespersonId: string) {
  const salesperson = await getActiveSalespersonById(salespersonId);
  if (!salesperson) {
    throw new Error('Target salesperson not found');
  }

  const record = await PromotionEnterpriseRecord.findOne({
    _id: recordId,
    poolStatus: 'in_pool',
  });
  if (!record) return null;

  const config = await getPlatformPromotionConfig();
  const now = new Date();
  const protectionExpiresAt = new Date(now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000);

  if (config.poolClaimRequiresApproval) {
    // 待审批模式：进入 claimed，等待管理员确认，不占用当前归属
    record.promoterId = undefined;
    record.poolStatus = 'claimed';
    record.ownershipStatus = 'unassigned';
    record.pendingActionRole = 'none';
    record.protectionExpiresAt = undefined;
    record.protectionExtendedCount = 0;
    record.nextFollowUpAt = undefined;
    record.claimRequest = {
      status: 'pending',
      requestedBy: salesperson._id,
      requestedAt: now,
    } as any;
    record.lastActivityAt = now;
    record.followUpRecords.push(
      createPromotionTimelineEntry({
        type: 'pool_claim_requested',
        content: `${resolveOperatorName(salesperson)} 申请从公海池认领，等待管理员审批`,
        operator: resolveOperatorName(salesperson),
        operatorId: salesperson._id,
        operatorRole: salesperson.role,
        metadata: {
          requestedBy: salesperson._id.toString(),
        },
        createdAt: now,
      }) as any
    );
    await record.save();
    return getPromotionRecordByIdQuery(record._id);
  }

  // 直接认领模式
  record.promoterId = new mongoose.Types.ObjectId(salespersonId);
  record.poolStatus = 'protected';
  record.protectionExpiresAt = protectionExpiresAt;
  record.protectionExtendedCount = 0;
  record.ownershipStatus = 'auto_locked';
  record.pendingActionRole = 'salesperson';
  record.businessStage = record.businessStage === 'closed_lost' ? 'reported' : record.businessStage;
  record.claimRequest = {
    status: 'approved',
    requestedBy: salesperson._id,
    requestedAt: now,
    reviewedBy: salesperson._id,
    reviewedAt: now,
  } as any;
  record.lastActivityAt = now;
  record.followUpRecords.push(
    createPromotionTimelineEntry({
      type: 'pool_claimed',
      content: `${resolveOperatorName(salesperson)} 从公海池认领`,
      operator: resolveOperatorName(salesperson),
      operatorId: salesperson._id,
      operatorRole: salesperson.role,
      metadata: {
        promoterId: salesperson._id.toString(),
      },
      createdAt: now,
    }) as any
  );
  await record.save();
  return getPromotionRecordByIdQuery(record._id);
}

/**
 * 管理员将线索池记录手动分配给渠道地推
 */
export async function assignPoolRecordToPromoter(recordId: string, salespersonId: string, operatorId?: string) {
  const salesperson = await getActiveSalespersonById(salespersonId);

  if (!salesperson) {
    throw new Error('Target salesperson not found');
  }

  const record = await PromotionEnterpriseRecord.findOne({
    _id: recordId,
    poolStatus: 'in_pool',
  });
  if (!record) return null;

  const config = await getPlatformPromotionConfig();
  const now = new Date();
  const protectionExpiresAt = new Date(now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000);
  const operator = operatorId && mongoose.Types.ObjectId.isValid(operatorId)
    ? new mongoose.Types.ObjectId(operatorId)
    : undefined;

  record.promoterId = new mongoose.Types.ObjectId(salespersonId);
  record.poolStatus = 'protected';
  record.protectionExpiresAt = protectionExpiresAt;
  record.protectionExtendedCount = 0;
  record.ownershipStatus = 'manually_locked';
  record.pendingActionRole = 'salesperson';
  record.businessStage = record.businessStage === 'closed_lost' ? 'reported' : record.businessStage;
  record.claimRequest = undefined;
  record.lastActivityAt = now;
  record.followUpRecords.push(
    createPromotionTimelineEntry({
      type: 'pool_assigned',
      content: `管理员分配给渠道地推：${resolveOperatorName(salesperson)}`,
      operator: 'System',
      operatorId: operator,
      operatorRole: 'admin',
      metadata: {
        promoterId: salesperson._id.toString(),
      },
      createdAt: now,
    }) as any
  );

  await record.save();
  return getPromotionRecordByIdQuery(record._id);
}

/**
 * 手动释放报备记录到公海池
 */
export async function releaseToPool(recordId: string, operator?: { id?: string; name?: string; role?: string }, timelineType: 'pool_released' | 'pool_auto_released' = 'pool_released') {
  const record = await PromotionEnterpriseRecord.findById(recordId);
  if (!record) return null;

  const now = new Date();
  const previousPromoterId = record.promoterId ? String(record.promoterId) : undefined;
  const actionLabel = timelineType === 'pool_auto_released' ? '系统自动释放到公海池' : '释放到公海池';

  record.promoterId = undefined;
  record.poolStatus = 'in_pool';
  record.ownershipStatus = 'unassigned';
  record.pendingActionRole = 'none';
  record.lastActivityAt = now;
  record.protectionExpiresAt = undefined;
  record.protectionExtendedCount = 0;
  record.nextFollowUpAt = undefined;
  record.claimRequest = undefined;
  record.followUpRecords.push(
    createPromotionTimelineEntry({
      type: timelineType,
      content: operator?.name ? `${operator.name} ${actionLabel}` : actionLabel,
      operator: operator?.name || 'System',
      operatorId: operator?.id,
      operatorRole: operator?.role || 'system',
      metadata: previousPromoterId ? { previousPromoterId } : undefined,
      createdAt: now,
    }) as any
  );
  await record.save();
  return getPromotionRecordByIdQuery(record._id);
}

export async function approveClaimFromPool(recordId: string, operatorId: string) {
  const record = await PromotionEnterpriseRecord.findOne({
    _id: recordId,
    poolStatus: 'claimed',
    'claimRequest.status': 'pending',
  });
  if (!record || !record.claimRequest?.requestedBy) return null;

  const [salesperson, operator] = await Promise.all([
    AdminUser.findById(record.claimRequest.requestedBy).select('displayName username role'),
    AdminUser.findById(operatorId).select('displayName username role'),
  ]);

  if (!salesperson) {
    throw new Error('Target salesperson not found');
  }

  const config = await getPlatformPromotionConfig();
  const now = new Date();
  const protectionExpiresAt = new Date(now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000);

  record.promoterId = salesperson._id;
  record.poolStatus = 'protected';
  record.protectionExpiresAt = protectionExpiresAt;
  record.protectionExtendedCount = 0;
  record.ownershipStatus = 'manually_locked';
  record.pendingActionRole = 'salesperson';
  record.businessStage = record.businessStage === 'closed_lost' ? 'reported' : record.businessStage;
  record.lastActivityAt = now;
  record.claimRequest = {
    ...record.claimRequest,
    status: 'approved',
    reviewedBy: operator?._id || new mongoose.Types.ObjectId(operatorId),
    reviewedAt: now,
    rejectReason: undefined,
  } as any;
  record.followUpRecords.push(
    createPromotionTimelineEntry({
      type: 'pool_claim_approved',
      content: `${resolveOperatorName(operator)} 审批通过，${resolveOperatorName(salesperson)} 认领成功`,
      operator: resolveOperatorName(operator),
      operatorId: operator?._id || operatorId,
      operatorRole: operator?.role || 'admin',
      metadata: {
        promoterId: salesperson._id.toString(),
      },
      createdAt: now,
    }) as any
  );

  await record.save();
  return getPromotionRecordByIdQuery(record._id);
}

export async function rejectClaimFromPool(recordId: string, operatorId: string, reason?: string) {
  const record = await PromotionEnterpriseRecord.findOne({
    _id: recordId,
    poolStatus: 'claimed',
    'claimRequest.status': 'pending',
  });
  if (!record) return null;

  const [requester, operator] = await Promise.all([
    record.claimRequest?.requestedBy
      ? AdminUser.findById(record.claimRequest.requestedBy).select('displayName username role')
      : Promise.resolve(null),
    AdminUser.findById(operatorId).select('displayName username role'),
  ]);

  const now = new Date();
  record.promoterId = undefined;
  record.poolStatus = 'in_pool';
  record.ownershipStatus = 'unassigned';
  record.pendingActionRole = 'none';
  record.protectionExpiresAt = undefined;
  record.protectionExtendedCount = 0;
  record.nextFollowUpAt = undefined;
  record.lastActivityAt = now;
  record.claimRequest = {
    ...record.claimRequest,
    status: 'rejected',
    reviewedBy: operator?._id || new mongoose.Types.ObjectId(operatorId),
    reviewedAt: now,
    rejectReason: reason?.trim() || '',
  } as any;
  record.followUpRecords.push(
    createPromotionTimelineEntry({
      type: 'pool_claim_rejected',
      content: `${resolveOperatorName(operator)} 驳回了 ${resolveOperatorName(requester, '地推员')} 的认领申请`,
      operator: resolveOperatorName(operator),
      operatorId: operator?._id || operatorId,
      operatorRole: operator?.role || 'admin',
      metadata: {
        requestedBy: requester?._id ? String(requester._id) : undefined,
        rejectReason: reason?.trim() || '',
      },
      createdAt: now,
    }) as any
  );

  await record.save();
  return getPromotionRecordByIdQuery(record._id);
}

/**
 * 提交跟进后延长保护期
 */
export async function extendProtectionPeriod(record: any) {
  const config = await getPlatformPromotionConfig();
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
