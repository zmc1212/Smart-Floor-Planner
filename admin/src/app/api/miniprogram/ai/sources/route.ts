import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { FloorPlanRepository, AiCreationRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';
import { adaptSurveyGraphToRooms, buildSurveyFloorPlanNavigator, isFormalSurveyLayout } from '@/lib/survey-graph';
import { MINI_AI_WHOLE_PLAN_RENDER_VERSION, serializePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: '仅企业员工可以选择 AI 户型来源' }, { status: 403 });
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const operatorId = parsePostgresId(context.operatorId, 'operatorId');
    const result = await withTenantTransaction(enterpriseId, async (transaction) => {
      const plans = (await new FloorPlanRepository(transaction).list({ formalOnly: true, limit: 80 })).rows;
      const leads = await new LeadRepository(transaction).list({ limit: 120 });
      const visibleLeads = leads.rows.filter((lead) => (
        ['enterprise_admin', 'admin', 'super_admin'].includes(context.role)
        || context.role === 'salesperson' && lead.promoterId === operatorId
        || context.role === 'designer' && lead.assignedTo === operatorId
      ));
      const accessible = plans.filter((plan) => ['enterprise_admin', 'admin', 'super_admin'].includes(context.role) || (context.role === 'measurer' || context.role === 'designer') && plan.staffId === operatorId || visibleLeads.some((lead) => lead.floorPlanRecords.some((item) => item.id === plan.id)));
      const generations = await new AiCreationRepository(transaction).listMiniProgramGenerationsByFloorPlanIds(accessible.map((plan) => plan.id));
      const leadByPlan = new Map<bigint, typeof leads.rows[number]>();
      visibleLeads.forEach((lead) => lead.floorPlanRecords.forEach((plan) => leadByPlan.set(plan.id, lead)));
      return accessible.flatMap((plan) => {
        if (!isFormalSurveyLayout(plan.layoutData)) return [];
        const rooms = adaptSurveyGraphToRooms(plan.layoutData).map((room) => ({ roomId: room.id, roomName: room.name, roomSize: `${(room.width / 10).toFixed(2)} m x ${(room.height / 10).toFixed(2)} m`, openingCount: room.openings.length }));
        if (!rooms.length) return [];
        const matching = generations.filter((generation) => generation.floorPlanId === plan.id && asRecord(generation.input).mode === 'floor_plan_render' && asRecord(asRecord(generation.input).roomData).targetScope === 'whole_floor_plan' && asRecord(asRecord(generation.input).roomData).navigationRenderVersion === MINI_AI_WHOLE_PLAN_RENDER_VERSION);
        const current = matching.filter((generation) => generation.createdAt >= plan.updatedAt);
        const active = current.find((generation) => ['pending', 'created', 'processing'].includes(generation.status));
        const ready = current.find((generation) => generation.status === 'succeeded' && asRecord(generation.output).imageUrl);
        const lead = leadByPlan.get(plan.id);
        return [{ leadId: lead?.id.toString() || '', leadName: lead?.name || '未关联客户', communityName: lead?.communityName || '', floorPlanId: plan.id.toString(), floorPlanName: plan.name || '正式户型', floorPlanStatus: plan.status, closedRoomCount: rooms.length, rooms, navigator: buildSurveyFloorPlanNavigator(plan.layoutData), navigationPreview: { state: active ? 'processing' : ready ? 'ready' : matching.some((generation) => generation.status === 'succeeded') ? 'stale' : 'missing', task: active ? serializePostgresMiniAiTask(active, request) : undefined, readyTask: ready ? serializePostgresMiniAiTask(ready, request) : undefined, imageUrl: ready ? serializePostgresMiniAiTask(ready, request).resultImageUrl : undefined }, updatedAt: plan.updatedAt }];
      });
    });
    const data = result.flatMap((plan) => plan.rooms.map((room) => ({ leadId: plan.leadId, leadName: plan.leadName, communityName: plan.communityName, floorPlanId: plan.floorPlanId, floorPlanName: plan.floorPlanName, floorPlanStatus: plan.floorPlanStatus, ...room, updatedAt: plan.updatedAt })));
    return NextResponse.json({ success: true, data, plans: result });
  } catch (error) {
    console.error('[Mini AI Sources]', error);
    return NextResponse.json({ success: false, error: '加载客户户型失败' }, { status: 500 });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
