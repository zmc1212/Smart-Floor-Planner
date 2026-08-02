import mongoose from 'mongoose';
import { Enterprise } from '@/models/Enterprise';
import { EnterpriseRepository } from '@/db/repositories';
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
  return {
    enabledActionKeys,
    logicalModelTier: 'standard' as const,
  };
}

export async function getEnterpriseAiPolicy(enterpriseId: string | mongoose.Types.ObjectId) {
  if (typeof enterpriseId === 'string' && /^[1-9]\d*$/.test(enterpriseId)) {
    const enterprise = await withTenantTransaction(
      enterpriseId,
      (transaction) => new EnterpriseRepository(transaction).findById(BigInt(enterpriseId))
    );
    if (!enterprise) throw new Error('企业不存在');
    return serializeAiPolicy(enterprise.aiPolicy);
  }

  const enterprise = await Enterprise.findById(enterpriseId).select('aiPolicy').lean();
  if (!enterprise) throw new Error('企业不存在');
  return serializeAiPolicy(enterprise.aiPolicy);
}

export async function assertEnterpriseAiActionAllowed(enterpriseId: string | mongoose.Types.ObjectId, actionKey: AiActionKey) {
  const policy = await getEnterpriseAiPolicy(enterpriseId);
  if (!policy.enabledActionKeys.includes(actionKey)) {
    const error = new Error('当前企业未开放该 AI 功能') as Error & { status?: number; code?: string };
    error.status = 403;
    error.code = 'AI_ACTION_DISABLED';
    throw error;
  }
  return policy;
}
