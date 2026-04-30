const POLLINATIONS_ACCOUNT_BASE_URL =
  process.env.POLLINATIONS_ACCOUNT_BASE_URL ||
  process.env.POLLINATIONS_BASE_URL ||
  'https://gen.pollinations.ai';

const POLLINATIONS_REQUEST_TIMEOUT_MS = Number(
  process.env.POLLINATIONS_REQUEST_TIMEOUT_MS || 15000
);
const POLLINATIONS_MAX_RETRIES = Number(process.env.POLLINATIONS_REQUEST_RETRIES || 2);

export interface PollinationsManagedKeyInput {
  name: string;
  allowedModels?: string[];
  pollenBudget?: number | null;
  accountPermissions?: string[];
}

export interface PollinationsKeyState {
  id?: string;
  name?: string;
  status?: string;
  valid?: boolean;
  keyType?: string;
  allowedModels: string[];
  accountPermissions: string[];
  pollenBudget: number | null;
  rateLimitEnabled?: boolean;
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

export interface PollinationsKeyUsageItem {
  timestamp: string;
  type: string;
  model: string | null;
  apiKey: string | null;
  apiKeyType: string | null;
  meterSource: string | null;
  inputTextTokens: number;
  inputCachedTokens: number;
  inputAudioTokens: number;
  inputImageTokens: number;
  outputTextTokens: number;
  outputReasoningTokens: number;
  outputAudioTokens: number;
  outputImageTokens: number;
  costUsd: number;
  responseTimeMs: number | null;
}

export interface PollinationsKeyUsageState {
  items: PollinationsKeyUsageItem[];
  count: number;
  raw?: unknown;
}

type PollinationsRequestError = Error & {
  status?: number;
  payload?: unknown;
  code?: string;
  cause?: unknown;
};

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryableNetworkError(error: unknown) {
  const code = getErrorCode(error);
  return Boolean(
    isTimeoutError(error) ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'EAI_AGAIN'
  );
}

function isRetryableResponseStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function normalizeRequestError(error: unknown, url: string): PollinationsRequestError {
  if (error instanceof Error) {
    const normalized = error as PollinationsRequestError;
    const causeCode = getErrorCode(normalized.cause);

    if (!normalized.code && causeCode) {
      normalized.code = causeCode;
    }

    if (isTimeoutError(normalized) && !normalized.status) {
      normalized.status = 504;
      normalized.message = `Pollinations request timed out after ${POLLINATIONS_REQUEST_TIMEOUT_MS}ms`;
    } else if (
      (normalized.message === 'fetch failed' || normalized.message.includes('fetch failed')) &&
      !normalized.status
    ) {
      normalized.status = 502;
      normalized.message = `Pollinations upstream request failed for ${url}`;
    }

    return normalized;
  }

  const fallback = new Error(`Pollinations request failed for ${url}`) as PollinationsRequestError;
  fallback.status = 502;
  return fallback;
}

async function pollinationsFetch(url: string, init?: RequestInit) {
  let lastError: PollinationsRequestError | null = null;

  for (let attempt = 0; attempt <= POLLINATIONS_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POLLINATIONS_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (isRetryableResponseStatus(response.status) && attempt < POLLINATIONS_MAX_RETRIES) {
        const transientError = new Error(
          `Pollinations upstream returned ${response.status}`
        ) as PollinationsRequestError;
        transientError.status = response.status;
        lastError = transientError;
        await sleep(300 * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      const normalized = normalizeRequestError(error, url);
      lastError = normalized;

      if (!isRetryableNetworkError(normalized) || attempt >= POLLINATIONS_MAX_RETRIES) {
        throw normalized;
      }

      await sleep(300 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || normalizeRequestError(new Error('fetch failed'), url);
}

function normalizeKeyState(payload: Record<string, unknown>): PollinationsKeyState {
  const source = asRecord(payload.data || payload.key || payload);
  const permissions = asRecord(source.permissions);

  return {
    id: toStringValue(source.id || source.keyId || source.key_id || source.ref),
    name: toStringValue(source.name || source.keyName || source.key_name),
    valid: typeof source.valid === 'boolean' ? source.valid : undefined,
    keyType: toStringValue(source.type || source.keyType || source.key_type),
    status: toStringValue(source.status || source.state, 'active'),
    allowedModels: toStringArray(
      permissions.models ||
        source.allowedModels ||
        source.allowed_models ||
        source.models ||
        source.model_whitelist
    ),
    accountPermissions: toStringArray(
      permissions.account || source.accountPermissions || source.account_permissions
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
    rateLimitEnabled:
      typeof source.rateLimitEnabled === 'boolean'
        ? source.rateLimitEnabled
        : typeof source.rate_limit_enabled === 'boolean'
          ? source.rate_limit_enabled
          : undefined,
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

function normalizeKeyUsage(payload: Record<string, unknown>): PollinationsKeyUsageState {
  const source = asRecord(payload.data || payload);
  const items = pickArray(source, ['usage', 'items', 'results', 'data']);

  const normalized = items.map((item) => {
    const row = asRecord(item);
      return {
        timestamp:
          toStringValue(row.timestamp || row.createdAt || row.created_at, new Date().toISOString()) ||
          new Date().toISOString(),
        type: toStringValue(row.type, 'unknown') || 'unknown',
        model: toStringValue(row.model) ?? null,
        apiKey: toStringValue(row.api_key || row.apiKey) ?? null,
        apiKeyType: toStringValue(row.api_key_type || row.apiKeyType) ?? null,
        meterSource: toStringValue(row.meter_source || row.meterSource) ?? null,
        inputTextTokens: toNumber(row.input_text_tokens ?? row.inputTextTokens),
      inputCachedTokens: toNumber(row.input_cached_tokens ?? row.inputCachedTokens),
      inputAudioTokens: toNumber(row.input_audio_tokens ?? row.inputAudioTokens),
      inputImageTokens: toNumber(row.input_image_tokens ?? row.inputImageTokens),
      outputTextTokens: toNumber(row.output_text_tokens ?? row.outputTextTokens),
      outputReasoningTokens: toNumber(
        row.output_reasoning_tokens ?? row.outputReasoningTokens
      ),
      outputAudioTokens: toNumber(row.output_audio_tokens ?? row.outputAudioTokens),
      outputImageTokens: toNumber(row.output_image_tokens ?? row.outputImageTokens),
      costUsd: toNumber(row.cost_usd ?? row.costUsd),
      responseTimeMs:
        row.response_time_ms !== undefined || row.responseTimeMs !== undefined
          ? toNumber(row.response_time_ms ?? row.responseTimeMs)
          : null,
    };
  });

  return {
    items: normalized,
    count: toNumber(source.count ?? normalized.length, normalized.length),
    raw: payload,
  };
}

export async function createManagedPollinationsKey(input: PollinationsManagedKeyInput) {
  const response = await pollinationsFetch(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/keys`, {
    method: 'POST',
    headers: buildHeaders(getMasterApiKey(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: input.name,
      allowedModels: input.allowedModels,
      pollenBudget: input.pollenBudget,
      accountPermissions: input.accountPermissions,
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
  const response = await pollinationsFetch(
    `${POLLINATIONS_ACCOUNT_BASE_URL}/account/keys/${keyId}`,
    {
      method: 'DELETE',
      headers: buildHeaders(getMasterApiKey()),
    }
  );

  const payload = await parseJson(response);
  return { success: true, raw: payload };
}

export async function getPollinationsKeyState(apiKey: string) {
  const response = await pollinationsFetch(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/key`, {
    headers: buildHeaders(apiKey),
  });

  return normalizeKeyState(await parseJson(response));
}

export async function getPollinationsBalance(apiKey: string) {
  const response = await pollinationsFetch(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/balance`, {
    headers: buildHeaders(apiKey),
  });

  return normalizeBalance(await parseJson(response));
}

export async function getPollinationsDailyUsage(apiKey: string, days = 30) {
  const url = new URL(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/usage/daily`);
  url.searchParams.set('days', String(days));

  const response = await pollinationsFetch(url.toString(), {
    headers: buildHeaders(apiKey),
  });

  return normalizeDailyUsage(await parseJson(response));
}

export async function getPollinationsUsage(apiKey: string, days = 30) {
  const url = new URL(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/usage`);
  url.searchParams.set('days', String(days));

  const response = await pollinationsFetch(url.toString(), {
    headers: buildHeaders(apiKey),
  });

  return parseJson(response);
}

export async function getPollinationsKeyUsage(apiKey: string, days = 30, limit = 50000) {
  const url = new URL(`${POLLINATIONS_ACCOUNT_BASE_URL}/account/key/usage`);
  url.searchParams.set('days', String(days));
  url.searchParams.set('limit', String(limit));

  const response = await pollinationsFetch(url.toString(), {
    headers: buildHeaders(apiKey),
  });

  return normalizeKeyUsage(await parseJson(response));
}
