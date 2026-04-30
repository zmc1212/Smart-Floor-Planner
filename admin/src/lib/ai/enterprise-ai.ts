import { Enterprise, IEnterprise } from '@/models/Enterprise';
import {
  EnterpriseAiUsageSnapshot,
  IEnterpriseAiUsageDaily,
} from '@/models/EnterpriseAiUsageSnapshot';
import { decryptText, encryptText, maskSecret } from '@/lib/crypto';
import {
  createManagedPollinationsKey,
  getPollinationsBalance,
  getPollinationsDailyUsage,
  getPollinationsKeyState,
  PollinationsDailyUsageItem,
  revokeManagedPollinationsKey,
} from './pollinations-account';

export type EnterpriseAiStatus = 'active' | 'disabled' | 'revoked';

export interface EnterprisePollinationsRuntimeConfig {
  enterpriseId: string;
  keyId?: string;
  keyName?: string;
  apiKey: string;
  maskedKey: string;
  allowedModels: string[];
  pollenBudget: number | null;
  status: EnterpriseAiStatus;
}

function normalizeUsage(items: PollinationsDailyUsageItem[]) {
  const usageMap = new Map<string, IEnterpriseAiUsageDaily>();

  for (const item of items) {
    const key = `${item.date}::${item.model || 'unknown'}`;
    usageMap.set(key, {
      date: item.date,
      model: item.model || 'unknown',
      requests: Number(item.requests || 0),
      costUsd: Number(item.costUsd || 0),
      meterSource: item.meterSource || '',
    });
  }

  return Array.from(usageMap.values()).sort((a, b) =>
    a.date === b.date ? a.model.localeCompare(b.model) : a.date.localeCompare(b.date)
  );
}

function getAiConfig(enterprise: IEnterprise | null | undefined) {
  return enterprise?.aiConfig;
}

export function sanitizeEnterpriseAiConfig(
  enterprise: IEnterprise | (Record<string, unknown> & { aiConfig?: IEnterprise['aiConfig'] })
) {
  const aiConfig = enterprise?.aiConfig;
  if (!aiConfig) {
    return undefined;
  }

  return {
    provider: aiConfig.provider,
    keyMode: aiConfig.keyMode,
    pollinationsKeyRef: aiConfig.pollinationsKeyRef || '',
    pollinationsKeyName: aiConfig.pollinationsKeyName || '',
    pollinationsMaskedKey: aiConfig.pollinationsMaskedKey || '',
    allowedModels: aiConfig.allowedModels || [],
    pollenBudget:
      typeof aiConfig.pollenBudget === 'number' ? aiConfig.pollenBudget : aiConfig.pollenBudget ?? null,
    status: aiConfig.status || 'disabled',
    lastSyncedAt: aiConfig.lastSyncedAt || null,
  };
}

export async function getEnterprisePollinationsRuntimeConfig(enterpriseId: string) {
  const enterprise = await Enterprise.findById(enterpriseId).select('aiConfig');
  const aiConfig = getAiConfig(enterprise);

  if (!aiConfig) {
    throw new Error('当前企业尚未配置 Pollinations 子 Key');
  }

  if (aiConfig.provider !== 'pollinations') {
    throw new Error('当前企业未启用 Pollinations 提供方');
  }

  if (aiConfig.status !== 'active') {
    throw new Error('当前企业 AI Key 未启用');
  }

  const apiKey = decryptText(aiConfig.pollinationsKeyEncrypted);
  if (!apiKey) {
    throw new Error('当前企业缺少可用的 Pollinations Key');
  }

  return {
    enterpriseId,
    keyId: aiConfig.pollinationsKeyRef,
    keyName: aiConfig.pollinationsKeyName,
    apiKey,
    maskedKey: aiConfig.pollinationsMaskedKey || maskSecret(apiKey),
    allowedModels: aiConfig.allowedModels || [],
    pollenBudget:
      typeof aiConfig.pollenBudget === 'number' ? aiConfig.pollenBudget : aiConfig.pollenBudget ?? null,
    status: aiConfig.status,
  } as EnterprisePollinationsRuntimeConfig;
}

export async function syncEnterprisePollinationsSnapshot(enterpriseId: string, days = 30) {
  const enterprise = await Enterprise.findById(enterpriseId).select('name aiConfig');
  if (!enterprise) {
    throw new Error('Enterprise not found');
  }

  const runtime = await getEnterprisePollinationsRuntimeConfig(String(enterprise._id));
  const [balanceState, keyState, dailyUsageState] = await Promise.all([
    getPollinationsBalance(runtime.apiKey),
    getPollinationsKeyState(runtime.apiKey),
    getPollinationsDailyUsage(runtime.apiKey, days),
  ]);

  const snapshot = await EnterpriseAiUsageSnapshot.findOneAndUpdate(
    { enterpriseId: enterprise._id },
    {
      $set: {
        balance: Number(balanceState.balance || 0),
        currency: balanceState.currency || 'USD',
        dailyUsage: normalizeUsage(dailyUsageState.items),
        keyInfo: {
          keyId: keyState.id || runtime.keyId,
          keyName: keyState.name || runtime.keyName,
          maskedKey: keyState.maskedKey || runtime.maskedKey,
          status: keyState.status || runtime.status,
          allowedModels: keyState.allowedModels?.length ? keyState.allowedModels : runtime.allowedModels,
          pollenBudget:
            typeof keyState.pollenBudget === 'number'
              ? keyState.pollenBudget
              : runtime.pollenBudget,
        },
        lastSyncedAt: new Date(),
        syncError: '',
      },
    },
    { upsert: true, new: true }
  );

  await Enterprise.findByIdAndUpdate(enterprise._id, {
    $set: {
      'aiConfig.lastSyncedAt': snapshot.lastSyncedAt,
      'aiConfig.status': keyState.status === 'revoked' ? 'revoked' : runtime.status,
      'aiConfig.allowedModels':
        keyState.allowedModels?.length ? keyState.allowedModels : runtime.allowedModels,
      'aiConfig.pollenBudget':
        typeof keyState.pollenBudget === 'number' ? keyState.pollenBudget : runtime.pollenBudget,
      'aiConfig.pollinationsKeyName': keyState.name || runtime.keyName || '',
      'aiConfig.pollinationsMaskedKey': keyState.maskedKey || runtime.maskedKey,
      'aiConfig.pollinationsKeyRef': keyState.id || runtime.keyId || '',
    },
  });

  return snapshot;
}

export async function markEnterpriseAiSyncError(enterpriseId: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown sync error';

  await EnterpriseAiUsageSnapshot.findOneAndUpdate(
    { enterpriseId },
    {
      $set: {
        syncError: message,
      },
    },
    { upsert: true, new: true }
  );

  return message;
}

export async function upsertEnterpriseManagedPollinationsKey(options: {
  enterpriseId: string;
  allowedModels?: string[];
  pollenBudget?: number | null;
  rotate?: boolean;
}) {
  const enterprise = await Enterprise.findById(options.enterpriseId).select('name aiConfig');
  if (!enterprise) {
    throw new Error('Enterprise not found');
  }

  const existingConfig = getAiConfig(enterprise);
  if (existingConfig?.pollinationsKeyRef) {
    try {
      await revokeManagedPollinationsKey(existingConfig.pollinationsKeyRef);
    } catch (error) {
      console.error('[Enterprise Pollinations Rotate] Failed to revoke existing key', error);
    }
  }

  const created = await createManagedPollinationsKey({
    name: `${enterprise.name}-ai`,
    allowedModels: options.allowedModels,
    pollenBudget: options.pollenBudget ?? null,
  });

  if (!created.secret) {
    throw new Error('Pollinations 未返回新建子 Key 的 secret');
  }

  const maskedKey = created.key.maskedKey || maskSecret(created.secret);

  await Enterprise.findByIdAndUpdate(enterprise._id, {
    $set: {
      aiConfig: {
        provider: 'pollinations',
        keyMode: 'managed_child_key',
        pollinationsKeyRef: created.key.id || '',
        pollinationsKeyName: created.key.name || `${enterprise.name}-ai`,
        pollinationsKeyEncrypted: encryptText(created.secret),
        pollinationsMaskedKey: maskedKey,
        allowedModels: created.key.allowedModels?.length
          ? created.key.allowedModels
          : options.allowedModels || [],
        pollenBudget:
          typeof created.key.pollenBudget === 'number'
            ? created.key.pollenBudget
            : options.pollenBudget ?? null,
        status: (created.key.status as EnterpriseAiStatus | undefined) || 'active',
        lastSyncedAt: null,
      },
    },
  });

  const snapshot = await syncEnterprisePollinationsSnapshot(String(enterprise._id));

  return {
    secret: created.secret,
    maskedKey,
    keyInfo: snapshot.keyInfo,
    snapshot,
  };
}

export async function updateEnterpriseAiConfig(options: {
  enterpriseId: string;
  allowedModels?: string[];
  pollenBudget?: number | null;
  status?: EnterpriseAiStatus;
}) {
  const enterprise = await Enterprise.findById(options.enterpriseId).select('aiConfig');
  if (!enterprise?.aiConfig) {
    throw new Error('当前企业尚未配置 Pollinations 子 Key');
  }

  const nextAllowedModels = options.allowedModels ?? enterprise.aiConfig.allowedModels ?? [];
  const nextBudget =
    options.pollenBudget !== undefined ? options.pollenBudget : enterprise.aiConfig.pollenBudget ?? null;
  const nextStatus = options.status || enterprise.aiConfig.status || 'active';

  await Enterprise.findByIdAndUpdate(enterprise._id, {
    $set: {
      'aiConfig.allowedModels': nextAllowedModels,
      'aiConfig.pollenBudget': nextBudget,
      'aiConfig.status': nextStatus,
    },
  });

  const snapshot = await EnterpriseAiUsageSnapshot.findOneAndUpdate(
    { enterpriseId: enterprise._id },
    {
      $set: {
        'keyInfo.allowedModels': nextAllowedModels,
        'keyInfo.pollenBudget': nextBudget,
        'keyInfo.status': nextStatus,
      },
    },
    { upsert: true, new: true }
  );

  return snapshot;
}

export async function revokeEnterpriseManagedPollinationsKey(enterpriseId: string) {
  const enterprise = await Enterprise.findById(enterpriseId).select('aiConfig');
  if (!enterprise?.aiConfig) {
    throw new Error('当前企业尚未配置 Pollinations 子 Key');
  }

  if (enterprise.aiConfig.pollinationsKeyRef) {
    await revokeManagedPollinationsKey(enterprise.aiConfig.pollinationsKeyRef);
  }

  await Enterprise.findByIdAndUpdate(enterprise._id, {
    $set: {
      'aiConfig.status': 'revoked',
      'aiConfig.lastSyncedAt': new Date(),
    },
  });

  await EnterpriseAiUsageSnapshot.findOneAndUpdate(
    { enterpriseId },
    {
      $set: {
        'keyInfo.status': 'revoked',
        lastSyncedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

export function summarizeDailyUsage(items: IEnterpriseAiUsageDaily[] = []) {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
  const todayItems = sorted.filter((item) => item.date === today);
  const recent7Days = Array.from(
    sorted.reduce((map, item) => {
      const current = map.get(item.date) || { date: item.date, requests: 0, costUsd: 0 };
      current.requests += Number(item.requests || 0);
      current.costUsd += Number(item.costUsd || 0);
      map.set(item.date, current);
      return map;
    }, new Map<string, { date: string; requests: number; costUsd: number }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  return {
    today: {
      requests: todayItems.reduce((sum, item) => sum + Number(item.requests || 0), 0),
      costUsd: todayItems.reduce((sum, item) => sum + Number(item.costUsd || 0), 0),
    },
    recent7Days,
  };
}
