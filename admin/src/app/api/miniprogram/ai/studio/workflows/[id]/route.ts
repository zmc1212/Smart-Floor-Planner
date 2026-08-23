import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiWorkflowRepository, CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import {
  assertMiniStudioLeadAccess,
  canManageLead,
  isMiniStudioContext,
  requireMiniStudioContext,
  serializeWorkflowContextForMini,
} from '@/lib/ai/mini-ai-studio';
import {
  getPostgresAiWorkflowContext,
  updatePostgresAiWorkflowState,
} from '@/lib/ai/postgres-workflow-service';

export const dynamic = 'force-dynamic';

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresWorkflowId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

type WorkflowPatchBody = {
  action?: 'rename';
  title?: string;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const { id } = await params;
    if (!isPostgresWorkflowId(id)) {
      return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
    }
    const workflowContext = await getPostgresAiWorkflowContext({
      enterpriseId: context.enterpriseId,
      workflowId: id,
    });
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const access = await withTenantTransaction(enterpriseId, (transaction) =>
      assertMiniStudioLeadAccess(transaction, context, parsePostgresId(workflowContext.lead.id, 'leadId')),
    );
    if (access.kind !== 'ok') return access.response;
    return NextResponse.json({
      success: true,
      data: await serializeWorkflowContextForMini(request, context.enterpriseId, workflowContext),
    });
  } catch (error) {
    console.error('[Mini AI Studio Workflow GET]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取方案详情失败' },
      { status: status && status >= 400 ? status : 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const { id } = await params;
    if (!isPostgresWorkflowId(id)) {
      return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
    }
    const body = (await request.json()) as WorkflowPatchBody;
    if (body.action !== 'rename' || !body.title?.trim()) {
      return NextResponse.json({ success: false, error: '请提供有效的重命名参数' }, { status: 400 });
    }
    const workflowContext = await getPostgresAiWorkflowContext({
      enterpriseId: context.enterpriseId,
      workflowId: id,
    });
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const access = await withTenantTransaction(enterpriseId, (transaction) =>
      assertMiniStudioLeadAccess(transaction, context, parsePostgresId(workflowContext.lead.id, 'leadId')),
    );
    if (access.kind !== 'ok') return access.response;
    await updatePostgresAiWorkflowState({
      enterpriseId: context.enterpriseId,
      workflowId: id,
      action: 'rename',
      title: body.title.trim(),
    });
    const updated = await getPostgresAiWorkflowContext({
      enterpriseId: context.enterpriseId,
      workflowId: id,
    });
    return NextResponse.json({
      success: true,
      data: await serializeWorkflowContextForMini(request, context.enterpriseId, updated),
    });
  } catch (error) {
    console.error('[Mini AI Studio Workflow PATCH]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '更新方案失败' },
      { status: status && status >= 400 ? status : 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const { id } = await params;
    if (!isPostgresWorkflowId(id)) {
      return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
    }
    const workflowId = parsePostgresId(id, 'workflowId');
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const staffId = parsePostgresId(context.operatorId, 'staff id');
    return withTenantTransaction(enterpriseId, async (transaction) => {
      const workflow = await new AiWorkflowRepository(transaction).findById(workflowId);
      if (!workflow || workflow.status !== 'active') {
        return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
      }
      const lead = await new LeadRepository(transaction).findById(workflow.leadId);
      if (!lead) return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
      if (lead.archivedAt) {
        return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
      }
      if (!canManageLead(context.role, lead.assignedTo, staffId)) {
        return NextResponse.json({ success: false, error: '无权删除该方案' }, { status: 403 });
      }
      await new AiWorkflowRepository(transaction).update(workflowId, { status: 'archived' });
      await new CustomerProjectRepository(transaction).withdrawScheme({
        enterpriseId,
        leadId: workflow.leadId,
        workflowId,
        withdrawnBy: staffId,
      });
      return NextResponse.json({ success: true, data: { workflowId: workflowId.toString() } });
    });
  } catch (error) {
    console.error('[Mini AI Studio Workflow DELETE]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '删除方案失败' },
      { status: 500 },
    );
  }
}
