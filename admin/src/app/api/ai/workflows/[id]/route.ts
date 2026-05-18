import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiWorkflow } from '@/models/AiWorkflow';
import { AiGeneration } from '@/models/AiGeneration';
import { FloorPlan } from '@/models/FloorPlan';
import Lead from '@/models/Lead';
import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { serializeAiGeneration, serializeAiWorkflow } from '@/lib/ai/workflow-utils';

type LeanFloorPlan = {
  _id: unknown;
  name?: string;
  createdAt?: Date | string;
  status?: string;
};

// Force Mongoose model registration and prevent ESM tree-shaking
const _forceFloorPlan = FloorPlan.modelName;

interface WorkflowPatchBody {
  action?: 'select-generation' | 'set-stage' | 'rename' | 'mock-generation';
  generationId?: string;
  nextStageKey?: AiWorkflowStageKey;
  stageKey?: AiWorkflowStageKey;
  title?: string;
  imageUrl?: string;
  parentGenerationId?: string;
  sourceAssetRole?: string;
  styleReferenceImage?: string;
}

async function getWorkflowWithLead(workflowId: string) {
  const workflow = await AiWorkflow.findById(workflowId);

  if (!workflow) {
    return { workflow: null, lead: null };
  }

  const lead = await Lead.findById(workflow.leadId)
    .populate({ path: 'floorPlanIds', select: 'name layoutData createdAt status', strictPopulate: false })
    .lean();

  if (!lead) {
    return { workflow: null, lead: null };
  }

  return { workflow, lead };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async () => {
      const { id } = await params;
      const { workflow, lead } = await getWorkflowWithLead(id);

      if (!workflow || !lead) {
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
      }

      const generations = await AiGeneration.find({ workflowId: workflow._id })
        .sort({ createdAt: -1 })
        .lean();

      return NextResponse.json({
        success: true,
        data: {
          workflow: {
            ...serializeAiWorkflow(workflow),
            generationCount: generations.length,
            latestGeneration: generations.length > 0 ? serializeAiGeneration(generations[0]) : undefined,
          },
          lead: {
            id: String(lead._id),
            name: lead.name,
            phone: lead.phone,
            status: lead.status,
            stylePreference: lead.stylePreference,
            communityName: lead.communityName,
            floorPlans: Array.isArray(lead.floorPlanIds)
              ? (lead.floorPlanIds as LeanFloorPlan[]).map((plan) => ({
                  id: String(plan._id),
                  name: plan.name,
                  createdAt: plan.createdAt,
                  status: plan.status,
                }))
              : [],
            followUpCount: Array.isArray(lead.followUpRecords) ? lead.followUpRecords.length : 0,
          },
          generations: generations.map(serializeAiGeneration),
        },
      });
    });
  } catch (error) {
    console.error('[AI Workflow GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load workflow detail' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const body = (await req.json()) as WorkflowPatchBody;
      const { workflow, lead } = await getWorkflowWithLead(id);

      if (!workflow || !lead) {
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
      }

      if (body.action === 'rename') {
        workflow.title = body.title?.trim() || workflow.title;
        await workflow.save();
      } else if (body.action === 'set-stage') {
        if (!body.stageKey) {
          return NextResponse.json({ success: false, error: 'Missing stageKey' }, { status: 400 });
        }

        workflow.currentStageKey = body.stageKey;
        await workflow.save();
      } else if (body.action === 'select-generation') {
        if (!body.generationId) {
          return NextResponse.json({ success: false, error: 'Missing generationId' }, { status: 400 });
        }

        const generation = await AiGeneration.findOne({
          _id: body.generationId,
          workflowId: workflow._id,
        });

        if (!generation) {
          return NextResponse.json({ success: false, error: 'Generation not found in workflow' }, { status: 404 });
        }

        await AiGeneration.updateMany(
          { workflowId: workflow._id, isSelectedBaseline: true },
          { $set: { isSelectedBaseline: false } }
        );

        generation.isSelectedBaseline = true;
        await generation.save();

        workflow.selectedGenerationId = generation._id;
        workflow.lastGenerationId = generation._id;
        if (body.nextStageKey) {
          workflow.currentStageKey = body.nextStageKey;
        }
        await workflow.save();
      } else if (body.action === 'mock-generation') {
        if (!body.stageKey || !body.imageUrl) {
          return NextResponse.json({ success: false, error: 'Missing stageKey or imageUrl' }, { status: 400 });
        }

        const generation = await AiGeneration.create({
          enterpriseId: workflow.enterpriseId,
          leadId: workflow.leadId,
          workflowId: workflow._id,
          operatorId: context.userId,
          parentGenerationId: body.parentGenerationId,
          type: 'scenario',
          stageKey: body.stageKey,
          sourceAssetRole: body.sourceAssetRole || workflow.sourceAssetRole,
          status: 'succeeded',
          input: {
            style: 'mock',
            customPrompt: '手动上传的本地图片（跳过 AI 生成）',
            styleReferenceImage: body.styleReferenceImage,
          },
          output: {
            imageUrl: body.imageUrl,
            promptUsed: '手动上传测试图',
          },
          provider: 'pollinations',
        });

        if (body.nextStageKey) {
          workflow.currentStageKey = body.nextStageKey;
          await workflow.save();
        }
      } else {
        return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 });
      }

      const refreshedWorkflow = await AiWorkflow.findById(workflow._id).lean();
      const generations = await AiGeneration.find({ workflowId: workflow._id })
        .sort({ createdAt: -1 })
        .lean();

      return NextResponse.json({
        success: true,
        data: {
          workflow: {
            ...(refreshedWorkflow ? serializeAiWorkflow(refreshedWorkflow) : serializeAiWorkflow(workflow)),
            generationCount: generations.length,
            latestGeneration: generations.length > 0 ? serializeAiGeneration(generations[0]) : undefined,
          },
          lead: {
            id: String(lead._id),
            name: lead.name,
            phone: lead.phone,
            status: lead.status,
            stylePreference: lead.stylePreference,
            communityName: lead.communityName,
            floorPlans: Array.isArray(lead.floorPlanIds)
              ? (lead.floorPlanIds as LeanFloorPlan[]).map((plan) => ({
                  id: String(plan._id),
                  name: plan.name,
                  createdAt: plan.createdAt,
                  status: plan.status,
                }))
              : [],
            followUpCount: Array.isArray(lead.followUpRecords) ? lead.followUpRecords.length : 0,
          },
          generations: generations.map(serializeAiGeneration),
        },
      });
    });
  } catch (error) {
    console.error('[AI Workflow PATCH]', error);
    return NextResponse.json({ success: false, error: 'Failed to update workflow' }, { status: 500 });
  }
}
