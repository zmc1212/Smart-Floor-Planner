import { NextResponse } from 'next/server';
import type { PostgresTransaction } from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { buildPublishedSchemeViews, groupPublishedSchemes } from '@/lib/customer-project';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { notifyCustomerOfDesignPublished } from '@/lib/wechat-notification';

function canPublish(role: string, assignedTo: bigint | null, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && assignedTo === staffId);
}

type Actor = {
  role: string;
  enterpriseId: bigint;
  staffId: bigint;
  run: <T>(fn: (transaction: PostgresTransaction) => Promise<T>) => Promise<T>;
};

async function resolvePublisher(request: Request): Promise<Actor | NextResponse> {
  const miniContext = await resolveMiniProgramContext(request);
  if (miniContext) {
    if (!miniContext.enterpriseId || miniContext.mode !== 'staff' || !miniContext.staff || !['designer', 'enterprise_admin'].includes(miniContext.staff.role)) {
      return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可管理方案发布' }, { status: 403 });
    }
    return {
      role: miniContext.staff.role,
      enterpriseId: parsePostgresId(miniContext.enterpriseId, 'enterprise id'),
      staffId: parsePostgresId(miniContext.staff._id, 'staff id'),
      run: (fn) => withMiniProgramPostgresTransaction(miniContext, fn),
    };
  }
  const admin = await getTenantContext(request);
  if (!admin) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
  if (!admin.enterpriseId || !['designer', 'enterprise_admin'].includes(admin.role)) {
    return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可管理方案发布' }, { status: 403 });
  }
  return {
    role: admin.role,
    enterpriseId: parsePostgresId(admin.enterpriseId, 'enterprise id'),
    staffId: parsePostgresId(admin.userId, 'user id'),
    run: (fn) => withAdminPostgresTransaction(admin, fn),
  };
}

function isResponse(value: Actor | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

function schemeSummary(scheme: ReturnType<typeof buildPublishedSchemeViews>[number]) {
  return {
    id: scheme.id,
    workflowId: scheme.workflowId,
    title: scheme.title,
    firstPublishedAt: scheme.firstPublishedAt,
    publishedAt: scheme.publishedAt,
    finalized: Boolean(scheme.finalized),
    imageCount: scheme.images.length,
    generationIds: scheme.images.map((image) => image.generationId),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolvePublisher(request);
    if (isResponse(actor)) return actor;
    const leadId = parsePostgresId((await params).id, 'lead id');
    const result = await actor.run(async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canPublish(actor.role, lead.assignedTo, actor.staffId)) return null;
      const publications = await new CustomerProjectRepository(transaction).listActivePublications(actor.enterpriseId, leadId);
      return buildPublishedSchemeViews(publications, leadId.toString(), lead.finalizedWorkflowId).map(schemeSummary);
    });
    if (!result) return NextResponse.json({ success: false, error: '无权查看该客户项目的方案' }, { status: 403 });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取方案发布状态失败' }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolvePublisher(request);
    if (isResponse(actor)) return actor;
    const body = await request.json() as { workflowId?: string; title?: string; generationIds?: string[] };
    const leadId = parsePostgresId((await params).id, 'lead id');
    const workflowId = parsePostgresId(body.workflowId, 'workflow id');
    const generationIds = Array.isArray(body.generationIds) ? body.generationIds.map((id) => parsePostgresId(id, 'generation id')) : [];
    const result = await actor.run(async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canPublish(actor.role, lead.assignedTo, actor.staffId)) {
        return { kind: 'forbidden' as const };
      }
      return new CustomerProjectRepository(transaction).publishScheme({
        enterpriseId: actor.enterpriseId,
        leadId,
        workflowId,
        title: typeof body.title === 'string' ? body.title : '',
        generationIds,
        publishedBy: actor.staffId,
      });
    });
    if (result.kind === 'lead_not_found') return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
    if (result.kind === 'lead_archived') return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
    if (result.kind === 'workflow_not_found') return NextResponse.json({ success: false, error: '方案对话不存在或不属于该客户' }, { status: 404 });
    if (result.kind === 'empty_selection') return NextResponse.json({ success: false, error: '请至少选择一张效果图' }, { status: 400 });
    if (result.kind === 'generation_not_publishable') return NextResponse.json({ success: false, error: '所选效果图未完成、不属于该对话或不属于该客户项目' }, { status: 409 });
    if (result.kind === 'forbidden') return NextResponse.json({ success: false, error: '无权发布该客户项目的方案' }, { status: 403 });
    if (result.kind === 'published' && result.newGenerationIds.length) {
      await Promise.allSettled([
        notifyCustomerOfDesignPublished({
          enterpriseId: actor.enterpriseId,
          leadId,
          generationIds: result.newGenerationIds,
          title: result.title,
          publishedAt: new Date(),
        }),
      ]);
    }
    return NextResponse.json({
      success: true,
      data: {
        workflowId: workflowId.toString(),
        title: result.title,
        generationIds: result.publications.map((item) => item.generation.id.toString()),
      },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '发布方案失败' }, { status: 400 });
  }
}
