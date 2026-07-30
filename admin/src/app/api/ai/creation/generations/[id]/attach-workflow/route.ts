import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiGeneration } from '@/models/AiGeneration';
import { AiWorkflow } from '@/models/AiWorkflow';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const body = await request.json() as { workflowId?: string };
      if (!body.workflowId) {
        return NextResponse.json({ success: false, error: '请选择客户方案' }, { status: 400 });
      }
      const [generation, workflow] = await Promise.all([
        AiGeneration.findOne({
          _id: id,
          enterpriseId: context.enterpriseId,
          type: 'free_create',
          status: 'succeeded',
          deletedAt: { $exists: false },
        }),
        AiWorkflow.findOne({
          _id: body.workflowId,
          enterpriseId: context.enterpriseId,
          status: 'active',
        }),
      ]);
      if (!generation) return NextResponse.json({ success: false, error: '生成结果不存在' }, { status: 404 });
      if (!workflow) return NextResponse.json({ success: false, error: '客户方案不存在' }, { status: 404 });

      generation.workflowId = workflow._id;
      generation.leadId = workflow.leadId;
      generation.stageKey = 'base_render';
      generation.sourceAssetRole = 'base_render';
      generation.nextRecommendedStage = 'soft_furnishing';
      workflow.lastGenerationId = generation._id;
      if (!workflow.selectedGenerationId) {
        generation.isSelectedBaseline = true;
        workflow.selectedGenerationId = generation._id;
        workflow.currentStageKey = 'soft_furnishing';
      }
      await Promise.all([generation.save(), workflow.save()]);
      return NextResponse.json({
        success: true,
        data: { generationId: String(generation._id), workflowId: String(workflow._id) },
      });
    });
  } catch (error) {
    console.error('[AI Creation Attach Workflow]', error);
    return NextResponse.json({ success: false, error: '归入客户方案失败' }, { status: 500 });
  }
}
