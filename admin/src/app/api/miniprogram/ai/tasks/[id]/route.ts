import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { serializeMiniAiTask, syncMiniAiWorkflow } from '@/lib/ai/mini-ai-tasks';
import { reconcileAiGeneration } from '@/lib/ai/execution-service';
import { AiWorkflow } from '@/models/AiWorkflow';
import Lead from '@/models/Lead';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const generation = await AiGeneration.findOne({
      _id: id,
      enterpriseId: context.enterpriseId,
      operatorId: context.operatorId,
      channel: 'miniprogram',
      deletedAt: { $exists: false },
    });
    if (!generation) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    const current = generation.status === 'processing'
      ? await reconcileAiGeneration(generation)
      : generation;
    await syncMiniAiWorkflow(current, context);
    const [workflow, lead] = await Promise.all([
      current.workflowId ? AiWorkflow.findById(current.workflowId).select('title').lean() : null,
      current.leadId ? Lead.findById(current.leadId).select('name').lean() : null,
    ]);
    return NextResponse.json({ success: true, data: serializeMiniAiTask(current, request, {
      workflowTitle: workflow?.title,
      leadName: lead?.name,
    }) });
  } catch (error) {
    console.error('[Mini AI Task Detail]', error);
    return NextResponse.json({ success: false, error: '读取 AI 任务失败' }, { status: 500 });
  }
}
