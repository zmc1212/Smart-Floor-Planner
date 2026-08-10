import { NextResponse } from 'next/server';
import {
  leadToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  AcquisitionRepository,
  LeadRepository,
  type LeadListOptions,
  type LeadUpdate,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { withTenantTransaction } from '@/db/transaction';
import { getTenantContext, type TenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';
import { resolveWritableEnterpriseId } from '@/lib/tenant-route';
import {
  notifyDesignerOfAssignedLead,
  notifyDesignerOfPendingLead,
  notifyEnterpriseAdminOfNewLead,
} from '@/lib/wechat-notification';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { normalizeLeadStatus } from '@/lib/lead-status';

function leadDtoForMini(request: Request, lead: Parameters<typeof leadToDto>[0], role?: string) {
  const include = role === 'measurer';
  const assetId = lead.assignedUser?.wechatQrAssetId;
  return leadToDto(lead, {
    includeDesignerWechat: include,
    designerWechatQrUrl: include && assetId && lead.enterpriseId
      ? getSignedMiniAiAssetUrl({ request, assetId: assetId.toString(), enterpriseId: lead.enterpriseId.toString() })
      : null,
  });
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
    const acquisitionStatusValue = searchParams.get('acquisitionStatus');
    const acquisitionStatus = acquisitionStatusValue === 'pending_confirmation' || acquisitionStatusValue === 'confirmed'
      ? acquisitionStatusValue
      : undefined;
    const miniContext = await resolveMiniProgramContext(request);

    if (miniContext) {
      if (!miniContext.staff) {
        return NextResponse.json(
          { success: false, error: 'Staff profile not found' },
          { status: 403 }
        );
      }
      const staffId = parsePostgresId(miniContext.staff._id, 'staff id');
      const miniStaffRole = miniContext.staff.role;
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
          const designer = miniStaffRole === 'measurer'
            ? await new AdminUserRepository(transaction).findDesignerForMeasurer(staffId)
            : null;
          const [list, all, stats, todayNew] = await Promise.all([
            repository.list({ ...baseOptions, status, acquisitionStatus, page, limit }),
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
          return { list, all, stats, todayNew, designer };
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
        data: result.list.rows.map((lead) => leadDtoForMini(request, lead, miniContext.staff?.role)),
        stats: {
          all: result.all,
          ...result.stats,
          todayNew: result.todayNew,
          following,
        },
        designerProfile: result.designer ? {
          _id: result.designer.id.toString(),
          displayName: result.designer.displayName,
          username: result.designer.username,
          wechatId: result.designer.wechatId,
          wechatQrUrl: result.designer.wechatQrAssetId && result.designer.enterpriseId
            ? getSignedMiniAiAssetUrl({ request, assetId: result.designer.wechatQrAssetId.toString(), enterpriseId: result.designer.enterpriseId.toString() })
            : null,
        } : null,
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
          acquisitionStatus,
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
      data: result.rows.map((lead) => leadToDto(lead)),
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
        { success: false, error: 'acquired 已从线索业务状态移除，请使用获客确认接口' },
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
      const acquisitions = new AcquisitionRepository(transaction);
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
      const isMeasurerLead = role === 'measurer' && actorStaffId;

      if (isMeasurerLead) {
        promoterId = actorStaffId;
        const designer = await admins.findDesignerForMeasurer(actorStaffId);
        if (!designer) throw new Error('当前测量员尚未绑定设计师');
        enterpriseId ??= designer.enterpriseId;
        assignedTo = designer.id;
      }

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

      let status = normalizeLeadStatus(isMeasurerLead ? 'new' : body.status || 'new');
      if (isMeasurerLead) status = 'new';
      if (assignedTo && (!body.status || body.status === 'new')) status = 'new';
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
      const shouldNotifyDesigner = Boolean(isMeasurerLead && !existing && assignedTo);
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
      if (shouldNotifyDesigner && assignedTo && lead.enterpriseId) {
        await acquisitions.createNotification({
          enterpriseId: lead.enterpriseId,
          recipientStaffId: assignedTo,
          leadId: lead.id,
          notificationType: 'lead_pending_acquisition',
          channel: 'in_app',
          status: 'unread',
          message: `收到客户线索：${lead.name}，待确认获客`,
          dedupeKey: `lead_pending_acquisition:${lead.id.toString()}`,
          metadata: { page: `/packages/business/acquisition-center/acquisition-center?leadId=${lead.id.toString()}` },
        });
      }
      return { lead, shouldNotifyDesigner, shouldNotifyEnterprise: !existing, designerId: assignedTo };
    };

    const result = miniContext
      ? await withMiniProgramPostgresTransaction(miniContext, execute)
      : await withAdminPostgresTransaction(adminContext!, execute);
    const lead = result.lead;

    const notificationLead = {
      ...lead,
      enterpriseId: lead.enterpriseId?.toString(),
    };
    const notificationResults = await Promise.allSettled([
      result.shouldNotifyEnterprise ? notifyEnterpriseAdminOfNewLead(notificationLead) : Promise.resolve(),
      result.shouldNotifyDesigner && result.designerId
        ? notifyDesignerOfPendingLead(notificationLead, result.designerId.toString())
        : lead.assignedTo
        ? notifyDesignerOfAssignedLead(
            notificationLead,
            lead.assignedTo.toString()
          )
        : Promise.resolve(),
    ]);
    if (result.shouldNotifyDesigner && result.designerId && lead.enterpriseId) {
      const designerResult = notificationResults[1];
      const delivery = designerResult?.status === 'fulfilled' && designerResult.value && typeof designerResult.value === 'object' && 'success' in designerResult.value
        ? designerResult.value
        : { success: false, error: 'notification rejected' };
      await withTenantTransaction(lead.enterpriseId, (transaction) => new AcquisitionRepository(transaction).createNotification({
        enterpriseId: lead.enterpriseId,
        recipientStaffId: result.designerId,
        leadId: lead.id,
        notificationType: 'lead_pending_acquisition',
        channel: 'wechat',
        status: delivery.success ? 'sent' : 'failed',
        message: `Lead ${lead.name} pending acquisition confirmation`,
        errorMessage: delivery.success ? null : delivery.error || null,
        dedupeKey: `lead_pending_acquisition:${lead.id.toString()}`,
        metadata: { page: `/packages/business/acquisition-center/acquisition-center?leadId=${lead.id.toString()}` },
      }));
    }

    return NextResponse.json(
      { success: true, data: miniContext ? leadDtoForMini(request, lead, miniContext.staff?.role) : leadToDto(lead) },
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
