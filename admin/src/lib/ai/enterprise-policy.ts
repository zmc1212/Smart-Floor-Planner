import mongoose from 'mongoose';
import { Enterprise } from '@/models/Enterprise';
import { AI_ACTION_KEYS, type AiActionKey } from '@/lib/ai/provider-types';

export async function getEnterpriseAiPolicy(enterpriseId: string | mongoose.Types.ObjectId) {
  const enterprise = await Enterprise.findById(enterpriseId).select('aiPolicy').lean();
  if (!enterprise) throw new Error('企业不存在');
  const configured = enterprise.aiPolicy?.enabledActionKeys;
  const enabledActionKeys = Array.isArray(configured) && configured.length
    ? configured.filter((key): key is AiActionKey => AI_ACTION_KEYS.includes(key as AiActionKey))
    : [...AI_ACTION_KEYS];
  return { enabledActionKeys, logicalModelTier: enterprise.aiPolicy?.logicalModelTier || 'standard' as const };
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
