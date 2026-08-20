import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  createPostgresAiWorkflowManualGeneration,
  getPostgresAiWorkflowContext,
  updatePostgresAiWorkflowState,
} from '@/lib/ai/postgres-workflow-service';
import { AiWorkflowRepository, CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';

type WorkflowPatchBody = {
  action?: 'select-generation' | 'set-stage' | 'rename' | 'mock-generation';
  generationId?: string;
  nextStageKey?: AiWorkflowStageKey;
  stageKey?: AiWorkflowStageKey;
  title?: string;
  imageUrl?: string;
  parentGenerationId?: string;
  sourceAssetRole?: string;
  styleReferenceImage?: string;
};

const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

function isPostgresWorkflowId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;
}

function canManageWorkflow(role: string, assignedTo: bigint | null, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && assignedTo === staffId);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!isPostgresWorkflowId(id)) {
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
      }
      const workflowContext = await getPostgresAiWorkflowContext({
        enterpriseId: context.enterpriseId!,
        workflowId: id,
      });
      return NextResponse.json({ success: true, data: workflowContext });
    });
  } catch (error) {
    console.error('[AI Workflow GET]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load workflow detail' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true, roles: ['designer', 'enterprise_admin'] }, async (context) => {
      const { id } = await params;
      if (!isPostgresWorkflowId(id)) {
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
      }

      const workflowId = parsePostgresId(id, 'workflowId');
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const staffId = parsePostgresId(context.userId, 'staff id');

      return withTenantTransaction(enterpriseId, async (transaction) => {
        const workflow = await new AiWorkflowRepository(transaction).findById(workflowId);
        if (!workflow || workflow.status !== 'active') {
          return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
        }

        const lead = await new LeadRepository(transaction).findById(workflow.leadId);
        if (!lead) return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
        if (lead.archivedAt) return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
        if (!canManageWorkflow(context.role, lead.assignedTo, staffId)) {
          return NextResponse.json({ success: false, error: '无权删除该方案' }, { status: 403 });
        }

        await new AiWorkflowRepository(transaction).update(workflowId, { status: 'archived' });
        const withdrawn = await new CustomerProjectRepository(transaction).withdrawScheme({
          enterpriseId,
          leadId: workflow.leadId,
          workflowId,
          withdrawnBy: staffId,
        });
        if (withdrawn.kind === 'publication_not_found') {
          // Still consider it a successful delete. Withdraw will be a no-op if nothing was published.
        }

        return NextResponse.json({ success: true, data: { workflowId: workflowId.toString() } });
      });
    });
  } catch (error) {
    console.error('[AI Workflow DELETE]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete workflow' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!isPostgresWorkflowId(id)) {
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
      }
      const body = (await req.json()) as WorkflowPatchBody;
      if (body.action === 'mock-generation') {
        if (!body.stageKey || !body.imageUrl) {
          return NextResponse.json({ success: false, error: 'Missing stageKey or imageUrl' }, { status: 400 });
        }
        await createPostgresAiWorkflowManualGeneration({
          enterpriseId: context.enterpriseId!,
          operatorId: context.userId,
          workflowId: id,
          stageKey: body.stageKey,
          imageUrl: body.imageUrl,
          parentGenerationId: body.parentGenerationId,
          sourceAssetRole: body.sourceAssetRole,
          styleReferenceImage: body.styleReferenceImage,
          nextStageKey: body.nextStageKey,
        });
      } else if (body.action === 'rename' || body.action === 'set-stage' || body.action === 'select-generation') {
        await updatePostgresAiWorkflowState({
          enterpriseId: context.enterpriseId!,
          workflowId: id,
          action: body.action,
          title: body.title,
          stageKey: body.stageKey,
          generationId: body.generationId,
        });
      } else {
        return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 });
      }
      const workflowContext = await getPostgresAiWorkflowContext({
        enterpriseId: context.enterpriseId!,
        workflowId: id,
      });
      return NextResponse.json({ success: true, data: workflowContext });
    });
  } catch (error) {
    console.error('[AI Workflow PATCH]', error);
    const status = (error as Error & { status?: number }).status;
    return NextResponse.json(
      { success: false, code: (error as { code?: string })?.code, error: error instanceof Error ? error.message : 'Failed to update workflow' },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
