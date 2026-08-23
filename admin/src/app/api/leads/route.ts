import { NextResponse } from 'next/server';
import {
  leadToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  LeadRepository,
  ReferralLeadRepository,
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
  notifyEnterpriseAdminOfAssignmentPending,
  notifyEnterpriseAdminOfNewLead,
} from '@/lib/wechat-notification';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { normalizeLeadStatus } from '@/lib/lead-status';
import {
  archivedLeadExistsError,
  canManageLeadArchive,
} from '@/lib/lead-lifecycle';
import { httpErrorStatus } from '@/lib/http-error';
import { redactLeadConversionDetailsForConsumer } from '@/lib/lead-conversion';
import { attachLeadAssignmentActions } from '@/lib/lead-assignment-actions';
import { resolveStaffLeadListOptions } from '@/lib/lead-staff-visibility';

export function leadDtoForMini(
  request: Request,
  lead: Parameters<typeof leadToDto>[0],
  role?: string,
  actorId?: bigint | null
) {
  const include = role === 'measurer';
  const hasStaffContext = Boolean(role && role !== 'user');
  const assetId = lead.assignedUser?.wechatQrAssetId;
  const dto = leadToDto(lead, {
    includeDesignerWechat: include,
    designerWechatQrUrl: include && assetId && lead.enterpriseId
      ? getSignedMiniAiAssetUrl({ request, assetId: assetId.toString(), enterpriseId: lead.enterpriseId.toString() })
      : null,
  });
  const scoped = hasStaffContext ? dto : redactLeadConversionDetailsForConsumer(dto);
  return attachLeadAssignmentActions(scoped, lead, role || '', actorId ?? null);
}

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

function startOfChinaBusinessDay(now = new Date()) {
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaNow = new Date(now.getTime() + chinaOffsetMs);
  return new Date(
    Date.UTC(
      chinaNow.getUTCFullYear(),
      chinaNow.getUTCMonth(),
      chinaNow.getUTCDate()
    ) - chinaOffsetMs
  );
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
      const baseOptions: LeadListOptions = resolveStaffLeadListOptions(
        miniContext.staff.role,
        staffId
      );
      const result = await withMiniProgramPostgresTransaction(
        miniContext,
        async (transaction) => {
          const repository = new LeadRepository(transaction);
          const [list, all, stats, todayNew] = await Promise.all([
            repository.list({ ...baseOptions, status, page, limit }),
            repository.count(baseOptions),
            repository.countStatuses(baseOptions, [
              'new',
              'acquired',
              'contacted',
              'measuring',
              'measured',
              'assigned',
              'designing',
              'quoting',
              'converted',
            ]),
            repository.count({
              ...baseOptions,
              createdSince: startOfChinaBusinessDay(),
            }),
          ]);
          return { list, all, stats, todayNew };
        }
      );
      const following = [
        'new',
        'acquired',
        'contacted',
        'measuring',
        'measured',
        'assigned',
        'designing',
        'quoting',
      ].reduce((total, key) => total + (result.stats[key] ?? 0), 0);
      return NextResponse.json({
        success: true,
        data: result.list.rows.map((lead) =>
          leadDtoForMini(request, lead, miniContext.staff?.role, staffId)
        ),
        stats: {
          all: result.all,
          ...result.stats,
          todayNew: result.todayNew,
          following,
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
    const archiveState = searchParams.get('archiveState') === 'archived' ? 'archived' : 'active';
    if (archiveState === 'archived') {
      if (!context.enterpriseId) {
        return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
      }
      const allowed = await withAdminPostgresTransaction(context, (transaction) =>
        canManageLeadArchive(transaction, {
          role: context.role,
          actorId: parsePostgresId(context.userId, 'userId'),
          enterpriseId: BigInt(context.enterpriseId!),
        })
      );
      if (!allowed) {
        return NextResponse.json({ success: false, error: '无权查看归档线索' }, { status: 403 });
      }
    }
    const result = await withAdminPostgresTransaction(
      context,
      (transaction) =>
        new LeadRepository(transaction).list({
          status,
          assignmentStatus: searchParams.get('assignmentStatus') || undefined,
          serviceStage: searchParams.get('serviceStage') || undefined,
          source: searchParams.get('source') || undefined,
          staffId:
            context.role === 'designer' || context.role === 'measurer'
              ? parsePostgresId(context.userId, 'userId')
              : undefined,
          staffVisibility: context.role === 'measurer' ? 'measurer' : 'assigned',
          archiveState,
          page,
          limit,
        })
    );
    return NextResponse.json({
      success: true,
      data: result.rows.map((lead) =>
        attachLeadAssignmentActions(
          leadToDto(lead),
          lead,
          context.role,
          parsePostgresId(context.userId, 'userId')
        )
      ),
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
    if (String(body.status || '') === 'acquired') {
      return NextResponse.json(
        { success: false, error: 'acquired 已从线索业务状态移除' },
        { status: 400 }
      );
    }
    if (
      body.status !== undefined &&
      normalizeLeadStatus(String(body.status)) === 'converted'
    ) {
      return NextResponse.json(
        { success: false, error: '新建线索不能直接标记已签约，请创建后使用专用签约操作' },
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
    if (role === 'designer' || role === 'measurer') {
      return NextResponse.json(
        { success: false, error: '仅企业负责人可手动录入客户，录入后将自动派设计师和测量员' },
        { status: 403 }
      );
    }
    const usesManualEntryAssignment = ['enterprise_admin', 'admin', 'super_admin'].includes(role);
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
      const floorPlanId = parseOptionalPostgresId(
        body.floorPlanId,
        'floorPlanId'
      );
      const area = Number(body.area);
      const communityName =
        typeof body.communityName === 'string'
          ? body.communityName.trim() || null
          : null;
      const stylePreference =
        typeof body.stylePreference === 'string'
          ? body.stylePreference.trim() || null
          : null;
      const city =
        typeof body.city === 'string' ? body.city.trim() || null : null;
      const notes = typeof body.notes === 'string' ? body.notes : null;
      const areaValue = Number.isFinite(area) && area > 0 ? String(area) : null;

      const existing = await leads.findByPhone(phone);
      if (!usesManualEntryAssignment && existing?.archivedAt) {
        throw archivedLeadExistsError();
      }

      if (usesManualEntryAssignment) {
        if (!enterpriseId) {
          throw Object.assign(new Error('请先选择企业'), { status: 400 });
        }
        const manual = await new ReferralLeadRepository(
          transaction
        ).createManualEntryLead({
          enterpriseId,
          actorStaffId,
          actorUserId: miniContext?.user?._id
            ? parsePostgresId(miniContext.user._id, 'user id')
            : actorStaffId
              ? await admins.findLinkedUserId(actorStaffId)
              : null,
          name,
          phone,
          communityName,
          area: areaValue,
          stylePreference,
          city,
          notes,
        });
        let lead = manual.lead;
        if (floorPlanId) {
          const linked = await leads.linkFloorPlan(lead.id, floorPlanId);
          if (!linked) throw new Error('Floor plan not found in this scope');
          lead = linked;
        }
        return {
          lead,
          created: manual.created,
          designerId: lead.assignedTo,
          measurerId: lead.measurerId,
          assignmentPending: lead.assignmentStatus === 'assignment_pending',
          assignmentErrorCode: lead.assignmentErrorCode,
        };
      }

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

      let status = normalizeLeadStatus(body.status || 'new');
      if (assignedTo && (!body.status || body.status === 'new')) status = 'new';
      const common: LeadUpdate = {
        enterpriseId,
        promoterId,
        assignedTo,
        assignedAt: assignedTo ? new Date() : null,
        status,
        communityName,
        area: areaValue,
        stylePreference,
        city,
        source:
          typeof body.source === 'string' ? body.source : 'unknown',
        notes,
      };

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
      return {
        lead,
        created: !existing,
        designerId: assignedTo,
        measurerId: lead.measurerId,
        assignmentPending: false,
        assignmentErrorCode: null,
      };
    };

    const result = miniContext
      ? await withMiniProgramPostgresTransaction(miniContext, execute)
      : await withAdminPostgresTransaction(adminContext!, execute);
    const lead = result.lead;

    const notificationLead = {
      ...lead,
      enterpriseId: lead.enterpriseId?.toString(),
    };
    await Promise.allSettled([
      result.created ? notifyEnterpriseAdminOfNewLead(notificationLead) : Promise.resolve(),
      result.created && result.designerId
        ? notifyDesignerOfAssignedLead(
            notificationLead,
            result.designerId.toString()
          )
        : Promise.resolve(),
      result.created &&
      result.measurerId &&
      result.measurerId.toString() !== result.designerId?.toString()
        ? notifyDesignerOfAssignedLead(
            notificationLead,
            result.measurerId.toString()
          )
        : Promise.resolve(),
      result.created && result.assignmentPending
        ? notifyEnterpriseAdminOfAssignmentPending(notificationLead, {
            reasonCode: result.assignmentErrorCode || 'assignment_pending',
            eventKey: `manual-entry:${lead.id.toString()}`,
          })
        : Promise.resolve(),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: miniContext
          ? leadDtoForMini(
              request,
              lead,
              miniContext.staff?.role,
              miniContext.staff?._id
                ? parsePostgresId(miniContext.staff._id, 'staff id')
                : null
            )
          : attachLeadAssignmentActions(
              leadToDto(lead),
              lead,
              adminContext?.role || '',
              adminContext?.userId
                ? parsePostgresId(adminContext.userId, 'userId')
                : null
            ),
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('Create lead error:', error);
    return NextResponse.json(
      { success: false, code: (error as { code?: string }).code, error: errorMessage(error) },
      { status: httpErrorStatus(error, 500) }
    );
  }
}
