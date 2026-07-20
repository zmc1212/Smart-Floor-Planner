import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { serializeMiniAiTask } from '@/lib/ai/mini-ai-tasks';
import { reconcileAiGeneration } from '@/lib/ai/execution-service';
import { AiWorkflow } from '@/models/AiWorkflow';
import Lead from '@/models/Lead';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 12)));
    const filter = {
      enterpriseId: context.enterpriseId,
      operatorId: context.operatorId,
      channel: 'miniprogram',
      deletedAt: { $exists: false },
    };
    const [items, total] = await Promise.all([
      AiGeneration.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AiGeneration.countDocuments(filter),
    ]);
    let reconciledProcessingTasks = 0;
    for (let index = 0; index < items.length && reconciledProcessingTasks < 4; index += 1) {
      if (items[index].status !== 'processing') continue;
      reconciledProcessingTasks += 1;
      try {
        const reconciled = await reconcileAiGeneration(items[index], { force: true });
        items[index] = reconciled as typeof items[number];
      } catch (error) {
        console.error('[Mini AI History Reconcile]', error);
        items[index] = await AiGeneration.findById(items[index]._id) || items[index];
      }
    }
    const workflowIds = Array.from(new Set(items.map((item) => item.workflowId).filter(Boolean).map(String)));
    const leadIds = Array.from(new Set(items.map((item) => item.leadId).filter(Boolean).map(String)));
    const [workflows, leads] = await Promise.all([
      workflowIds.length ? AiWorkflow.find({ _id: { $in: workflowIds }, enterpriseId: context.enterpriseId }).select('title').lean() : [],
      leadIds.length ? Lead.find({ _id: { $in: leadIds }, enterpriseId: context.enterpriseId }).select('name').lean() : [],
    ]);
    const workflowById = new Map(workflows.map((workflow) => [String(workflow._id), workflow]));
    const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));
    return NextResponse.json({
      success: true,
      data: items.map((item) => serializeMiniAiTask(item, request, {
        workflowTitle: item.workflowId ? workflowById.get(String(item.workflowId))?.title : undefined,
        leadName: item.leadId ? leadById.get(String(item.leadId))?.name : undefined,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[Mini AI History]', error);
    return NextResponse.json({ success: false, error: '读取历史失败' }, { status: 500 });
  }
}
