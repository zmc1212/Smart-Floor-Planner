import type { AiLogicalModelKey, AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

export function resolveProviderCostEstimate(
  runtime: AiProviderRuntimeConfig,
  logicalModelKey: AiLogicalModelKey,
  remoteModel?: string,
  resolutionTier?: string
) {
  const rules = runtime.costRules || [];
  const rule = rules.find((item) => item.logicalModelKey === logicalModelKey && item.remoteModel === remoteModel && item.resolutionTier === resolutionTier)
    || rules.find((item) => item.logicalModelKey === logicalModelKey && item.remoteModel === remoteModel && !item.resolutionTier)
    || rules.find((item) => item.logicalModelKey === logicalModelKey && !item.remoteModel && item.resolutionTier === resolutionTier)
    || rules.find((item) => item.logicalModelKey === logicalModelKey && !item.remoteModel && !item.resolutionTier);
  return rule ? { currency: rule.currency, micros: rule.estimatedMicros } : undefined;
}
