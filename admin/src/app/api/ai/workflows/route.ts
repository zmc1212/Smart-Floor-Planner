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
import { getAiWorkflowStageAvailabilityFromDocs } from '@/lib/ai/workflow-service';
import type { IAiGeneration } from '@/models/AiGeneration';

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
  type: IAiGeneration['type'];
  stageKey?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  isSelectedBaseline?: boolean;
  nextRecommendedStage?: AiWorkflowStageKey;
  status: IAiGeneration['status'];
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  errorMessage?: string;
  provider?: string;
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
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const leadId = url.searchParams.get('leadId');
      const q = url.searchParams.get('q')?.trim();
      const requestedStatus = url.searchParams.get('status');
      const workflowFilter: Record<string, unknown> = {
        status: requestedStatus === 'archived' ? 'archived' : 'active',
      };

      if (leadId) {
        const lead = await Lead.findById(leadId).select('_id').lean();
        if (!lead) {
          return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
        }
        workflowFilter.leadId = lead._id;
      } else if (q) {
        const matchingLeads = await Lead.find({
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { phone: { $regex: q, $options: 'i' } },
            { communityName: { $regex: q, $options: 'i' } },
          ],
        }).select('_id').limit(100).lean();
        workflowFilter.leadId = { $in: matchingLeads.map((lead) => lead._id) };
      }

      const [workflows, total] = await Promise.all([
        AiWorkflow.find(workflowFilter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
        AiWorkflow.countDocuments(workflowFilter),
      ]);

      const workflowIds = workflows.map((workflow) => workflow._id);
      const leadIds = Array.from(new Set(workflows.map((workflow) => String(workflow.leadId))));
      const [generations, leads] = await Promise.all([
        workflowIds.length > 0
          ? AiGeneration.find({ workflowId: { $in: workflowIds } }).sort({ createdAt: -1 }).lean()
          : [],
        leadIds.length > 0
          ? Lead.find({ _id: { $in: leadIds } }).select('name phone communityName status').lean()
          : [],
      ]);

      const latestByWorkflow = new Map<string, LeanGeneration>();
      const countByWorkflow = new Map<string, number>();
      const generationsByWorkflow = new Map<string, LeanGeneration[]>();
      const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));

      generations.forEach((generation) => {
        const workflowId = String(generation.workflowId || '');
        if (!workflowId) {
          return;
        }

        if (!latestByWorkflow.has(workflowId)) {
          latestByWorkflow.set(workflowId, generation);
        }

        countByWorkflow.set(workflowId, (countByWorkflow.get(workflowId) || 0) + 1);
        const entries = generationsByWorkflow.get(workflowId) || [];
        entries.push(generation);
        generationsByWorkflow.set(workflowId, entries);
      });

      return NextResponse.json({
        success: true,
        data: workflows.map((workflow) => {
          const workflowId = String(workflow._id);
          const latestGeneration = latestByWorkflow.get(workflowId);
          const workflowGenerations = generationsByWorkflow.get(workflowId) || [];
          const selectedGeneration = workflow.selectedGenerationId
            ? workflowGenerations.find((generation) => String(generation._id) === String(workflow.selectedGenerationId))
            : workflowGenerations.find((generation) => generation.isSelectedBaseline);
          const lead = leadById.get(String(workflow.leadId));

          return {
            ...serializeAiWorkflow(workflow),
            generationCount: countByWorkflow.get(workflowId) || 0,
            latestGeneration: latestGeneration ? serializeAiGeneration(latestGeneration) : undefined,
            selectedGeneration: selectedGeneration ? serializeAiGeneration(selectedGeneration) : undefined,
            lead: lead
              ? {
                  id: String(lead._id),
                  name: lead.name,
                  phone: lead.phone,
                  communityName: lead.communityName,
                  status: lead.status,
                }
              : undefined,
            stageState: getAiWorkflowStageAvailabilityFromDocs(workflow, workflowGenerations),
          };
        }),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
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
