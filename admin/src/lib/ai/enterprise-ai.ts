import { Enterprise, IEnterprise } from '@/models/Enterprise';
import {
  EnterpriseAiUsageSnapshot,
  IEnterpriseAiUsageDaily,
} from '@/models/EnterpriseAiUsageSnapshot';
import { decryptText, encryptText, maskSecret } from '@/lib/crypto';
import {
  createManagedPollinationsKey,
  getPollinationsBalance,
  getPollinationsKeyState,
  getPollinationsKeyUsage,
  PollinationsKeyState,
  PollinationsKeyUsageItem,
  revokeManagedPollinationsKey,
} from './pollinations-account';

const DEFAULT_ENTERPRISE_CHILD_KEY_BUDGET = Number(
  process.env.POLLINATIONS_DEFAULT_CHILD_KEY_BUDGET || 100
);

export interface EnterprisePollinationsRuntimeConfig {
  enterpriseId: string;
  keyId?: string;
  keyName?: string;
  apiKey: string;
  maskedKey: string;
  allowedModels: string[];
  accountPermissions: string[];
  pollenBudget: number | null;
}

type EnterpriseAiSyncSnapshotSeed = {
  balance: number;
  currency: string;
  dailyUsage: IEnterpriseAiUsageDaily[];
  keyInfo: {
    keyId?: string;
    keyName?: string;
    maskedKey?: string;
    valid?: boolean;
    allowedModels?: string[];
    pollenBudget?: number | null;
  };
  syncError: string;
};

function normalizeKeyUsageRows(items: PollinationsKeyUsageItem[]) {
  const usageMap = new Map<string, IEnterpriseAiUsageDaily>();

  for (const item of items) {
    const timestamp = item.timestamp || new Date().toISOString();
    const normalizedDate = timestamp.includes(' ')
      ? timestamp.slice(0, 10)
      : new Date(timestamp).toISOString().slice(0, 10);
    const model = item.model || 'unknown';
    const key = `${normalizedDate}::${model}`;
    const current = usageMap.get(key) || {
      date: normalizedDate,
      model,
      requests: 0,
      costUsd: 0,
      meterSource: item.meterSource || '',
    };

    current.requests += 1;
    current.costUsd += Number(item.costUsd || 0);
    current.meterSource = current.meterSource || item.meterSource || '';
    usageMap.set(key, current);
  }

  return Array.from(usageMap.values()).sort((a, b) =>
    a.date === b.date ? a.model.localeCompare(b.model) : a.date.localeCompare(b.date)
  );
}

function getAiConfig(enterprise: IEnterprise | null | undefined) {
  return enterprise?.aiConfig;
}

function getErrorStatus(error: unknown) {
  return error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : undefined;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function hasOwnBudget(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value);
}

function deriveManagedKeyState(input: {
  keyId?: string | null;
  keyValid?: boolean | null;
}) {
  if (!input.keyId) {
    return 'unconfigured';
  }

  if (input.keyValid === false) {
    return 'invalid';
  }

  return 'configured';
}

function buildSnapshotSeed(
  runtime: EnterprisePollinationsRuntimeConfig,
  previous?: Partial<EnterpriseAiSyncSnapshotSeed> | null
): EnterpriseAiSyncSnapshotSeed {
  return {
    balance: Number(previous?.balance ?? 0),
    currency: previous?.currency || 'USD',
    dailyUsage: previous?.dailyUsage || [],
    keyInfo: {
      keyId: runtime.keyId || previous?.keyInfo?.keyId || '',
      keyName: runtime.keyName || previous?.keyInfo?.keyName || '',
      maskedKey: runtime.maskedKey || previous?.keyInfo?.maskedKey || '',
      valid: previous?.keyInfo?.valid,
      allowedModels: runtime.allowedModels?.length
        ? runtime.allowedModels
        : previous?.keyInfo?.allowedModels || [],
      pollenBudget:
        typeof runtime.pollenBudget === 'number'
          ? runtime.pollenBudget
          : previous?.keyInfo?.pollenBudget ?? null,
    },
    syncError: previous?.syncError || '',
  };
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
      typeof aiConfig.pollenBudget === 'number'
        ? aiConfig.pollenBudget
        : aiConfig.pollenBudget ?? null,
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
    accountPermissions: [],
    pollenBudget:
      typeof aiConfig.pollenBudget === 'number'
        ? aiConfig.pollenBudget
        : aiConfig.pollenBudget ?? null,
  } as EnterprisePollinationsRuntimeConfig;
}

export async function syncEnterprisePollinationsSnapshot(enterpriseId: string, days = 30) {
  const enterprise = await Enterprise.findById(enterpriseId).select('name aiConfig');
  if (!enterprise) {
    throw new Error('Enterprise not found');
  }

  const runtime = await getEnterprisePollinationsRuntimeConfig(String(enterprise._id));
  const previousSnapshot = await EnterpriseAiUsageSnapshot.findOne({
    enterpriseId: enterprise._id,
  }).lean();
  const nextSnapshot = buildSnapshotSeed(runtime, previousSnapshot);
  const syncMessages: string[] = [];

  const [keyStateResult, dailyUsageResult] = await Promise.allSettled([
    getPollinationsKeyState(runtime.apiKey),
    getPollinationsKeyUsage(runtime.apiKey, days),
  ]);

  let shouldReadBalance = hasOwnBudget(runtime.pollenBudget);

  if (keyStateResult.status === 'fulfilled') {
    runtime.accountPermissions = keyStateResult.value.accountPermissions || [];
    runtime.pollenBudget =
      typeof keyStateResult.value.pollenBudget === 'number'
        ? keyStateResult.value.pollenBudget
        : runtime.pollenBudget;
    shouldReadBalance =
      hasOwnBudget(keyStateResult.value.pollenBudget) ||
      keyStateResult.value.accountPermissions.includes('usage');

    nextSnapshot.keyInfo = {
      keyId: keyStateResult.value.id || nextSnapshot.keyInfo.keyId,
      keyName: keyStateResult.value.name || nextSnapshot.keyInfo.keyName,
      maskedKey: keyStateResult.value.maskedKey || nextSnapshot.keyInfo.maskedKey,
      valid:
        typeof keyStateResult.value.valid === 'boolean'
          ? keyStateResult.value.valid
          : nextSnapshot.keyInfo.valid,
      allowedModels: keyStateResult.value.allowedModels?.length
        ? keyStateResult.value.allowedModels
        : nextSnapshot.keyInfo.allowedModels,
      pollenBudget:
        typeof keyStateResult.value.pollenBudget === 'number'
          ? keyStateResult.value.pollenBudget
          : nextSnapshot.keyInfo.pollenBudget,
    };

    if (!shouldReadBalance) {
      syncMessages.push(
        '当前 Key 没有独立预算，也没有 account:usage 权限，因此无法读取余额。'
      );
    }
  } else {
    syncMessages.push(
      getErrorMessage(keyStateResult.reason, 'Failed to sync Pollinations key state.')
    );
  }

  if (shouldReadBalance) {
    const balanceResult = await getPollinationsBalance(runtime.apiKey)
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => ({ ok: false as const, error }));

    if (balanceResult.ok) {
      nextSnapshot.balance = Number(balanceResult.value.balance || 0);
      nextSnapshot.currency = balanceResult.value.currency || 'USD';
    } else if (
      getErrorStatus(balanceResult.error) === 403 &&
      getErrorMessage(balanceResult.error, '').includes('no budget of its own')
    ) {
      syncMessages.push(
        '当前 Key 没有独立预算，也没有 account:usage 权限，因此无法读取余额。'
      );
    } else {
      syncMessages.push(
        getErrorMessage(balanceResult.error, 'Failed to sync Pollinations balance.')
      );
    }
  }

  if (dailyUsageResult.status === 'fulfilled') {
    nextSnapshot.dailyUsage = normalizeKeyUsageRows(dailyUsageResult.value.items);
    if (dailyUsageResult.value.count >= 50000) {
      syncMessages.push('Pollinations usage snapshot may be truncated at 50,000 rows.');
    }
  } else {
    syncMessages.push(
      getErrorMessage(dailyUsageResult.reason, 'Failed to sync Pollinations usage.')
    );
  }

  const snapshot = await EnterpriseAiUsageSnapshot.findOneAndUpdate(
    { enterpriseId: enterprise._id },
    {
      $set: {
        balance: nextSnapshot.balance,
        currency: nextSnapshot.currency,
        dailyUsage: nextSnapshot.dailyUsage,
        keyInfo: nextSnapshot.keyInfo,
        lastSyncedAt: new Date(),
        syncError: syncMessages.join(' '),
      },
    },
    { upsert: true, new: true }
  );

  await Enterprise.findByIdAndUpdate(enterprise._id, {
    $set: {
      'aiConfig.lastSyncedAt': snapshot.lastSyncedAt,
      'aiConfig.allowedModels': nextSnapshot.keyInfo.allowedModels || runtime.allowedModels,
      'aiConfig.pollenBudget':
        typeof nextSnapshot.keyInfo.pollenBudget === 'number'
          ? nextSnapshot.keyInfo.pollenBudget
          : runtime.pollenBudget,
      'aiConfig.pollinationsKeyName': nextSnapshot.keyInfo.keyName || runtime.keyName || '',
      'aiConfig.pollinationsMaskedKey': nextSnapshot.keyInfo.maskedKey || runtime.maskedKey,
      'aiConfig.pollinationsKeyRef': nextSnapshot.keyInfo.keyId || runtime.keyId || '',
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
  if (existingConfig?.pollinationsKeyRef && !options.rotate) {
    const error = new Error('该企业已存在子 Key，请使用轮换 Key。') as Error & {
      status?: number;
    };
    error.status = 409;
    throw error;
  }

  if (existingConfig?.pollinationsKeyRef && options.rotate) {
    try {
      await revokeManagedPollinationsKey(existingConfig.pollinationsKeyRef);
    } catch (error) {
      console.error('[Enterprise Pollinations Rotate] Failed to revoke existing key', error);
    }
  }

  const nextPollenBudget = options.pollenBudget ?? DEFAULT_ENTERPRISE_CHILD_KEY_BUDGET;
  const created = await createManagedPollinationsKey({
    name: `${enterprise.name}-ai`,
    allowedModels: options.allowedModels,
    pollenBudget: nextPollenBudget,
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
            : nextPollenBudget,
        lastSyncedAt: null,
      },
    },
  });

  const snapshot =
    (await syncEnterprisePollinationsSnapshot(String(enterprise._id)).catch(async (error) => {
      const message = await markEnterpriseAiSyncError(String(enterprise._id), error);
      return EnterpriseAiUsageSnapshot.findOneAndUpdate(
        { enterpriseId: enterprise._id },
        {
          $set: {
            keyInfo: {
              keyId: created.key.id || '',
              keyName: created.key.name || `${enterprise.name}-ai`,
              maskedKey,
              valid: typeof created.key.valid === 'boolean' ? created.key.valid : true,
              allowedModels: created.key.allowedModels?.length
                ? created.key.allowedModels
                : options.allowedModels || [],
              pollenBudget:
                typeof created.key.pollenBudget === 'number'
                  ? created.key.pollenBudget
                  : nextPollenBudget,
            },
            syncError: message,
          },
        },
        { upsert: true, new: true }
      );
    }))!;

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
}) {
  const enterprise = await Enterprise.findById(options.enterpriseId).select('aiConfig');
  if (!enterprise?.aiConfig) {
    throw new Error('当前企业尚未配置 Pollinations 子 Key');
  }

  const nextAllowedModels = options.allowedModels ?? enterprise.aiConfig.allowedModels ?? [];
  const nextBudget =
    options.pollenBudget !== undefined ? options.pollenBudget : enterprise.aiConfig.pollenBudget ?? null;

  await Enterprise.findByIdAndUpdate(enterprise._id, {
    $set: {
      'aiConfig.allowedModels': nextAllowedModels,
      'aiConfig.pollenBudget': nextBudget,
    },
  });

  const snapshot = await EnterpriseAiUsageSnapshot.findOneAndUpdate(
    { enterpriseId: enterprise._id },
    {
      $set: {
        'keyInfo.allowedModels': nextAllowedModels,
        'keyInfo.pollenBudget': nextBudget,
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
      'aiConfig.pollinationsKeyRef': '',
      'aiConfig.pollinationsKeyName': '',
      'aiConfig.pollinationsKeyEncrypted': '',
      'aiConfig.pollinationsMaskedKey': '',
      'aiConfig.lastSyncedAt': new Date(),
    },
  });

  await EnterpriseAiUsageSnapshot.findOneAndUpdate(
    { enterpriseId },
    {
      $set: {
        'keyInfo.keyId': '',
        'keyInfo.keyName': '',
        'keyInfo.maskedKey': '',
        'keyInfo.valid': undefined,
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

export function deriveEnterpriseKeyStatus(input: {
  aiConfig?: { pollinationsKeyRef?: string | null };
  keyInfo?: Pick<PollinationsKeyState, 'id' | 'valid'> | null;
}) {
  return deriveManagedKeyState({
    keyId: input.keyInfo?.id || input.aiConfig?.pollinationsKeyRef || '',
    keyValid: input.keyInfo?.valid,
  });
}
