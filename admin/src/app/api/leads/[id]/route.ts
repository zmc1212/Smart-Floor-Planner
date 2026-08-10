import { NextResponse } from 'next/server';
import {
  leadToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  LeadRepository,
  type LeadUpdate,
  type LeadWithRelations,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext, type TenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { normalizeLeadStatus } from '@/lib/lead-status';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function staffCanAccess(
  lead: LeadWithRelations,
  role: string,
  staffId: bigint
) {
  return (
    role === 'enterprise_admin' ||
    role === 'admin' ||
    role === 'super_admin' ||
    lead.promoterId === staffId ||
    lead.assignedTo === staffId
  );
}

async function resolveLeadContext(request: Request) {
  const mini = await resolveMiniProgramContext(request);
  if (mini) return { kind: 'mini' as const, mini };
  const admin = await getTenantContext(request);
  return admin ? { kind: 'admin' as const, admin } : null;
}

function withLeadTransaction<T>(
  context: NonNullable<Awaited<ReturnType<typeof resolveLeadContext>>>,
  callback: (transaction: PostgresTransaction) => Promise<T>
) {
  return context.kind === 'mini'
    ? withMiniProgramPostgresTransaction(context.mini, callback)
    : withAdminPostgresTransaction(context.admin, callback);
}

function canAccess(
  lead: LeadWithRelations,
  context: NonNullable<Awaited<ReturnType<typeof resolveLeadContext>>>
) {
  if (context.kind === 'mini') {
    if (!context.mini.staff) return lead.phone === context.mini.user.phone;
    return staffCanAccess(
      lead,
      context.mini.staff.role,
      parsePostgresId(context.mini.staff._id, 'staff id')
    );
  }
  if (context.admin.role === 'designer') {
    return lead.assignedTo === parsePostgresId(context.admin.userId, 'userId');
  }
  return true;
}

function dtoForContext(request: Request, lead: LeadWithRelations, role?: string) {
  const include = role === 'measurer';
  const assetId = lead.assignedUser?.wechatQrAssetId;
  return leadToDto(lead, {
    includeDesignerWechat: include,
    designerWechatQrUrl: include && assetId && lead.enterpriseId
      ? getSignedMiniAiAssetUrl({ request, assetId: assetId.toString(), enterpriseId: lead.enterpriseId.toString() })
      : null,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveLeadContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { id } = await params;
    const lead = await withLeadTransaction(context, (transaction) =>
      new LeadRepository(transaction).findById(parsePostgresId(id, 'lead id'))
    );
    if (!lead || !canAccess(lead, context)) {
      return NextResponse.json(
        { success: false, error: 'Lead not found or access denied' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: dtoForContext(request, lead, context.kind === 'mini' ? context.mini.staff?.role : context.admin.role) });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveLeadContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { id } = await params;
    const leadId = parsePostgresId(id, 'lead id');
    const body = await request.json();
    const updated = await withLeadTransaction(
      context,
      async (transaction) => {
        const repository = new LeadRepository(transaction);
        const current = await repository.findById(leadId);
        if (!current || !canAccess(current, context)) return null;

        const input: LeadUpdate = {};
        if (body.name !== undefined) input.name = String(body.name).trim();
        if (body.phone !== undefined) input.phone = String(body.phone).trim();
        if (body.communityName !== undefined) {
          input.communityName = String(body.communityName).trim() || null;
        }
        if (body.area !== undefined) {
          const area = Number(body.area);
          input.area = Number.isFinite(area) && area > 0 ? String(area) : null;
        }
        if (body.stylePreference !== undefined) {
          input.stylePreference =
            String(body.stylePreference).trim() || null;
        }
        if (body.city !== undefined) {
          input.city = String(body.city).trim() || null;
        }
        if (body.source !== undefined) input.source = String(body.source);
        if (body.status !== undefined) {
          if (String(body.status) === 'acquired' && context.kind === 'admin' && context.admin.role === 'designer') {
            throw new Error('请使用获客确认接口完成状态变更');
          }
          input.status = normalizeLeadStatus(String(body.status));
        }
        if (body.notes !== undefined) input.notes = String(body.notes) || null;
        if (Array.isArray(body.followUpRecords)) {
          input.followUpRecords = body.followUpRecords.filter(
            (item: unknown) => item && typeof item === 'object'
          );
        }

        if (body.assignedTo !== undefined) {
          const assignedTo = parseOptionalPostgresId(
            body.assignedTo,
            'assignedTo'
          );
          const assignedUser = assignedTo
            ? await new AdminUserRepository(transaction).findById(assignedTo)
            : null;
          if (assignedTo && !assignedUser) {
            throw new Error('Assigned staff not found in this scope');
          }
          input.assignedTo = assignedTo;
          input.assignedAt = assignedTo ? new Date() : null;
          if (assignedUser?.role === 'designer' && normalizeLeadStatus(current.status) === 'new') {
            input.status = 'new';
          }
        }

        let lead = await repository.update(leadId, input);
        const floorPlanId = parseOptionalPostgresId(
          body.floorPlanId,
          'floorPlanId'
        );
        if (lead && floorPlanId) {
          lead = await repository.linkFloorPlan(leadId, floorPlanId);
        }
        return lead;
      }
    );
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Lead not found or access denied' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: dtoForContext(request, updated, context.kind === 'mini' ? context.mini.staff?.role : context.admin.role) });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getTenantContext(request);
    if (!admin) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { id } = await params;
    const deleted = await withAdminPostgresTransaction(
      admin as TenantContext,
      async (transaction) => {
        const repository = new LeadRepository(transaction);
        const lead = await repository.findById(parsePostgresId(id, 'lead id'));
        if (!lead) return null;
        if (
          admin.role === 'designer' &&
          lead.assignedTo !== parsePostgresId(admin.userId, 'userId')
        ) {
          return null;
        }
        return repository.deleteWithFloorPlans(lead.id);
      }
    );
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Lead not found or access denied' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: {} });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
