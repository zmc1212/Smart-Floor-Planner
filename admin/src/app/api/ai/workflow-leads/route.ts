import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import Lead from '@/models/Lead';
import { FloorPlan } from '@/models/FloorPlan';
import { AiWorkflow } from '@/models/AiWorkflow';
import { getTenantFilter } from '@/lib/auth';
import { isEligibleWorkflowFloorPlan } from '@/lib/ai/workflow-floorplan';

type LeanFloorPlan = {
  _id: unknown;
  name?: string;
  layoutData?: unknown;
  createdAt?: Date | string;
  status?: string;
};

// Force Mongoose model registration and prevent ESM tree-shaking
void FloorPlan.modelName;

type LeanLead = {
  _id: unknown;
  name: string;
  phone: string;
  status: string;
  stylePreference?: string;
  communityName?: string;
  floorPlanIds?: LeanFloorPlan[];
  followUpRecords?: unknown[];
};

export async function GET(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const url = new URL(req.url);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
      const search = url.searchParams.get('search')?.trim();

      const tenantFilter = getTenantFilter(context);
      let query: Record<string, unknown> = { ...tenantFilter };

      if (search) {
        query = {
          $and: [
            tenantFilter,
            {
              $or: [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { communityName: { $regex: search, $options: 'i' } },
              ]
            }
          ]
        };
      }

      const leads = await Lead.find(query)
        .populate({ path: 'floorPlanIds', select: 'name layoutData createdAt status', strictPopulate: false })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

      const leadIds = leads.map((lead) => lead._id);
      const workflowEnterpriseId = context.enterpriseId
        ? new mongoose.Types.ObjectId(String(context.enterpriseId))
        : context.enterpriseId;
      const workflowCounts =
        leadIds.length > 0
          ? await AiWorkflow.aggregate([
              {
                $match: {
                  enterpriseId: workflowEnterpriseId,
                  leadId: { $in: leadIds },
                  status: 'active',
                },
              },
              { $sort: { updatedAt: -1 } },
              {
                $group: {
                  _id: '$leadId',
                  count: { $sum: 1 },
                  latestWorkflowId: { $first: '$_id' },
                  latestWorkflowTitle: { $first: '$title' },
                  latestUpdatedAt: { $first: '$updatedAt' },
                },
              },
            ])
          : [];

      const workflowMap = new Map(
        workflowCounts.map((item) => [
          String(item._id),
          {
            count: item.count as number,
            latestWorkflowId: item.latestWorkflowId ? String(item.latestWorkflowId) : undefined,
            latestWorkflowTitle: item.latestWorkflowTitle as string | undefined,
            latestUpdatedAt: item.latestUpdatedAt,
          },
        ])
      );

      return NextResponse.json({
        success: true,
        data: (leads as LeanLead[]).map((lead) => {
          const workflowMeta = workflowMap.get(String(lead._id));
          return {
            id: String(lead._id),
            name: lead.name,
            phone: lead.phone,
            status: lead.status,
            stylePreference: lead.stylePreference,
            communityName: lead.communityName,
            floorPlans: Array.isArray(lead.floorPlanIds)
              ? lead.floorPlanIds.filter(isEligibleWorkflowFloorPlan).map((plan) => ({
                  id: String(plan._id),
                  name: plan.name,
                  layoutData: plan.layoutData,
                  createdAt: plan.createdAt,
                  status: plan.status,
                }))
              : [],
            workflowCount: workflowMeta?.count || 0,
            latestWorkflowId: workflowMeta?.latestWorkflowId,
            latestWorkflowTitle: workflowMeta?.latestWorkflowTitle,
            latestWorkflowUpdatedAt: workflowMeta?.latestUpdatedAt,
            followUpCount: Array.isArray(lead.followUpRecords) ? lead.followUpRecords.length : 0,
          };
        }),
      });
    });
  } catch (error) {
    console.error('[AI Workflow Leads GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load workflow leads' }, { status: 500 });
  }
}
