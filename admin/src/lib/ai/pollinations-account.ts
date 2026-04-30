const POLLINATIONS_ACCOUNT_BASE_URL =
  process.env.POLLINATIONS_ACCOUNT_BASE_URL ||
  process.env.POLLINATIONS_BASE_URL ||
  'https://gen.pollinations.ai';

export interface PollinationsManagedKeyInput {
  name: string;
  allowedModels?: string[];
  pollenBudget?: number | null;
}

export interface PollinationsKeyState {
  id?: string;
  name?: string;
  status?: string;
  allowedModels: string[];
  pollenBudget: number | null;
  maskedKey?: string;
  raw?: unknown;
}

export interface PollinationsBalanceState {
  balance: number;
  currency: string;
  raw?: unknown;
}

export interface PollinationsDailyUsageItem {
  date: string;
  model: string;
  requests: number;
  costUsd: number;
  meterSource?: string;
}

export interface PollinationsUsageState {
  items: PollinationsDailyUsageItem[];
  raw?: unknown;
}

function getMasterApiKey() {
  const apiKey =
    process.env.POLLINATIONS_ACCOUNT_API_KEY?.trim() ||
    process.env.POLLINATIONS_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      'Pollinations account authentication is not configured. Set POLLINATIONS_ACCOUNT_API_KEY.'
    );
  }

  return apiKey;
}

function buildHeaders(apiKey: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    ...extra,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toStringValue(value: unknown, fallback?: string) {
  return typeof value === 'string' ? value : fallback;
}

function toNumber(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function pickArray(source: Record<string, unknown>, candidateKeys: string[]) {
  for (const key of candidateKeys) {
    if (Array.isArray(source[key])) {
      return source[key] as unknown[];
    }
  }

  return [];
}

async function parseJson(response: Response) {
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { rawText: text };
    }
  }

  if (!response.ok) {
    const record = asRecord(payload);
    const errorRecord = asRecord(record.error);
    const message =
      toStringValue(errorRecord.message) ||
      toStringValue(record.error) ||
      toStringValue(record.message) ||
      `Pollinations request failed (${response.status})`;
    const error = new Error(message);
    (error as Error & { status?: number; payload?: unknown }).status = response.status;
    (error as Error & { status?: number; payload?: unknown }).payload = payload;
    throw error;
  }

  return asRecord(payload);
}

function normalizeKeyState(payload: Record<string, unknown>): PollinationsKeyState {
  const source = asRecord(payload.data || payload.key || payload);

  return {
    id: toStringValue(source.id || source.keyId || source.key_id || source.ref),
    name: toStringValue(source.name || source.keyName || source.key_name),
    status: toStringValue(source.status || source.state, 'active'),
    allowedModels: toStringArray(
      source.allowedModels ||
        source.allowed_models ||
        source.models ||
        source.model_whitelist
    ),
    pollenBudget:
      source.pollenBudget !== undefined
        ? toNumber(source.pollenBudget)
        : source.pollen_budget !== undefined
          ? toNumber(source.pollen_budget)
          : source.budget !== undefined
            ? toNumber(source.budget)
            : source.limit !== undefined
              ? toNumber(source.limit)
              : null,
    maskedKey: toStringValue(source.maskedKey || source.masked_key || source.preview),
    raw: payload,
  };
}

function normalizeBalance(payload: Record<string, unknown>): PollinationsBalanceState {
  const source = asRecord(payload.data || payload);

  return {
    balance: toNumber(
      source.balance ??
        source.remaining_balance ??
        source.remaining ??
        source.credits ??
        source.pollen ??
        0
    ),
    currency: toStringValue(source.currency, 'USD') || 'USD',
    raw: payload,
  };
}

function normalizeDailyUsage(payload: Record<string, unknown>): PollinationsUsageState {
  const source = asRecord(payload.data || payload);
  const items = pickArray(source, ['items', 'usage', 'daily', 'results', 'data']);

  const normalized = items
    .map((item) => {
      const row = asRecord(item);
      return {
        date:
          toStringValue(row.date || row.day || row.bucket) ||
          new Date(String(row.createdAt || row.timestamp || Date.now()))
            .toISOString()
            .slice(0, 10),
        model:
          toStringValue(row.model || row.modelName || row.model_name, 'unknown') || 'unknown',
        requests: toNumber(row.requests ?? row.requestCount ?? row.count),
        costUsd: toNumber(row.costUsd ?? row.cost_usd ?? row.cost ?? row.spend),
        meterSource: toStringValue(row.meterSource || row.meter_source || row.source),
      };
    })
    .filter((item) => item.date);

  return { items: normalized, raw: payload };
}

export async function createManagedPollinationsKey(input: PollinationsManagedKeyInput) {
  const response = await fetch(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/keys`, {
    method: 'POST',
    headers: buildHeaders(getMasterApiKey(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: input.name,
      allowedModels: input.allowedModels,
      pollenBudget: input.pollenBudget,
    }),
  });

  const payload = await parseJson(response);
  const data = asRecord(payload.data);
  const keyState = normalizeKeyState(payload);
  const secret =
    toStringValue(payload.secret) ||
    toStringValue(payload.key) ||
    toStringValue(payload.apiKey) ||
    toStringValue(data.secret) ||
    toStringValue(data.key) ||
    toStringValue(data.apiKey) ||
    '';

  return {
    key: keyState,
    secret,
    raw: payload,
  };
}

export async function revokeManagedPollinationsKey(keyId: string) {
  const response = await fetch(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/keys/${keyId}`, {
    method: 'DELETE',
    headers: buildHeaders(getMasterApiKey()),
  });

  const payload = await parseJson(response);
  return { success: true, raw: payload };
}

export async function getPollinationsKeyState(apiKey: string) {
  const response = await fetch(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/key`, {
    headers: buildHeaders(apiKey),
  });

  return normalizeKeyState(await parseJson(response));
}

export async function getPollinationsBalance(apiKey: string) {
  const response = await fetch(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/balance`, {
    headers: buildHeaders(apiKey),
  });

  return normalizeBalance(await parseJson(response));
}

export async function getPollinationsDailyUsage(apiKey: string, days = 30) {
  const url = new URL(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/usage/daily`);
  url.searchParams.set('days', String(days));

  const response = await fetch(url.toString(), {
    headers: buildHeaders(apiKey),
  });

  return normalizeDailyUsage(await parseJson(response));
}

export async function getPollinationsUsage(apiKey: string, days = 30) {
  const url = new URL(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/usage`);
  url.searchParams.set('days', String(days));

  const response = await fetch(url.toString(), {
    headers: buildHeaders(apiKey),
  });

  return parseJson(response);
}
