import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { AiWorkflowRepository } from '@/db/repositories/ai-workflow-repository';
import { LeadLifecycleRepository } from '@/db/repositories/lead-lifecycle-repository';
import { LeadRepository } from '@/db/repositories/lead-repository';
import { withTenantTransaction } from '@/db/transaction';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import { getAiCreditPrice } from '@/lib/ai/credits';
import { executePostgresWorkflowChat } from '@/lib/ai/postgres-workflow-chat';
import { submitPostgresCreationGeneration } from '@/lib/ai/postgres-creation-runtime';
import {
  assertEligibleWorkflowFloorPlan,
  buildWorkflowFloorPlanContext,
} from '@/lib/ai/workflow-floorplan';
import {
  buildConversationFallbackPrompt,
  conversationPromptExpansionMessages,
  resolveConversationBaseline,
} from '@/lib/ai/conversation-prompt';
import { leadArchivedError } from '@/lib/lead-lifecycle';
import { getPostgresAiWorkflowContext } from '@/lib/ai/postgres-workflow-service';
import { getPlatformAiPromptConfig } from '@/lib/ai/platform-ai-prompt-config';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function notFound(message: string) {
  return Object.assign(new Error(message), { status: 404 });
}

export async function runPostgresWorkflowChatTurn(input: {
  enterpriseId: string | bigint;
  operatorId: string | bigint;
  workflowId: string | bigint;
  message: string;
  baselineGenerationId?: string | bigint;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  const workflowId = parsePostgresId(input.workflowId, 'workflowId');
  const userMessage = input.message.trim();
  if (!userMessage) {
    throw Object.assign(new Error('请输入本轮设计要求'), { status: 400 });
  }
  const requestedBaselineId = input.baselineGenerationId
    ? parsePostgresId(input.baselineGenerationId, 'baselineGenerationId')
    : null;

  await assertEnterpriseAiActionAllowed(enterpriseId.toString(), 'image.scenario');
  const price = await getAiCreditPrice('image.scenario');
  const aiPromptConfig = await getPlatformAiPromptConfig();

  const prepared = await withTenantTransaction(enterpriseId, async (transaction) => {
    const workflows = new AiWorkflowRepository(transaction);
    const workflow = await workflows.findById(workflowId);
    if (!workflow || workflow.status !== 'active') throw notFound('方案会话不存在或无权访问');

    await new LeadLifecycleRepository(transaction).lockByIds([workflow.leadId]);
    const lead = await new LeadRepository(transaction).findById(workflow.leadId);
    if (!lead) throw notFound('客户线索不存在或无权访问');
    if (lead.archivedAt) throw leadArchivedError();

    const floorPlan = workflow.sourceFloorPlanId
      ? lead.floorPlanRecords.find((plan) => plan.id === workflow.sourceFloorPlanId) || null
      : null;
    if (!floorPlan) {
      throw Object.assign(new Error('请先关联合格的正式户型再出图'), { status: 400, code: 'WORKFLOW_FLOOR_PLAN_REQUIRED' });
    }
    assertEligibleWorkflowFloorPlan(floorPlan);

    const creations = new AiCreationRepository(transaction);
    const generations = await creations.listGenerationsByWorkflowId(workflow.id);

    const baseline = resolveConversationBaseline(generations, requestedBaselineId);
    const floorPlanContext = buildWorkflowFloorPlanContext(
      floorPlan.layoutData,
      aiPromptConfig.floorPlanConstraintPrompt,
    );
    const fallbackPrompt = buildConversationFallbackPrompt({
      userMessage,
      floorPlanContext,
      hasBaselineImage: Boolean(baseline),
    });
    const previousPrompt = typeof asRecord(baseline?.output).promptUsed === 'string'
      ? String(asRecord(baseline?.output).promptUsed)
      : typeof asRecord(baseline?.input).customPrompt === 'string'
        ? String(asRecord(baseline?.input).customPrompt)
        : undefined;

    const generation = await creations.createGeneration({
      enterpriseId,
      operatorId,
      leadId: workflow.leadId,
      workflowId: workflow.id,
      floorPlanId: workflow.sourceFloorPlanId,
      parentGenerationId: baseline?.id ?? null,
      type: 'scenario',
      channel: 'admin',
      actionKey: 'image.scenario',
      capability: 'image.edit',
      logicalModelKey: 'image.edit.standard',
      stageKey: 'conversation',
      sourceAssetRole: 'floor_plan',
      input: {
        userMessage,
        customPrompt: fallbackPrompt,
        styleReferenceImage: baseline ? asRecord(baseline.output).imageUrl : undefined,
        presetSnapshot: { image: { mode: 'edit', size: '1024x1024', quality: 'medium' } },
      },
      output: { promptUsed: fallbackPrompt },
      status: 'pending',
      billing: {
        cycle: 0,
        actionKey: 'image.scenario',
        price: price.credits,
        priceSnapshot: {
          actionKey: 'image.scenario',
          label: price.label,
          credits: price.credits,
          capturedAt: new Date().toISOString(),
        },
        status: 'unbilled',
      },
    });
    await workflows.update(workflow.id, {
      currentStageKey: 'conversation',
      lastGenerationId: generation.id,
    });
    return {
      generation,
      floorPlanContext,
      previousPrompt,
      hasBaselineImage: Boolean(baseline),
    };
  });

  try {
    const expanded = await executePostgresWorkflowChat({
      enterpriseId,
      generationId: prepared.generation.id,
      logicalModelKey: 'chat.general',
      messages: conversationPromptExpansionMessages({
        userMessage,
        floorPlanContext: prepared.floorPlanContext,
        hasBaselineImage: prepared.hasBaselineImage,
        previousPrompt: prepared.previousPrompt,
      }),
      temperature: 0.4,
      maxTokens: 400,
      metadata: { workflowStage: 'conversation', step: 'prompt_expansion' },
    });
    const customPrompt = [prepared.floorPlanContext, expanded.content.trim()].filter(Boolean).join('\n\n');
    if (customPrompt.trim()) {
      await withTenantTransaction(enterpriseId, async (transaction) => {
        const creations = new AiCreationRepository(transaction);
        const current = await creations.findGenerationForUpdate(prepared.generation.id);
        if (!current || current.status !== 'pending') return;
        await creations.updateGeneration(current.id, {
          input: { ...asRecord(current.input), customPrompt, expandedPrompt: expanded.content.trim() },
          output: { ...asRecord(current.output), promptUsed: customPrompt },
        });
      });
    }
  } catch {
    // Prompt expansion is best-effort; the fallback prompt already includes the floor-plan constraints.
  }

  await submitPostgresCreationGeneration({
    enterpriseId: enterpriseId.toString(),
    generationId: prepared.generation.id.toString(),
  });
  return getPostgresAiWorkflowContext({ enterpriseId, workflowId });
}
