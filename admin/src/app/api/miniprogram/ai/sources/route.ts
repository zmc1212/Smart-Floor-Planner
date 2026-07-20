import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { FloorPlan } from '@/models/FloorPlan';
import Lead from '@/models/Lead';
import { adaptSurveyGraphToRooms, isFormalSurveyLayout } from '@/lib/survey-graph';

export const dynamic = 'force-dynamic';

function planIdsFromLead(lead: { floorPlanIds?: unknown[]; primaryFloorPlanId?: unknown }) {
  return [...(lead.floorPlanIds || []), lead.primaryFloorPlanId]
    .filter(Boolean)
    .map((value) => String(value));
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '仅企业员工可以选择 AI 户型来源' }, { status: 403 });
    }

    const enterpriseId = context.enterpriseId;
    const operatorId = context.operatorId;
    const role = context.role;
    const leadFilter: Record<string, unknown> = { enterpriseId };
    if (role === 'designer') leadFilter.assignedTo = operatorId;
    if (role === 'salesperson') leadFilter.promoterId = operatorId;

    const leads = await Lead.find(leadFilter)
      .select('name communityName floorPlanIds primaryFloorPlanId updatedAt')
      .sort({ updatedAt: -1 })
      .limit(80)
      .lean();

    let accessiblePlanIds = Array.from(new Set(leads.flatMap(planIdsFromLead)));
    if (role === 'designer' || role === 'measurer') {
      const assignedPlans = await FloorPlan.find({ enterpriseId, staffId: operatorId })
        .select('_id')
        .sort({ updatedAt: -1 })
        .limit(80)
        .lean();
      const assignedPlanIds = assignedPlans.map((plan) => String(plan._id));
      accessiblePlanIds = role === 'designer'
        ? Array.from(new Set([...accessiblePlanIds, ...assignedPlanIds]))
        : assignedPlanIds;
    }

    if (['enterprise_admin', 'admin', 'super_admin'].includes(role)) {
      const enterprisePlans = await FloorPlan.find({ enterpriseId })
        .select('_id')
        .sort({ updatedAt: -1 })
        .limit(80)
        .lean();
      accessiblePlanIds = enterprisePlans.map((plan) => String(plan._id));
    }

    if (!accessiblePlanIds.length) {
      return NextResponse.json({ success: true, data: [] });
    }

    const [plans, planLeads] = await Promise.all([
      FloorPlan.find({ _id: { $in: accessiblePlanIds }, enterpriseId })
        .select('name status layoutData updatedAt')
        .sort({ updatedAt: -1 })
        .lean(),
      Lead.find({
        enterpriseId,
        $or: [
          { floorPlanIds: { $in: accessiblePlanIds } },
          { primaryFloorPlanId: { $in: accessiblePlanIds } },
        ],
      })
        .select('name communityName floorPlanIds primaryFloorPlanId')
        .lean(),
    ]);

    const leadByPlanId = new Map<string, { id: string; name: string; communityName: string }>();
    [...leads, ...planLeads].forEach((lead) => {
      planIdsFromLead(lead).forEach((planId) => {
        if (!leadByPlanId.has(planId)) {
          leadByPlanId.set(planId, {
            id: String(lead._id),
            name: lead.name || '未命名客户',
            communityName: lead.communityName || '',
          });
        }
      });
    });

    const data = plans.flatMap((plan) => {
      if (!isFormalSurveyLayout(plan.layoutData)) return [];
      const lead = leadByPlanId.get(String(plan._id));
      return adaptSurveyGraphToRooms(plan.layoutData).map((room) => ({
        leadId: lead?.id || '',
        leadName: lead?.name || '未关联客户',
        communityName: lead?.communityName || '',
        floorPlanId: String(plan._id),
        floorPlanName: plan.name || '正式户型',
        floorPlanStatus: plan.status,
        roomId: room.id,
        roomName: room.name,
        roomSize: `${(room.width / 10).toFixed(2)} × ${(room.height / 10).toFixed(2)} m`,
        openingCount: room.openings.length,
        updatedAt: plan.updatedAt,
      }));
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Mini AI Sources]', error);
    return NextResponse.json({ success: false, error: '加载客户户型失败' }, { status: 500 });
  }
}
