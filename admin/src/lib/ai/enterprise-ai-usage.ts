import type { EnterpriseAiUsageSnapshotRecord } from '@/db/repositories';

export type EnterpriseAiUsageDaily = {
  date: string;
  model: string;
  requests: number;
  costUsd: number;
  meterSource?: string;
};

type EnterpriseAiUsageSnapshotDto = {
  _id: string;
  enterpriseId: string;
  balance: number;
  currency: string;
  dailyUsage: EnterpriseAiUsageDaily[];
  keyInfo: Record<string, unknown> | null;
  lastSyncedAt: Date | null;
  syncError: string;
  createdAt: Date;
  updatedAt: Date;
};

function asFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeEnterpriseAiDailyUsage(value: unknown): EnterpriseAiUsageDaily[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const date = typeof row.date === 'string' ? row.date : '';
    if (!date) return [];
    return [{
      date,
      model: typeof row.model === 'string' && row.model ? row.model : 'unknown',
      requests: Math.max(0, Math.trunc(asFiniteNumber(row.requests))),
      costUsd: asFiniteNumber(row.costUsd),
      ...(typeof row.meterSource === 'string' && row.meterSource
        ? { meterSource: row.meterSource }
        : {}),
    }];
  });
}

export function serializeEnterpriseAiUsageSnapshot(
  snapshot: EnterpriseAiUsageSnapshotRecord | null
): EnterpriseAiUsageSnapshotDto | null {
  if (!snapshot) return null;
  return {
    _id: snapshot.id.toString(),
    enterpriseId: snapshot.enterpriseId.toString(),
    balance: asFiniteNumber(snapshot.balance),
    currency: snapshot.currency,
    dailyUsage: normalizeEnterpriseAiDailyUsage(snapshot.dailyUsage),
    keyInfo: snapshot.keyInfo ?? null,
    lastSyncedAt: snapshot.lastSyncedAt,
    syncError: snapshot.syncError ?? '',
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

export function summarizeEnterpriseAiDailyUsage(items: EnterpriseAiUsageDaily[] = []) {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
  const todayItems = sorted.filter((item) => item.date === today);
  const recent7Days = Array.from(
    sorted.reduce((map, item) => {
      const current = map.get(item.date) || { date: item.date, requests: 0, costUsd: 0 };
      current.requests += item.requests;
      current.costUsd += item.costUsd;
      map.set(item.date, current);
      return map;
    }, new Map<string, { date: string; requests: number; costUsd: number }>())
  )
    .map(([, item]) => item)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  return {
    today: {
      requests: todayItems.reduce((sum, item) => sum + item.requests, 0),
      costUsd: todayItems.reduce((sum, item) => sum + item.costUsd, 0),
    },
    recent7Days,
  };
}
