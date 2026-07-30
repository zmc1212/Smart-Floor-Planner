import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { FloorPlan } from '@/models/FloorPlan';
import Lead from '@/models/Lead';
import { AiGeneration } from '@/models/AiGeneration';
import {
  adaptSurveyGraphToRooms,
  buildSurveyFloorPlanNavigator,
  isFormalSurveyLayout,
} from '@/lib/survey-graph';
import {
  MINI_AI_WHOLE_PLAN_RENDER_VERSION,
  serializeMiniAiTask,
} from '@/lib/ai/mini-ai-tasks';
import {
  floorPlanIdsFromLead,
  listAccessibleMiniAiFloorPlanIds,
  listAccessibleMiniAiLeads,
} from '@/lib/ai/mini-ai-floorplan-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '仅企业员工可以选择 AI 户型来源' }, { status: 403 });
    }

    const enterpriseId = context.enterpriseId;
    const leads = await listAccessibleMiniAiLeads(context);
    const accessiblePlanIds = await listAccessibleMiniAiFloorPlanIds(context, leads);

    if (!accessiblePlanIds.length) {
      return NextResponse.json({ success: true, data: [], plans: [] });
    }

    const [floorPlans, planLeads, previewGenerations] = await Promise.all([
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
      AiGeneration.find({
        enterpriseId,
        floorPlanId: { $in: accessiblePlanIds },
        channel: 'miniprogram',
        'input.mode': 'floor_plan_render',
        'input.roomData.targetScope': 'whole_floor_plan',
        'input.roomData.navigationRenderVersion': MINI_AI_WHOLE_PLAN_RENDER_VERSION,
        status: { $in: ['created', 'pending', 'processing', 'succeeded'] },
        deletedAt: { $exists: false },
      })
        .sort({ createdAt: -1 })
        .limit(100),
    ]);

    const leadByPlanId = new Map<string, { id: string; name: string; communityName: string }>();
    [...leads, ...planLeads].forEach((lead) => {
      floorPlanIdsFromLead(lead).forEach((planId) => {
        if (!leadByPlanId.has(planId)) {
          leadByPlanId.set(planId, {
            id: String(lead._id),
            name: lead.name || '未命名客户',
            communityName: lead.communityName || '',
          });
        }
      });
    });

    const plans = floorPlans.flatMap((plan) => {
      if (!isFormalSurveyLayout(plan.layoutData)) return [];
      const lead = leadByPlanId.get(String(plan._id));
      const planGenerations = previewGenerations.filter(
        (generation) => String(generation.floorPlanId) === String(plan._id)
      );
      const planUpdatedAt = new Date(plan.updatedAt).getTime();
      const currentGenerations = planGenerations.filter(
        (generation) => new Date(generation.createdAt).getTime() >= planUpdatedAt
      );
      const activePreview = currentGenerations.find(
        (generation) => String(generation.operatorId) === String(context.operatorId)
          && ['created', 'pending', 'processing'].includes(generation.status)
      );
      const readyPreview = currentGenerations.find(
        (generation) => generation.status === 'succeeded' && generation.output?.imageUrl
      );
      const stalePreview = !readyPreview && planGenerations.some(
        (generation) => generation.status === 'succeeded' && generation.output?.imageUrl
      );
      const previewTask = activePreview || readyPreview;
      const serializedPreviewTask = previewTask
        ? serializeMiniAiTask(previewTask, request)
        : undefined;
      const serializedReadyPreview = readyPreview
        ? serializeMiniAiTask(readyPreview, request)
        : undefined;
      const compactPreviewTask = serializedPreviewTask ? {
        id: serializedPreviewTask.id,
        status: serializedPreviewTask.status,
        progress: serializedPreviewTask.progress,
        resultImageUrl: serializedPreviewTask.resultImageUrl,
      } : undefined;
      const compactReadyPreviewTask = serializedReadyPreview ? {
        id: serializedReadyPreview.id,
        status: serializedReadyPreview.status,
        progress: serializedReadyPreview.progress,
        resultImageUrl: serializedReadyPreview.resultImageUrl,
      } : undefined;
      const rooms = adaptSurveyGraphToRooms(plan.layoutData).map((room) => ({
        roomId: room.id,
        roomName: room.name,
        roomSize: `${(room.width / 10).toFixed(2)} × ${(room.height / 10).toFixed(2)} m`,
        openingCount: room.openings.length,
      }));
      if (!rooms.length) return [];
      return [{
        leadId: lead?.id || '',
        leadName: lead?.name || '未关联客户',
        communityName: lead?.communityName || '',
        floorPlanId: String(plan._id),
        floorPlanName: plan.name || '正式户型',
        floorPlanStatus: plan.status,
        closedRoomCount: rooms.length,
        rooms,
        navigator: buildSurveyFloorPlanNavigator(plan.layoutData),
        navigationPreview: {
          state: activePreview ? 'processing' : readyPreview ? 'ready' : stalePreview ? 'stale' : 'missing',
          task: compactPreviewTask,
          readyTask: compactReadyPreviewTask,
          imageUrl: serializedReadyPreview?.resultImageUrl,
        },
        updatedAt: plan.updatedAt,
      }];
    });

    const data = plans.flatMap((plan) => plan.rooms.map((room) => ({
      leadId: plan.leadId,
      leadName: plan.leadName,
      communityName: plan.communityName,
      floorPlanId: plan.floorPlanId,
      floorPlanName: plan.floorPlanName,
      floorPlanStatus: plan.floorPlanStatus,
      ...room,
      updatedAt: plan.updatedAt,
    })));

    return NextResponse.json({ success: true, data, plans });
  } catch (error) {
    console.error('[Mini AI Sources]', error);
    return NextResponse.json({ success: false, error: '加载客户户型失败' }, { status: 500 });
  }
}
