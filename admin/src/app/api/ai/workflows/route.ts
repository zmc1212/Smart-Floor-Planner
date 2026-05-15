import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiWorkflow } from '@/models/AiWorkflow';
import { AiGeneration } from '@/models/AiGeneration';
import Lead from '@/models/Lead';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { serializeAiGeneration, serializeAiWorkflow } from '@/lib/ai/workflow-utils';

interface CreateWorkflowBody {
  leadId?: string;
  title?: string;
  workflowLabel?: string;
  sourceImage?: string;
  sourceFloorPlanId?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
}

type LeanGeneration = {
  _id: unknown;
  leadId?: unknown;
  workflowId?: unknown;
  parentGenerationId?: unknown;
  type: 'floor_plan_style' | 'furnishing_render' | 'soft_furnishing_render' | 'advice' | 'scenario';
  stageKey?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  isSelectedBaseline?: boolean;
  nextRecommendedStage?: AiWorkflowStageKey;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  errorMessage?: string;
  provider: 'pollinations';
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
};

function buildDefaultWorkflowTitle(leadName: string, workflowCount: number, workflowLabel?: string) {
  if (workflowLabel?.trim()) {
    return `${leadName} · ${workflowLabel.trim()}`;
  }

  return workflowCount === 0 ? `${leadName} · 首轮方案` : `${leadName} · 方案 ${workflowCount + 1}`;
}

export async function GET(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async () => {
      const url = new URL(req.url);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
      const leadId = url.searchParams.get('leadId');

      if (!leadId) {
        return NextResponse.json(
          { success: false, error: 'Missing leadId' },
          { status: 400 }
        );
      }

      const lead = await Lead.findById(leadId)
        .populate({ path: 'floorPlanIds', select: 'name layoutData createdAt status', strictPopulate: false })
        .lean();

      if (!lead) {
        return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
      }

      const workflows = await AiWorkflow.find({ leadId: lead._id, status: 'active' })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

      const workflowIds = workflows.map((workflow) => workflow._id);
      const generations =
        workflowIds.length > 0
          ? await AiGeneration.find({ workflowId: { $in: workflowIds } })
              .sort({ createdAt: -1 })
              .lean()
          : [];

      const latestByWorkflow = new Map<string, LeanGeneration>();
      const countByWorkflow = new Map<string, number>();

      generations.forEach((generation) => {
        const workflowId = String(generation.workflowId || '');
        if (!workflowId) {
          return;
        }

        if (!latestByWorkflow.has(workflowId)) {
          latestByWorkflow.set(workflowId, generation);
        }

        countByWorkflow.set(workflowId, (countByWorkflow.get(workflowId) || 0) + 1);
      });

      return NextResponse.json({
        success: true,
        data: workflows.map((workflow) => {
          const workflowId = String(workflow._id);
          const latestGeneration = latestByWorkflow.get(workflowId);

          return {
            ...serializeAiWorkflow(workflow),
            generationCount: countByWorkflow.get(workflowId) || 0,
            latestGeneration: latestGeneration ? serializeAiGeneration(latestGeneration) : undefined,
          };
        }),
      });
    });
  } catch (error) {
    console.error('[AI Workflows GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load workflows' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const body = (await req.json()) as CreateWorkflowBody;
      const leadId = body.leadId?.trim();
      const sourceImage = body.sourceImage?.trim();
      const sourceFloorPlanId = body.sourceFloorPlanId?.trim();

      if (!leadId) {
        return NextResponse.json({ success: false, error: 'Missing leadId' }, { status: 400 });
      }

      const lead = await Lead.findById(leadId).lean();
      if (!lead) {
        return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
      }

      if (sourceFloorPlanId) {
        const hasFloorPlan = Array.isArray(lead.floorPlanIds)
          ? lead.floorPlanIds.some((item: unknown) => String(item) === sourceFloorPlanId)
          : false;

        if (!hasFloorPlan) {
          return NextResponse.json(
            { success: false, error: 'Selected floor plan does not belong to the lead' },
            { status: 400 }
          );
        }
      }

      if (!sourceFloorPlanId && (!sourceImage || !sourceImage.startsWith('data:image'))) {
        return NextResponse.json(
          { success: false, error: 'Please choose a lead asset or upload a reference image first' },
          { status: 400 }
        );
      }

      const workflowCount = await AiWorkflow.countDocuments({ leadId: lead._id });
      const workflowLabel = body.workflowLabel?.trim();
      const title =
        body.title?.trim() ||
        buildDefaultWorkflowTitle(lead.name || '客户方案', workflowCount, workflowLabel);

      const workflow = await AiWorkflow.create({
        enterpriseId: context.enterpriseId!,
        leadId: lead._id,
        operatorId: context.userId,
        title,
        workflowLabel,
        isPrimary: workflowCount === 0,
        sourceImage,
        sourceFloorPlanId: sourceFloorPlanId || undefined,
        sourceAssetRole: body.sourceAssetRole || (sourceFloorPlanId ? 'floor_plan' : 'rough_sketch'),
        currentStageKey: 'direction',
      });

      await Lead.updateOne(
        { _id: lead._id },
        {
          $push: {
            followUpRecords: {
              content: `已发起 AI 设计方案：${title}`,
              operator: context.username || 'System',
              createdAt: new Date(),
            },
          },
        }
      ).catch(() => undefined);

      return NextResponse.json({
        success: true,
        data: serializeAiWorkflow(workflow),
      });
    });
  } catch (error) {
    console.error('[AI Workflows POST]', error);
    return NextResponse.json({ success: false, error: 'Failed to create workflow' }, { status: 500 });
  }
}
