import { AiCreationRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import {
  consumePostgresCreationGenerationCredits,
  holdPostgresCreationGenerationCredits,
  releasePostgresCreationGenerationCredits,
} from '@/lib/ai/postgres-creation-service';
import { executePostgresWorkflowChat } from '@/lib/ai/postgres-workflow-chat';
import { getAiCreditPrice } from '@/lib/ai/credits';
import type { AiChatMessage } from '@/lib/ai/provider-types';

type AdviceInput = Record<string, unknown>;

/**
 * Persists synchronous text advice with the same tenant-scoped credit and
 * provider-attempt lifecycle used by the PostgreSQL image-generation paths.
 */
export async function executePostgresAdviceGeneration(input: {
  enterpriseId: string;
  operatorId: string;
  generationInput: AdviceInput;
  output?: AdviceInput;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  await assertEnterpriseAiActionAllowed(enterpriseId.toString(), 'text.design_advice');
  const price = await getAiCreditPrice('text.design_advice');
  const generation = await withTenantTransaction(enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).createGeneration({
      enterpriseId,
      operatorId,
      type: 'advice',
      channel: 'admin',
      actionKey: 'text.design_advice',
      capability: 'chat',
      logicalModelKey: 'chat.general',
      status: 'pending',
      input: input.generationInput,
      output: input.output || {},
      billing: {
        cycle: 0,
        actionKey: 'text.design_advice',
        price: price.credits,
        priceSnapshot: {
          actionKey: 'text.design_advice',
          label: price.label,
          credits: price.credits,
          capturedAt: new Date().toISOString(),
        },
        status: 'unbilled',
      },
    })
  );

  let creditsHeld = false;
  let providerCompleted = false;
  try {
    await holdPostgresCreationGenerationCredits({
      enterpriseId: enterpriseId.toString(),
      generationId: generation.id.toString(),
    });
    creditsHeld = true;
    const result = await executePostgresWorkflowChat({
      enterpriseId,
      generationId: generation.id,
      logicalModelKey: 'chat.general',
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      metadata: { generationType: 'advice' },
    });
    providerCompleted = true;
    const completed = await withTenantTransaction(enterpriseId, async (transaction) => {
      const repository = new AiCreationRepository(transaction);
      const current = await repository.findGenerationForUpdate(generation.id);
      if (!current) throw new Error('AI 建议生成记录不存在');
      return repository.updateGeneration(generation.id, {
        status: 'succeeded',
        provider: result.provider,
        output: { ...(current.output || {}), adviceText: result.content },
      });
    });
    if (!completed) throw new Error('AI 建议生成记录不存在');
    const settled = await consumePostgresCreationGenerationCredits({
      enterpriseId: enterpriseId.toString(),
      generationId: generation.id.toString(),
    });
    return { generation: settled.generation, advice: result.content };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 建议生成失败';
    if (creditsHeld && !providerCompleted) {
      await releasePostgresCreationGenerationCredits({
        enterpriseId: enterpriseId.toString(),
        generationId: generation.id.toString(),
        errorCode: 'ADVICE_PROVIDER_ERROR',
        errorMessage: message,
      }).catch(() => undefined);
    } else if (!creditsHeld) {
      await withTenantTransaction(enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).updateGeneration(generation.id, {
          status: 'failed',
          errorCode: 'ADVICE_CREDIT_HOLD_ERROR',
          errorMessage: message,
        })
      ).catch(() => undefined);
    }
    throw error;
  }
}
