import mongoose from 'mongoose';
import { FloorPlan, type IFloorPlan } from '@/models/FloorPlan';
import Lead from '@/models/Lead';
import type { MiniAiContext } from '@/lib/ai/mini-ai-auth';

const ADMIN_ROLES = new Set(['enterprise_admin', 'admin', 'super_admin']);

export function isMiniAiAdminRole(role: string) {
  return ADMIN_ROLES.has(role);
}

export function buildMiniAiLeadFilter(context: MiniAiContext): Record<string, unknown> {
  const filter: Record<string, unknown> = { enterpriseId: context.enterpriseId };
  if (context.role === 'designer') filter.assignedTo = context.operatorId;
  if (context.role === 'salesperson') filter.promoterId = context.operatorId;
  return filter;
}

export function floorPlanIdsFromLead(lead: { floorPlanIds?: unknown[]; primaryFloorPlanId?: unknown }) {
  return [...(lead.floorPlanIds || []), lead.primaryFloorPlanId]
    .filter(Boolean)
    .map((value) => String(value));
}

export async function listAccessibleMiniAiLeads(context: MiniAiContext, limit = 80) {
  return Lead.find(buildMiniAiLeadFilter(context))
    .select('name communityName floorPlanIds primaryFloorPlanId updatedAt')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
}

export async function listAccessibleMiniAiFloorPlanIds(
  context: MiniAiContext,
  leads: Awaited<ReturnType<typeof listAccessibleMiniAiLeads>>
) {
  let planIds = Array.from(new Set(leads.flatMap(floorPlanIdsFromLead)));

  if (context.role === 'designer' || context.role === 'measurer') {
    const assignedPlans = await FloorPlan.find({
      enterpriseId: context.enterpriseId,
      staffId: context.operatorId,
    })
      .select('_id')
      .sort({ updatedAt: -1 })
      .limit(80)
      .lean();
    const assignedPlanIds = assignedPlans.map((plan) => String(plan._id));
    planIds = context.role === 'designer'
      ? Array.from(new Set([...planIds, ...assignedPlanIds]))
      : assignedPlanIds;
  }

  if (isMiniAiAdminRole(context.role)) {
    const enterprisePlans = await FloorPlan.find({ enterpriseId: context.enterpriseId })
      .select('_id')
      .sort({ updatedAt: -1 })
      .limit(80)
      .lean();
    planIds = enterprisePlans.map((plan) => String(plan._id));
  }

  return planIds;
}

export async function findAccessibleMiniAiFloorPlan(
  floorPlanId: string,
  context: MiniAiContext
): Promise<IFloorPlan | null> {
  if (!mongoose.Types.ObjectId.isValid(floorPlanId)) return null;
  const plan = await FloorPlan.findOne({
    _id: floorPlanId,
    enterpriseId: context.enterpriseId,
  });
  if (!plan) return null;
  if (isMiniAiAdminRole(context.role)) return plan;
  if (context.role === 'measurer') {
    return String(plan.staffId || '') === String(context.operatorId) ? plan : null;
  }
  if (context.role === 'designer' && String(plan.staffId || '') === String(context.operatorId)) {
    return plan;
  }

  const linkedLead = await Lead.exists({
    ...buildMiniAiLeadFilter(context),
    $or: [
      { floorPlanIds: plan._id },
      { primaryFloorPlanId: plan._id },
    ],
  });
  return linkedLead ? plan : null;
}
