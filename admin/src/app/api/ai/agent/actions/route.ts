import { NextRequest, NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiChatSessionRepository } from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { getTenantContext, type TenantContext } from '@/lib/auth';
import {
  createAiWorkflow,
  getAiWorkflowContext,
  runAiWorkflowStage,
  selectAiGenerationBaseline,
} from '@/lib/ai/workflow-service';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { buildWorkflowDetailUiPayload } from '@/lib/ai/agent';

type AgentActionName =
  | 'run_workflow_stage'
  | 'select_generation_baseline'
  | 'refresh_workflow_detail'
  | 'create_workflow';

type AgentActionBody = {
  conversationId?: string;
  actionName?: AgentActionName;
  workflowId?: string;
  leadId?: string;
  workflowLabel?: string;
  sourceFloorPlanId?: string;
  sourceImage?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  styleReferenceImage?: string;
  stageKey?: AiWorkflowStageKey;
  generationId?: string;
  confirmed?: boolean;
};

const MAX_STORED_MESSAGE_CHARS = 8000;

function truncateContent(content: string, maxLength = MAX_STORED_MESSAGE_CHARS) {
  return content.length > maxLength
    ? `${content.slice(0, maxLength)}\n\n[内容过长，已截断]`
    : content;
}

function toTenantContext(context: NonNullable<Awaited<ReturnType<typeof getTenantContext>>>): TenantContext {
  return {
    userId: context.userId,
    enterpriseId: context.enterpriseId || '',
    role: context.role,
    username: context.username,
  };
}

function requireString(value: string | undefined, label: string) {
  if (!value) {
    throw new Error(`缺少 ${label}`);
  }

  return value;
}

function buildActionContent(actionName: AgentActionName, workflowTitle?: string, leadName?: string) {
  const target = workflowTitle ? `「${workflowTitle}」` : '该方案';

  if (actionName === 'create_workflow') {
    return `已为${leadName || '该客户'}创建 AI 设计工作流${workflowTitle ? `「${workflowTitle}」` : ''}。`;
  }

  if (actionName === 'run_workflow_stage') {
    return `已执行${target}的推荐工作流步骤，并刷新了当前方案状态。`;
  }

  if (actionName === 'select_generation_baseline') {
    return `已更新${target}的当前定稿，并刷新了后续可执行步骤。`;
  }

  return `已刷新${target}的最新 AI 设计工作流状态。`;
}

export async function POST(req: NextRequest) {
  try {
    const context = await getTenantContext(req);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!context.enterpriseId) {
      return NextResponse.json({ success: false, error: 'Enterprise context required' }, { status: 400 });
    }

    const body = (await req.json()) as AgentActionBody;
    const conversationId = requireString(body.conversationId, 'conversationId');
    const actionName = body.actionName;
    if (!actionName) {
      return NextResponse.json({ success: false, error: 'Missing actionName' }, { status: 400 });
    }

    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const adminId = parsePostgresId(context.userId, 'userId');
    const sessionId = parsePostgresId(conversationId, 'conversation id');
    const session = await withAdminPostgresTransaction(context, (transaction) =>
      new AiChatSessionRepository(transaction).findById(sessionId, enterpriseId, adminId)
    );

    if (!session) {
      return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
    }

    const tenantContext = toTenantContext(context);
    let workflowId = body.workflowId;

    if (actionName === 'create_workflow') {
      if (!body.confirmed) {
        return NextResponse.json({ success: false, error: 'Action confirmation required' }, { status: 400 });
      }

      const workflow = await createAiWorkflow(
        {
          leadId: requireString(body.leadId, 'leadId'),
          workflowLabel: body.workflowLabel || '首轮方案',
          sourceFloorPlanId: body.sourceFloorPlanId,
          sourceImage: body.sourceImage,
          sourceAssetRole: body.sourceAssetRole,
        },
        tenantContext
      );
      workflowId = String(workflow._id);
    } else if (actionName === 'run_workflow_stage') {
      workflowId = requireString(workflowId, 'workflowId');
      if (!body.confirmed) {
        return NextResponse.json({ success: false, error: 'Action confirmation required' }, { status: 400 });
      }

      await runAiWorkflowStage(
        {
          workflowId,
          stageKey: requireString(body.stageKey, 'stageKey') as AiWorkflowStageKey,
          styleReferenceImage: body.styleReferenceImage,
          confirmed: true,
        },
        tenantContext
      );
    } else if (actionName === 'select_generation_baseline') {
      workflowId = requireString(workflowId, 'workflowId');
      if (!body.confirmed) {
        return NextResponse.json({ success: false, error: 'Action confirmation required' }, { status: 400 });
      }

      await selectAiGenerationBaseline(
        {
          workflowId,
          generationId: requireString(body.generationId, 'generationId'),
          confirmed: true,
        },
        tenantContext
      );
    } else if (actionName === 'refresh_workflow_detail') {
      workflowId = requireString(workflowId, 'workflowId');
    } else {
      return NextResponse.json({ success: false, error: 'Unsupported actionName' }, { status: 400 });
    }

    const workflowContext = await getAiWorkflowContext(workflowId, tenantContext);
    const content = buildActionContent(actionName, workflowContext.workflow.title, workflowContext.lead.name);
    const assistantMessage = {
      role: 'assistant' as const,
      content,
      uiPayload: buildWorkflowDetailUiPayload(workflowContext),
      conversationId: session.id.toString(),
    };

    await withAdminPostgresTransaction(context, (transaction) =>
      new AiChatSessionRepository(transaction).appendMessage(
        session.id,
        enterpriseId,
        adminId,
        {
          role: 'assistant',
          content: truncateContent(content),
          uiPayload: assistantMessage.uiPayload,
          createdAt: new Date(),
        }
      )
    );

    return NextResponse.json({
      success: true,
      data: assistantMessage,
    });
  } catch (error: unknown) {
    console.error('[Agent Action API Error]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
