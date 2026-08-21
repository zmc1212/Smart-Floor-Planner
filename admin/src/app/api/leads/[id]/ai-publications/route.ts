import { NextResponse } from 'next/server';
import type { PostgresTransaction } from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
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
      return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可管理方案发布' }, { status: 403 });
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
    return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可管理方案发布' }, { status: 403 });
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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolvePublisher(request);
    if (isResponse(actor)) return actor;
    const leadId = parsePostgresId((await params).id, 'lead id');
    const generationIdText = new URL(request.url).searchParams.get('generationId');
    const generationId = generationIdText ? parsePostgresId(generationIdText, 'generation id') : null;
    const result = await actor.run(async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canPublish(actor.role, lead.assignedTo, actor.staffId)) return null;
      const repository = new CustomerProjectRepository(transaction);
      const publications = await repository.listActivePublications(actor.enterpriseId, leadId);
      const publishable = await repository.listPublishableGenerations(actor.enterpriseId, leadId);
      return {
        publications: publications.map((item) => ({
          generationId: item.generation.id.toString(),
          publishedAt: item.publication.publishedAt,
        })),
        publishable: publishable.map((item) => ({
          generationId: item.id.toString(),
          type: item.type,
          updatedAt: item.updatedAt,
        })),
      };
    });
    if (!result) return NextResponse.json({ success: false, error: '无权查看该客户项目的方案' }, { status: 403 });
    return NextResponse.json({
      success: true,
      data: generationId
        ? { generationId: generationId.toString(), published: result.publications.some((item) => item.generationId === generationId.toString()), publication: result.publications.find((item) => item.generationId === generationId.toString()) || null }
        : result.publications,
      publishable: result.publishable,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取方案发布状态失败' }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolvePublisher(request);
    if (isResponse(actor)) return actor;
    const body = await request.json();
    const leadId = parsePostgresId((await params).id, 'lead id');
    const generationId = parsePostgresId(body.generationId, 'generation id');
    const result = await actor.run(async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canPublish(actor.role, lead.assignedTo, actor.staffId)) {
        return { kind: 'forbidden' as const };
      }
      return new CustomerProjectRepository(transaction).publish({
        enterpriseId: actor.enterpriseId,
        leadId,
        generationId,
        publishedBy: actor.staffId,
      });
    });
    if (result.kind === 'lead_not_found') return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
    if (result.kind === 'lead_archived') return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
    if (result.kind === 'generation_not_publishable') return NextResponse.json({ success: false, error: '方案未完成、已删除或不属于该客户项目' }, { status: 409 });
    if (result.kind === 'forbidden') return NextResponse.json({ success: false, error: '无权发布该客户项目的方案' }, { status: 403 });
    if (result.kind === 'published' && result.created) {
      await Promise.allSettled([
        notifyCustomerOfDesignPublished({
          enterpriseId: actor.enterpriseId,
          leadId,
          generationIds: [generationId],
          title: '设计方案',
          publishedAt: result.publication?.publication.publishedAt || new Date(),
        }),
      ]);
    }
    return NextResponse.json({ success: true, data: { id: result.publication?.publication.id.toString(), generationId: generationId.toString() } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '发布方案失败' }, { status: 400 });
  }
}
