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
} from '@/lib/workflow-automation';

export async function getMiniProgramStaffContext(openid: string) {
  const user = await User.findOne({ openid });
  if (!user || user.role !== 'staff') {
    return { user: null, staff: null };
  }

  const staff = await AdminUser.findOne({
    status: 'active',
    $or: [{ openid }, ...(user.phone ? [{ phone: user.phone }] : [])],
  });

  return { user, staff };
}

export function buildPromotionAccessFilter(staff: { role: string; _id: unknown; enterpriseId?: unknown }) {
  const filter: Record<string, unknown> = {};
  if (staff.enterpriseId) {
    filter.enterpriseId = staff.enterpriseId;
  }

  if (staff.role === 'salesperson') {
    filter.promoterId = staff._id;
  } else if (staff.role === 'measurer') {
    filter['measureTask.assignedTo'] = staff._id;
  } else if (staff.role === 'designer') {
    filter['designTask.assignedTo'] = staff._id;
  }

  return filter;
}

export function buildPromotionDuplicateQuery(input: {
  enterpriseId?: unknown;
  creditCode?: string;
  enterpriseName: string;
  phone: string;
}) {
  const orConditions: Record<string, unknown>[] = [];
  if (input.creditCode) {
    orConditions.push({ creditCode: input.creditCode.trim().toUpperCase() });
  }

  orConditions.push({
    enterpriseName: input.enterpriseName.trim(),
    phone: input.phone.trim(),
  });

  const query: Record<string, unknown> = { $or: orConditions };
  if (input.enterpriseId) {
    query.enterpriseId = input.enterpriseId;
  }

  return query;
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
  const commissionAmount = Math.max(Number(enterprise?.groundPromotionFixedCommission || 0), 0);

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
