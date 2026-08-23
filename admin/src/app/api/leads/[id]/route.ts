import { NextResponse } from 'next/server';
import {
  leadToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  CustomerProjectRepository,
  LeadRepository,
  LeadLifecycleRepository,
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
import {
  getLeadConversionActions,
  isProtectedConversionStatusChange,
  redactLeadConversionDetailsForConsumer,
} from '@/lib/lead-conversion';
import { getLeadAssignmentActions } from '@/lib/lead-assignment-actions';
import { normalizeLeadStatus } from '@/lib/lead-status';
import {
  canAccessLeadForActor,
  canManageLeadArchive,
  canPurgeLeads,
  getPurgeBlockers,
  leadArchivedError,
} from '@/lib/lead-lifecycle';
import {
  attachPublishedSchemeDisplayUrls,
  buildPublishedSchemeViews,
} from '@/lib/customer-project';
import { httpErrorStatus } from '@/lib/http-error';

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
    lead.assignedTo === staffId ||
    lead.measurerId === staffId
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
    if (!context.mini.staff) {
      return lead.customerUserId === parsePostgresId(context.mini.user._id, 'customer user id');
    }
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

function schemeSummary(scheme: ReturnType<typeof buildPublishedSchemeViews>[number], leadId: string) {
  return {
    id: scheme.id,
    workflowId: scheme.workflowId,
    title: scheme.title,
    firstPublishedAt: scheme.firstPublishedAt,
    publishedAt: scheme.publishedAt,
    finalized: Boolean(scheme.finalized),
    imageCount: scheme.images.length,
    generationIds: scheme.images.map((image) => image.generationId),
    images: scheme.images.map((image) => ({
      id: image.id,
      generationId: image.generationId,
      title: image.title,
      stageKey: image.stageKey,
      publishedAt: image.publishedAt,
      imageUrl: image.imageUrl || null,
      imageEndpoint: `/leads/${leadId}/published-generations/${image.generationId}/image`,
    })),
  };
}

async function loadLeadPublicationFacts(
  request: Request,
  context: NonNullable<Awaited<ReturnType<typeof resolveLeadContext>>>,
  lead: LeadWithRelations
) {
  if (!lead.enterpriseId) {
    return { publishedDesignCount: 0, publishedSchemes: [] as ReturnType<typeof schemeSummary>[] };
  }
  const enterpriseId = lead.enterpriseId;
  const leadId = lead.id;
  return withLeadTransaction(context, async (transaction) => {
    const publications = await new CustomerProjectRepository(transaction).listActivePublications(enterpriseId, leadId);
    const publishedSchemes = (await attachPublishedSchemeDisplayUrls(
      request,
      enterpriseId.toString(),
      publications,
      buildPublishedSchemeViews(
        publications,
        leadId.toString(),
        lead.finalizedWorkflowId,
      ),
    )).map((scheme) => schemeSummary(scheme, leadId.toString()));
    return {
      publishedDesignCount: publications.length,
      publishedSchemes,
    };
  });
}

function dtoForContext(
  request: Request,
  lead: LeadWithRelations,
  context: NonNullable<Awaited<ReturnType<typeof resolveLeadContext>>>,
  publicationFacts?: { publishedDesignCount: number; publishedSchemes: ReturnType<typeof schemeSummary>[] }
) {
  const role = context.kind === 'mini' ? context.mini.staff?.role || '' : context.admin.role;
  const actorId = context.kind === 'mini'
    ? context.mini.staff?._id
      ? parsePostgresId(context.mini.staff._id, 'staff id')
      : null
    : parsePostgresId(context.admin.userId, 'userId');
  const include = role === 'measurer';
  const assetId = lead.assignedUser?.wechatQrAssetId;
  let dto = leadToDto(lead, {
    includeDesignerWechat: include,
    designerWechatQrUrl: include && assetId && lead.enterpriseId
      ? getSignedMiniAiAssetUrl({ request, assetId: assetId.toString(), enterpriseId: lead.enterpriseId.toString() })
      : null,
    publishedDesignCount: publicationFacts?.publishedDesignCount,
  });
  if (context.kind === 'mini' && !context.mini.staff) {
    dto = redactLeadConversionDetailsForConsumer(dto);
  }
  return {
    ...dto,
    publishedSchemes: publicationFacts?.publishedSchemes || [],
    conversionActions: getLeadConversionActions(lead, role, actorId),
    assignmentActions: getLeadAssignmentActions(lead, role, actorId),
  };
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
    if (lead.archivedAt) {
      if (context.kind === 'mini') {
        return NextResponse.json(
          { success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' },
          { status: 410 }
        );
      }
      if (!context.admin.enterpriseId) {
        return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
      }
      const allowed = await withAdminPostgresTransaction(context.admin, (transaction) =>
        canManageLeadArchive(transaction, {
          role: context.admin.role,
          actorId: parsePostgresId(context.admin.userId, 'userId'),
          enterpriseId: BigInt(context.admin.enterpriseId!),
        })
      );
      if (!allowed) {
        return NextResponse.json(
          { success: false, error: 'Lead not found or access denied' },
          { status: 404 }
        );
      }
    }
    const publicationFacts = await loadLeadPublicationFacts(request, context, lead);
    return NextResponse.json({ success: true, data: dtoForContext(request, lead, context, publicationFacts) });
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
    if (String(body.status || '') === 'acquired') {
      return NextResponse.json(
        { success: false, error: 'acquired 已从线索业务状态移除，请使用获客确认接口' },
        { status: 400 }
      );
    }
    if (body.status !== undefined && normalizeLeadStatus(String(body.status)) === 'converted') {
      return NextResponse.json(
        { success: false, error: '请使用专用签约操作标记客户已签约' },
        { status: 400 }
      );
    }
    if (body.assignedTo !== undefined) {
      return NextResponse.json(
        {
          success: false,
          error: '线索创建时绑定的设计师不可在线索详情中修改；请在员工管理中调整测量员绑定，换绑仅影响后续新线索',
        },
        { status: 400 }
      );
    }
    const updated = await withLeadTransaction(
      context,
      async (transaction) => {
        const repository = new LeadRepository(transaction);
        const current = await repository.findById(leadId);
        if (!current || !canAccess(current, context)) return null;
        if (current.archivedAt) throw leadArchivedError();
        if (
          body.status !== undefined &&
          isProtectedConversionStatusChange(current.status, String(body.status))
        ) {
          throw Object.assign(
            new Error('已签约状态只能通过专用签约操作修改或撤销'),
            { status: 400 }
          );
        }

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
          input.status = normalizeLeadStatus(String(body.status));
        }
        if (body.notes !== undefined) input.notes = String(body.notes) || null;
        if (Array.isArray(body.followUpRecords)) {
          input.followUpRecords = body.followUpRecords.filter(
            (item: unknown) => item && typeof item === 'object'
          );
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
    const publicationFacts = await loadLeadPublicationFacts(request, context, updated);
    return NextResponse.json({ success: true, data: dtoForContext(request, updated, context, publicationFacts) });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, code: (error as { code?: string }).code, error: errorMessage(error) },
      { status: httpErrorStatus(error, 500) }
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
    if (!admin.enterpriseId) {
      return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    }
    if (!canPurgeLeads(admin.role)) {
      return NextResponse.json({ success: false, error: '无权永久删除客户线索' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const { id } = await params;
    const leadId = parsePostgresId(id, 'lead id');
    const actorId = parsePostgresId(admin.userId, 'userId');
    const result = await withAdminPostgresTransaction(
      admin as TenantContext,
      async (transaction) => {
        const lifecycle = new LeadLifecycleRepository(transaction);
        await lifecycle.lockByIds([leadId]);
        const lead = await new LeadRepository(transaction).findById(leadId);
        if (!lead || !canAccessLeadForActor(lead, admin.role, actorId)) return null;
        if (!lead.archivedAt) return { conflict: ['线索尚未归档'] };
        if (body.confirmName !== lead.name) return { confirmationRequired: true };
        const impact = (await lifecycle.impacts([leadId]))[0];
        if (!impact) return null;
        const blockers = getPurgeBlockers(impact);
        if (blockers.length) return { conflict: blockers };
        const deleted = await lifecycle.purge(leadId, actorId, impact);
        return deleted ? { deleted: true } : null;
      }
    );
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Lead not found or access denied' },
        { status: 404 }
      );
    }
    if ('confirmationRequired' in result) {
      return NextResponse.json({ success: false, error: '请输入完整客户名称确认永久删除' }, { status: 400 });
    }
    if ('conflict' in result) {
      return NextResponse.json(
        { success: false, code: 'LEAD_PURGE_BLOCKED', error: '该线索包含受保护数据，不能永久删除', blockers: result.conflict },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true, data: {} });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: httpErrorStatus(error, 500) }
    );
  }
}
