import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiWorkflow } from '@/models/AiWorkflow';
import { AiGeneration } from '@/models/AiGeneration';
import { FloorPlan } from '@/models/FloorPlan';
import Lead from '@/models/Lead';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { serializeAiGeneration, serializeAiWorkflow } from '@/lib/ai/workflow-utils';
import { createAiWorkflow } from '@/lib/ai/workflow-service';

interface CreateWorkflowBody {
  leadId?: string;
  title?: string;
  workflowLabel?: string;
  sourceImage?: string;
  sourceFloorPlanId?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
}

// Force Mongoose model registration and prevent ESM tree-shaking
void FloorPlan.modelName;

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
      let workflow;
      try {
        workflow = await createAiWorkflow(
          {
            leadId: body.leadId || '',
            title: body.title,
            workflowLabel: body.workflowLabel,
            sourceImage: body.sourceImage,
            sourceFloorPlanId: body.sourceFloorPlanId,
            sourceAssetRole: body.sourceAssetRole,
          },
          context
        );
      } catch (error) {
        return NextResponse.json(
          { success: false, error: error instanceof Error ? error.message : 'Failed to create workflow' },
          { status: 400 }
        );
      }

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
