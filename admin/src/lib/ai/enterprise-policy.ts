import { EnterpriseRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { AI_ACTION_KEYS, type AiActionKey } from '@/lib/ai/provider-types';

type AiPolicy = {
  enabledActionKeys?: unknown;
  logicalModelTier?: unknown;
};

function serializeAiPolicy(aiPolicy?: AiPolicy | null) {
  const configured = aiPolicy?.enabledActionKeys;
  const enabledActionKeys = Array.isArray(configured) && configured.length
    ? configured.filter((key): key is AiActionKey => AI_ACTION_KEYS.includes(key as AiActionKey))
    : [...AI_ACTION_KEYS];
  return { enabledActionKeys, logicalModelTier: 'standard' as const };
}

export async function getEnterpriseAiPolicy(enterpriseId: string | bigint) {
  const id = parsePostgresId(enterpriseId, 'enterpriseId');
  const enterprise = await withTenantTransaction(
    id,
    (transaction) => new EnterpriseRepository(transaction).findById(id)
  );
  if (!enterprise) throw new Error('Enterprise not found');
  return serializeAiPolicy(enterprise.aiPolicy);
}

export async function assertEnterpriseAiActionAllowed(
  enterpriseId: string | bigint,
  actionKey: AiActionKey
) {
  const policy = await getEnterpriseAiPolicy(enterpriseId);
  if (!policy.enabledActionKeys.includes(actionKey)) {
    const error = new Error('This AI action is disabled for the enterprise') as Error & {
      status?: number;
      code?: string;
    };
    error.status = 403;
    error.code = 'AI_ACTION_DISABLED';
    throw error;
  }
  return policy;
}
