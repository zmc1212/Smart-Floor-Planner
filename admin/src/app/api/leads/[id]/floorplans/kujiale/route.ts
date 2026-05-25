import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { tenantStorage } from '@/lib/tenant-context';
import { convertKujialeDetailToLayoutData, getKujialeFloorPlanDetail } from '@/lib/kujiale';
import Lead from '@/models/Lead';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

type ImportContext = {
  role: string;
  userId: string;
  enterpriseId?: string | null;
  username?: string;
  miniProgramUser?: any;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function normalizeObjectId(value: unknown) {
  if (!value) return undefined;
  const id = typeof value === 'object' && value !== null && '_id' in value ? (value as { _id?: unknown })._id : value;
  return mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : undefined;
}

function buildLeadAccessFilter(leadId: string, context: ImportContext) {
  const filter: Record<string, unknown> = { _id: leadId };

  if ((context.role === 'super_admin' || context.role === 'admin') && !context.enterpriseId) {
    return filter;
  }

  if (context.enterpriseId) {
    filter.enterpriseId = new mongoose.Types.ObjectId(context.enterpriseId);
  }

  if (context.role === 'enterprise_admin') {
    return filter;
  }

  if (context.role === 'designer' || context.role === 'salesperson' || context.role === 'measurer') {
    const staffObjectId = new mongoose.Types.ObjectId(context.userId);
    filter.$or = [{ promoterId: staffObjectId }, { assignedTo: staffObjectId }];
  }

  return filter;
}

async function resolveCreatorForLead(lead: any, context: ImportContext) {
  const directUserId = normalizeObjectId(context.miniProgramUser?._id);
  if (directUserId) return directUserId;

  const enterpriseId = normalizeObjectId(lead.enterpriseId || context.enterpriseId);
  const query: Record<string, unknown> = { phone: lead.phone };
  if (enterpriseId) query.enterpriseId = enterpriseId;

  let user = await User.findOne(query);
  if (!user) {
    user = await User.create({
      nickname: lead.name,
      phone: lead.phone,
      communityName: lead.communityName,
      city: lead.city,
      role: 'user',
      enterpriseId,
    });
  }
  return user._id;
}

async function importKujialeFloorPlan(leadId: string, externalId: string, context: ImportContext) {
  const lead = await Lead.findOne(buildLeadAccessFilter(leadId, context));
  if (!lead) {
    return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
  }

  const detail = await getKujialeFloorPlanDetail(externalId);
  const layoutData = convertKujialeDetailToLayoutData(detail);
  const creator = await resolveCreatorForLead(lead, context);
  const enterpriseId = normalizeObjectId(lead.enterpriseId || context.enterpriseId);
  const staffId = normalizeObjectId(context.userId);
  const floorPlanName =
    detail.name ||
    [lead.communityName || detail.communityName, detail.layoutLabel].filter(Boolean).join(' ') ||
    `${lead.name} 的酷家乐户型`;

  const floorPlanFilter: Record<string, unknown> = {
    'externalSource.provider': 'kujiale',
    'externalSource.externalId': detail.externalId || externalId,
  };
  if (enterpriseId) floorPlanFilter.enterpriseId = enterpriseId;

  const setData: Record<string, unknown> = {
    name: floorPlanName,
    layoutData,
    source: 'kujiale',
    status: 'completed',
    externalSource: {
      provider: 'kujiale',
      externalId: detail.externalId || externalId,
      communityName: detail.communityName || lead.communityName,
      city: detail.city || lead.city,
      area: detail.area || lead.area,
      layoutLabel: detail.layoutLabel,
      previewUrl: detail.previewUrl,
      importedAt: new Date(),
      rawSummary: {
        ...(detail.rawSummary || {}),
        importedRoomCount: layoutData.length,
      },
    },
  };

  if (staffId) setData.staffId = staffId;
  if (enterpriseId) setData.enterpriseId = enterpriseId;

  const floorPlan = await FloorPlan.findOneAndUpdate(
    floorPlanFilter,
    {
      $set: setData,
      $setOnInsert: {
        creator,
      },
    },
    { new: true, upsert: true, runValidators: true }
  );

  const updatedLead = await Lead.findOneAndUpdate(
    { _id: lead._id },
    {
      $addToSet: { floorPlanIds: floorPlan._id },
      $set: {
        primaryFloorPlanId: floorPlan._id,
        status: 'measured',
      },
    },
    { new: true, runValidators: true }
  )
    .populate({ path: 'primaryFloorPlanId', select: 'name layoutData createdAt status source externalSource', strictPopulate: false })
    .populate({ path: 'floorPlanIds', select: 'name layoutData createdAt status source externalSource', strictPopulate: false });

  return NextResponse.json({
    success: true,
    data: {
      lead: updatedLead,
      floorPlan,
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await request.json();
    const externalId = typeof body.externalId === 'string' ? body.externalId.trim() : '';

    if (!externalId) {
      return NextResponse.json({ success: false, error: 'externalId is required' }, { status: 400 });
    }

    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext) {
      if (!mpContext.staff) {
        return NextResponse.json({ success: false, error: 'Staff profile not found' }, { status: 403 });
      }

      const store = {
        enterpriseId: mpContext.enterpriseId ? String(mpContext.enterpriseId) : null,
        role: mpContext.staff.role,
        userId: String(mpContext.staff._id),
      };

      return await tenantStorage.run(store, async () =>
        importKujialeFloorPlan(id, externalId, {
          role: mpContext.staff.role,
          userId: String(mpContext.staff._id),
          enterpriseId: mpContext.enterpriseId ? String(mpContext.enterpriseId) : null,
          miniProgramUser: mpContext.user,
        })
      );
    }

    const adminContext = await getTenantContext(request);
    if (!adminContext) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return await tenantStorage.run(
      {
        enterpriseId: adminContext.enterpriseId,
        role: adminContext.role,
        userId: adminContext.userId,
        username: adminContext.username,
      },
      async () => importKujialeFloorPlan(id, externalId, adminContext)
    );
  } catch (error: unknown) {
    console.error('Import KuJiale floor plan error:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
