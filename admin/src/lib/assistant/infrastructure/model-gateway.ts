import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import type { TextModelGateway, Evidence } from '../contracts';
import { fail } from '../contracts';
import { markProviderStarted, markProviderStartedInTransaction, runContext, type Lease } from './job-queue';
import { withTenantTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';
import { previewExecutionFromPolicy } from '../core/execution-config';

/** Old string adapters cannot report usage, finish reason, or request IDs. Keep them unknown. */
export function textGateway(lease: Lease, evidence:Evidence[]=[]): TextModelGateway {
  return {
    capabilities: { streaming: false, toolCalling: false, usage: false },
    async generate(input) {
      if (input.enterpriseId !== lease.enterpriseId || input.owner.kind !== 'assistant_run' || String(input.owner.runId) !== lease.runId) fail('assistant_capability_forbidden', 403);
      if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 2048 || Buffer.byteLength(JSON.stringify(input.messages), 'utf8') > 9000) fail('invalid_message', 422);
      const execution = await withTenantTransaction(lease.enterpriseId, async tx => {
        const context = await runContext(tx, lease);
        return previewExecutionFromPolicy(context.run.policy_snapshot as Row);
      });
      const result = await executePostgresText({
        enterpriseId: BigInt(input.enterpriseId), owner: input.owner, logicalModelKey: 'chat.general', messages: input.messages,
        maxTokens: input.maxTokens, temperature:0,
        expectedExecution: execution ?? undefined,
        beforeProviderAttempt: execution ? tx => markProviderStartedInTransaction(tx, lease, evidence, execution.revision) : undefined,
        beforeProviderCall: execution ? undefined : () => markProviderStarted(lease,evidence),
      });
      return { text: result.content, attemptId: String(result.attemptId), usage: null, finishReason: null, providerRequestId: null };
    },
  };
}
