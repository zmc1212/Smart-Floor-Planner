import { NextRequest, NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiChatSessionRepository } from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { getTenantContext } from '@/lib/auth';
import {
  createPostgresAiWorkflow,
  getPostgresAiWorkflowContext,
  preparePostgresAiWorkflowStage,
  updatePostgresAiWorkflowState,
} from '@/lib/ai/postgres-workflow-service';
import { submitPostgresCreationGeneration } from '@/lib/ai/postgres-creation-runtime';
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

function requireString(value: string | undefined, label: string) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function truncateContent(content: string) {
  return content.length > MAX_STORED_MESSAGE_CHARS
    ? `${content.slice(0, MAX_STORED_MESSAGE_CHARS)}\n\n[truncated]`
    : content;
}

function buildActionContent(actionName: AgentActionName, workflowTitle?: string, leadName?: string) {
  if (actionName === 'create_workflow') {
    return `Created ${workflowTitle || 'a workflow'} for ${leadName || 'the customer'}.`;
  }
  if (actionName === 'run_workflow_stage') {
    return `Started the requested stage for ${workflowTitle || 'the workflow'}.`;
  }
  if (actionName === 'select_generation_baseline') {
    return `Updated the selected baseline for ${workflowTitle || 'the workflow'}.`;
  }
  return `Refreshed ${workflowTitle || 'the workflow'}.`;
}

export async function POST(req: NextRequest) {
  try {
    const context = await getTenantContext(req);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!context.enterpriseId) {
      return NextResponse.json({ success: false, error: 'Enterprise context required' }, { status: 400 });
    }

    const body = (await req.json()) as AgentActionBody;
    const conversationId = requireString(body.conversationId, 'conversationId');
    const actionName = body.actionName;
    if (!actionName) return NextResponse.json({ success: false, error: 'Missing actionName' }, { status: 400 });

    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const adminId = parsePostgresId(context.userId, 'userId');
    const sessionId = parsePostgresId(conversationId, 'conversationId');
    const session = await withAdminPostgresTransaction(context, (transaction) =>
      new AiChatSessionRepository(transaction).findById(sessionId, enterpriseId, adminId)
    );
    if (!session) return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });

    let workflowId = body.workflowId;
    if (actionName === 'create_workflow') {
      if (!body.confirmed) return NextResponse.json({ success: false, error: 'Action confirmation required' }, { status: 400 });
      const workflow = await createPostgresAiWorkflow({
        enterpriseId: context.enterpriseId,
        operatorId: context.userId,
        leadId: requireString(body.leadId, 'leadId'),
        workflowLabel: body.workflowLabel || 'First design',
        sourceFloorPlanId: body.sourceFloorPlanId,
        sourceImage: body.sourceImage,
        sourceAssetRole: body.sourceAssetRole,
      });
      workflowId = workflow.id.toString();
    } else if (actionName === 'run_workflow_stage') {
      workflowId = requireString(workflowId, 'workflowId');
      if (!body.confirmed) return NextResponse.json({ success: false, error: 'Action confirmation required' }, { status: 400 });
      const generation = await preparePostgresAiWorkflowStage({
        enterpriseId: context.enterpriseId,
        operatorId: context.userId,
        workflowId,
        stageKey: requireString(body.stageKey, 'stageKey') as AiWorkflowStageKey,
        styleReferenceImage: body.styleReferenceImage,
      });
      await submitPostgresCreationGeneration({
        enterpriseId: context.enterpriseId,
        generationId: generation.id.toString(),
      });
    } else if (actionName === 'select_generation_baseline') {
      workflowId = requireString(workflowId, 'workflowId');
      if (!body.confirmed) return NextResponse.json({ success: false, error: 'Action confirmation required' }, { status: 400 });
      await updatePostgresAiWorkflowState({
        enterpriseId: context.enterpriseId,
        workflowId,
        action: 'select-generation',
        generationId: requireString(body.generationId, 'generationId'),
      });
    } else if (actionName === 'refresh_workflow_detail') {
      workflowId = requireString(workflowId, 'workflowId');
    } else {
      return NextResponse.json({ success: false, error: 'Unsupported actionName' }, { status: 400 });
    }

    const workflowContext = await getPostgresAiWorkflowContext({
      enterpriseId: context.enterpriseId,
      workflowId: requireString(workflowId, 'workflowId'),
    });
    const content = buildActionContent(actionName, workflowContext.workflow.title, workflowContext.lead.name);
    const assistantMessage = {
      role: 'assistant' as const,
      content,
      uiPayload: buildWorkflowDetailUiPayload(workflowContext),
      conversationId: session.id.toString(),
    };

    await withAdminPostgresTransaction(context, (transaction) =>
      new AiChatSessionRepository(transaction).appendMessage(session.id, enterpriseId, adminId, {
        role: 'assistant',
        content: truncateContent(content),
        uiPayload: assistantMessage.uiPayload,
        createdAt: new Date(),
      })
    );
    return NextResponse.json({ success: true, data: assistantMessage });
  } catch (error) {
    console.error('[Agent Action API Error]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
