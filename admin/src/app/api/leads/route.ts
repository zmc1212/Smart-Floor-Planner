import { NextResponse } from 'next/server';
import {
  leadToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  LeadRepository,
  type LeadListOptions,
  type LeadUpdate,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext, type TenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';
import { resolveWritableEnterpriseId } from '@/lib/tenant-route';
import {
  notifyDesignerOfAssignedLead,
  notifyEnterpriseAdminOfNewLead,
} from '@/lib/wechat-notification';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function parsePage(searchParams: URLSearchParams) {
  const page = Math.max(Number(searchParams.get('page')) || 1, 1);
  const limit = Math.min(
    Math.max(Number(searchParams.get('limit')) || 20, 1),
    50
  );
  return { page, limit };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePage(searchParams);
    const status = searchParams.get('status') || undefined;
    const miniContext = await resolveMiniProgramContext(request);

    if (miniContext) {
      if (!miniContext.staff) {
        return NextResponse.json(
          { success: false, error: 'Staff profile not found' },
          { status: 403 }
        );
      }
      const staffId = parsePostgresId(miniContext.staff._id, 'staff id');
      const baseOptions: LeadListOptions =
        miniContext.staff.role === 'enterprise_admin'
          ? {}
          : {
              staffId,
              staffVisibility: 'promoted-or-assigned',
            };
      const result = await withMiniProgramPostgresTransaction(
        miniContext,
        async (transaction) => {
          const repository = new LeadRepository(transaction);
          const [list, all, stats] = await Promise.all([
            repository.list({ ...baseOptions, status, page, limit }),
            repository.count(baseOptions),
            repository.countStatuses(baseOptions, [
              'new',
              'measuring',
              'assigned',
              'converted',
            ]),
          ]);
          return { list, all, stats };
        }
      );
      return NextResponse.json({
        success: true,
        data: result.list.rows.map(leadToDto),
        stats: {
          all: result.all,
          ...result.stats,
        },
      });
    }

    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const result = await withAdminPostgresTransaction(
      context,
      (transaction) =>
        new LeadRepository(transaction).list({
          status,
          source: searchParams.get('source') || undefined,
          staffId:
            context.role === 'designer'
              ? parsePostgresId(context.userId, 'userId')
              : undefined,
          staffVisibility: 'assigned',
          page,
          limit,
        })
    );
    return NextResponse.json({
      success: true,
      data: result.rows.map(leadToDto),
      pagination: {
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error: unknown) {
    console.error('Fetch leads error:', error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!name || !phone) {
      return NextResponse.json(
        { success: false, error: 'Name and phone are required' },
        { status: 400 }
      );
    }

    const miniContext = await resolveMiniProgramContext(request);
    const adminContext = miniContext ? null : await getTenantContext(request);
    if (!miniContext && !adminContext) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const role = miniContext?.staff?.role || adminContext?.role || 'user';
    const actorStaffId = miniContext?.staff
      ? parsePostgresId(miniContext.staff._id, 'staff id')
      : adminContext
        ? parsePostgresId(adminContext.userId, 'userId')
        : null;
    const contextEnterpriseId =
      miniContext?.enterpriseId || adminContext?.enterpriseId || null;
    const explicitEnterpriseId = adminContext
      ? resolveWritableEnterpriseId(
          adminContext as TenantContext,
          body.enterpriseId
        )
      : contextEnterpriseId;

    const execute = async (transaction: PostgresTransaction) => {
      const leads = new LeadRepository(transaction);
      const admins = new AdminUserRepository(transaction);
      let enterpriseId = explicitEnterpriseId
        ? parsePostgresId(explicitEnterpriseId, 'enterpriseId')
        : null;
      let promoterId = parseOptionalPostgresId(
        body.promoterId,
        'promoterId'
      );
      let assignedTo = parseOptionalPostgresId(
        body.assignedTo,
        'assignedTo'
      );

      const referencedStaffId = promoterId ?? assignedTo;
      if (referencedStaffId) {
        const referencedStaff = await admins.findById(referencedStaffId);
        if (!referencedStaff) {
          throw new Error('Referenced staff not found in this scope');
        }
        enterpriseId ??= referencedStaff.enterpriseId;
        if (referencedStaff.role === 'salesperson' && !promoterId) {
          promoterId = referencedStaff.id;
          assignedTo = null;
        }
      }
      if (role === 'salesperson' && actorStaffId) {
        promoterId = actorStaffId;
        assignedTo = null;
      }
      if (promoterId && !assignedTo) {
        assignedTo =
          (await admins.findDesignerForPromoter(promoterId))?.id ?? null;
      }
      if (!assignedTo && actorStaffId && role !== 'user') {
        assignedTo = actorStaffId;
      }

      let status = body.status || 'new';
      if (assignedTo && (!body.status || body.status === 'new')) {
        status =
          (await admins.findById(assignedTo))?.role === 'designer'
            ? 'assigned'
            : 'new';
      }
      const floorPlanId = parseOptionalPostgresId(
        body.floorPlanId,
        'floorPlanId'
      );
      const area = Number(body.area);
      const common: LeadUpdate = {
        enterpriseId,
        promoterId,
        assignedTo,
        assignedAt: assignedTo ? new Date() : null,
        status,
        communityName:
          typeof body.communityName === 'string'
            ? body.communityName.trim() || null
            : null,
        area: Number.isFinite(area) && area > 0 ? String(area) : null,
        stylePreference:
          typeof body.stylePreference === 'string'
            ? body.stylePreference.trim() || null
            : null,
        city:
          typeof body.city === 'string' ? body.city.trim() || null : null,
        source:
          typeof body.source === 'string' ? body.source : 'unknown',
        notes: typeof body.notes === 'string' ? body.notes : null,
      };

      const existing = await leads.findByPhone(phone);
      let lead = existing
        ? await leads.update(existing.id, {
            ...common,
            name: existing.name || name,
            status: existing.status,
            source: existing.source,
            promoterId: existing.promoterId ?? promoterId,
            assignedTo: existing.assignedTo ?? assignedTo,
            enterpriseId: existing.enterpriseId ?? enterpriseId,
            communityName: common.communityName ?? existing.communityName,
            area: common.area ?? existing.area,
            stylePreference:
              common.stylePreference ?? existing.stylePreference,
          })
        : await (async () => {
            const created = await leads.create({
              ...common,
              name,
              phone,
              source: common.source || 'unknown',
              status: common.status || 'new',
              followUpRecords: [],
            });
            return leads.findById(created.id);
          })();
      if (!lead) throw new Error('Failed to persist lead');
      if (floorPlanId) {
        lead = await leads.linkFloorPlan(lead.id, floorPlanId);
        if (!lead) throw new Error('Floor plan not found in this scope');
      }
      return lead;
    };

    const lead = miniContext
      ? await withMiniProgramPostgresTransaction(miniContext, execute)
      : await withAdminPostgresTransaction(adminContext!, execute);

    const notificationLead = {
      ...lead,
      enterpriseId: lead.enterpriseId?.toString(),
    };
    await Promise.allSettled([
      notifyEnterpriseAdminOfNewLead(notificationLead),
      lead.assignedTo
        ? notifyDesignerOfAssignedLead(
            notificationLead,
            lead.assignedTo.toString()
          )
        : Promise.resolve(),
    ]);

    return NextResponse.json(
      { success: true, data: leadToDto(lead) },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('Create lead error:', error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
