import { NextResponse } from 'next/server';
import {
  floorPlanToDto,
  leadToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  FloorPlanRepository,
  LeadRepository,
  UserRepository,
  type LeadWithRelations,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext, type TenantContext } from '@/lib/auth';
import { persistAndAttachFloorPlanPreview } from '@/lib/floor-plan-preview';
import {
  convertKujialeDetailToLayoutData,
  getKujialeFloorPlanDetail,
  type KujialeFloorPlanDetail,
} from '@/lib/kujiale';
import {
  type MiniProgramContext,
  resolveMiniProgramContext,
} from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type ImportContext =
  | { kind: 'mini'; context: MiniProgramContext }
  | { kind: 'admin'; context: TenantContext };

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function actor(context: ImportContext) {
  if (context.kind === 'mini') {
    const staff = context.context.staff!;
    return {
      role: staff.role,
      staffId: parsePostgresId(staff._id, 'staff id'),
      enterpriseId: context.context.enterpriseId
        ? parsePostgresId(context.context.enterpriseId, 'enterprise id')
        : null,
    };
  }
  return {
    role: context.context.role,
    staffId: parsePostgresId(context.context.userId, 'userId'),
    enterpriseId: context.context.enterpriseId
      ? parsePostgresId(context.context.enterpriseId, 'enterprise id')
      : null,
  };
}

function canAccessLead(lead: LeadWithRelations, context: ImportContext) {
  const current = actor(context);
  return (
    current.role === 'super_admin' ||
    current.role === 'admin' ||
    current.role === 'enterprise_admin' ||
    lead.promoterId === current.staffId ||
    lead.assignedTo === current.staffId
  );
}

async function resolveCreatorId(
  transaction: PostgresTransaction,
  lead: LeadWithRelations,
  context: ImportContext
) {
  const users = new UserRepository(transaction);
  if (
    context.kind === 'mini' &&
    /^[1-9]\d*$/.test(context.context.user._id)
  ) {
    const directId = parsePostgresId(context.context.user._id, 'user id');
    if (await users.findById(directId)) return directId;
  }
  const existing = await users.findByPhoneInEnterprise(
    lead.phone,
    lead.enterpriseId
  );
  if (existing) return existing.id;
  const created = await users.create({
    enterpriseId: lead.enterpriseId,
    role: 'user',
    nickname: lead.name,
    phone: lead.phone,
    communityName: lead.communityName,
    city: lead.city,
  });
  return created.id;
}

async function persistImport(
  transaction: PostgresTransaction,
  leadId: bigint,
  detail: KujialeFloorPlanDetail,
  context: ImportContext
) {
  const leads = new LeadRepository(transaction);
  const floorPlans = new FloorPlanRepository(transaction);
  const lead = await leads.findById(leadId);
  if (!lead || !canAccessLead(lead, context)) {
    throw new Error('Lead not found or access denied');
  }

  const current = actor(context);
  const layoutData = convertKujialeDetailToLayoutData(detail);
  const externalId = detail.externalId;
  const creatorId = await resolveCreatorId(transaction, lead, context);
  const floorPlanName =
    detail.name ||
    [lead.communityName || detail.communityName, detail.layoutLabel]
      .filter(Boolean)
      .join(' ') ||
    `${lead.name} 的酷家乐户型`;
  const externalSource = {
    provider: 'kujiale',
    externalId,
    communityName: detail.communityName || lead.communityName,
    city: detail.city || lead.city,
    area: detail.area || (lead.area ? Number(lead.area) : undefined),
    layoutLabel: detail.layoutLabel,
    previewUrl: detail.previewUrl,
    importedAt: new Date().toISOString(),
    rawSummary: {
      ...(detail.rawSummary || {}),
      importedRoomCount: detail.rooms.length,
    },
  };

  const existing = await floorPlans.findByExternalSource(
    lead.enterpriseId,
    'kujiale',
    externalId
  );
  const floorPlan = existing
    ? await floorPlans.update(existing.id, {
        name: floorPlanName,
        layoutData,
        source: 'kujiale',
        status: 'completed',
        completedAt: new Date(),
        externalSource,
        staffId: current.staffId,
        enterpriseId: lead.enterpriseId ?? current.enterpriseId,
      })
    : await floorPlans.create({
        name: floorPlanName,
        creatorId,
        staffId: current.staffId,
        enterpriseId: lead.enterpriseId ?? current.enterpriseId,
        layoutData,
        source: 'kujiale',
        status: 'completed',
        completedAt: new Date(),
        externalSource,
      });
  if (!floorPlan) throw new Error('Failed to persist KuJiale floor plan');
  const updatedLead = await leads.linkFloorPlan(
    lead.id,
    floorPlan.id,
    'measured'
  );
  if (!updatedLead) throw new Error('Failed to link floor plan to lead');
  return { lead: updatedLead, floorPlan };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leadId = parsePostgresId(id, 'lead id');
    const body = await request.json();
    const externalId =
      typeof body.externalId === 'string' ? body.externalId.trim() : '';
    if (!externalId) {
      return NextResponse.json(
        { success: false, error: 'externalId is required' },
        { status: 400 }
      );
    }

    const mini = await resolveMiniProgramContext(request);
    let context: ImportContext;
    if (mini) {
      if (!mini.staff) {
        return NextResponse.json(
          { success: false, error: 'Staff profile not found' },
          { status: 403 }
        );
      }
      context = { kind: 'mini', context: mini };
    } else {
      const admin = await getTenantContext(request);
      if (!admin) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 }
        );
      }
      context = { kind: 'admin', context: admin };
    }

    // The upstream network call intentionally stays outside the database transaction.
    const detail = await getKujialeFloorPlanDetail(externalId);
    const result =
      context.kind === 'mini'
        ? await withMiniProgramPostgresTransaction(
            context.context,
            (transaction) =>
              persistImport(transaction, leadId, detail, context)
          )
        : await withAdminPostgresTransaction(
            context.context,
            (transaction) =>
              persistImport(transaction, leadId, detail, context)
          );

    const floorPlan = await persistAndAttachFloorPlanPreview(result.floorPlan);
    return NextResponse.json({
      success: true,
      data: {
        lead: leadToDto(result.lead),
        floorPlan: floorPlanToDto(floorPlan),
      },
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error('Import KuJiale floor plan error:', error);
    return NextResponse.json(
      { success: false, error: message, code: (error as { code?: string })?.code },
      {
        status: (error as { status?: number })?.status
          || (message.includes('access denied') ? 404 : 500),
      }
    );
  }
}
