import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { listPostgresAiWorkflows } from '@/lib/ai/postgres-workflow-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: '仅企业员工可以查看 AI 方案' }, { status: 403 });
    const url = new URL(request.url);
    const floorPlanId = url.searchParams.get('floorPlanId') || undefined;
    const result = await listPostgresAiWorkflows({ enterpriseId: context.enterpriseId, operatorId: context.operatorId, leadId: url.searchParams.get('leadId') || undefined, query: url.searchParams.get('query') || undefined, page: Number(url.searchParams.get('page') || 1), limit: 20 });
    const data = result.data
      .filter((workflow) => !floorPlanId || workflow.sourceFloorPlanId === floorPlanId)
      .map((workflow) => ({ id: workflow.id, title: workflow.title, status: workflow.status, isPrimary: Boolean(workflow.isPrimary), currentStageKey: workflow.currentStageKey, currentStageLabel: workflow.currentStageLabel, recommendedMiniMode: workflow.currentStageKey === 'soft_furnishing' ? 'soft_furnishing' : workflow.currentStageKey === 'base_render' ? 'style_transform' : undefined, recommendedLabel: workflow.currentStageKey === 'soft_furnishing' ? '继续软装深化' : workflow.currentStageKey === 'base_render' ? '继续完善方案' : '请到后台继续深化', lead: workflow.lead, sourceFloorPlanId: workflow.sourceFloorPlanId, selectedTask: workflow.selectedGeneration, latestTask: workflow.latestGeneration, updatedAt: workflow.updatedAt }));
    return NextResponse.json({ success: true, data, pagination: result.pagination });
  } catch (error) {
    console.error('[Mini AI Workflows]', error);
    return NextResponse.json({ success: false, error: '读取客户 AI 方案失败' }, { status: 500 });
  }
}
