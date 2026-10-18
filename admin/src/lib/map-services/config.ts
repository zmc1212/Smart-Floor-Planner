import { sql } from 'drizzle-orm';
import { PlatformConfigRepository } from '@/db/repositories/platform-config-repository';
import { withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { decryptText, encryptText, maskSecret } from '@/lib/crypto';
import { AssistantError, fail, fingerprint } from '@/lib/assistant/contracts';
import { providerConfig, type CommunityProviderConfig } from '@/lib/portfolio/community-provider';
import { MAP_ERRORS, MAP_PROVIDERS, isMapProviderKey, type MapProviderKey, type MapConfigDto, type MapRights } from './contracts';
import { createCommunityProvider } from './providers';

type ProviderSettings = {
  apiKeyEncrypted: string;
  signingKeyEncrypted: string;
  rights: MapRights;
  revision: number;
  lastTest?: { revision: number; ok: boolean; message: string; at: string; elapsedMs: number };
};
type StoredConfig = {
  version: number;
  enabled: boolean;
  activeProvider: string;
  dailyLimit: number;
  providers: Record<string, ProviderSettings>;
  updatedBy?: string;
  updatedAt?: string;
  testWindow?: { since: number; count: number };
  testDay?: { date: string; count: number };
  lastTest?: { version: number; ok: boolean; message: string; at: string; elapsedMs: number };
};
export type MapConfigInput = {
  expectedVersion: number;
  enabled: boolean;
  activeProvider: string;
  providerKey?: string;
  dailyLimit: number;
  apiKey?: string;
  signingKey?: string;
  clearSigningKey?: boolean;
  clearApiKey?: boolean;
  rights?: MapRights;
};
const emptyRights = (): MapRights => ({ commercialConfirmed: false, bindingConfirmed: false, reference: '', validUntil: '' });
const emptyProvider = (): ProviderSettings => ({ apiKeyEncrypted: '', signingKeyEncrypted: '', rights: emptyRights(), revision: 0 });
function defaults(): StoredConfig {
  return { version: 0, enabled: false, activeProvider: 'amap', dailyLimit: 1000, providers: { amap: emptyProvider(), tianditu: emptyProvider() } };
}
function stored(value: Record<string, unknown> | undefined | null): StoredConfig {
  if (!value || !Object.keys(value).length) return defaults();
  const candidate = value as unknown as StoredConfig;
  if (!Number.isSafeInteger(candidate.version) || candidate.version < 1 || !candidate.providers?.amap
    || typeof candidate.enabled !== 'boolean' || !Number.isInteger(candidate.dailyLimit)
    || candidate.dailyLimit < 1 || candidate.dailyLimit > 10000) fail('map_config_unavailable', 503);
  const providers = Object.fromEntries(MAP_PROVIDERS.map(({ key }) => {
    const p = { ...emptyProvider(), ...candidate.providers[key] };
    if (!p.lastTest && key === candidate.activeProvider && candidate.lastTest?.version === candidate.version) p.lastTest = { ...candidate.lastTest, revision: p.revision };
    return [key, p];
  }));
  return { ...candidate, providers };
}
function encryptionReady() {
  if (process.env.NODE_ENV === 'production' && !process.env.AI_PROVIDER_KEY_ENCRYPTION_SECRET?.trim()
    && !process.env.POLLINATIONS_KEY_ENCRYPTION_SECRET?.trim() && !process.env.JWT_SECRET?.trim()) fail('map_encryption_unavailable', 503);
}
function decrypt(value: string) {
  try { encryptionReady(); return decryptText(value); } catch { return fail('map_key_unreadable', 503); }
}
function toRuntime(config: StoredConfig, providerKey = config.activeProvider): CommunityProviderConfig {
  if (!isMapProviderKey(providerKey)) fail('map_provider_not_implemented', 422);
  const p = config.providers[providerKey], rights = p.rights;
  const key = decrypt(p.apiKeyEncrypted), signingKey = decrypt(p.signingKeyEncrypted);
  if (!key) fail('community_provider_unconfigured', 503);
  // Authorization records are optional metadata, never an enablement gate.
  return { key, signingKey, dailyLimit: config.dailyLimit, license: rights.reference, validUntil: rights.validUntil, providerKey, configRevision: config.version };
}
export function mapError(error: unknown) {
  const code = error instanceof AssistantError ? error.code : 'map_config_unavailable';
  return { message: MAP_ERRORS[code] || MAP_ERRORS.map_config_unavailable, status: error instanceof AssistantError ? error.status : 503, code };
}
function dto(config: StoredConfig): MapConfigDto {
  let unavailableReason: string | null = null;
  if (!config.enabled) unavailableReason = MAP_ERRORS.community_provider_disabled;
  else { try { toRuntime(config); } catch (error) { unavailableReason = mapError(error).message; } }
  const masked = (value: string) => { try { return maskSecret(decrypt(value)); } catch { return '凭据不可读'; } };
  const providerConfigs = Object.fromEntries(MAP_PROVIDERS.map(({ key }) => {
    const p = config.providers[key];
    return [key, {
      hasApiKey: Boolean(p.apiKeyEncrypted), hasSigningKey: Boolean(p.signingKeyEncrypted),
      apiKeyMasked: masked(p.apiKeyEncrypted), signingKeyMasked: masked(p.signingKeyEncrypted), rights: { ...p.rights },
      lastTest: p.lastTest?.revision === p.revision ? { ok: p.lastTest.ok, message: p.lastTest.message, at: p.lastTest.at, elapsedMs: p.lastTest.elapsedMs } : null,
    }];
  })) as MapConfigDto['providerConfigs'];
  const p = providerConfigs[isMapProviderKey(config.activeProvider) ? config.activeProvider : 'amap'];
  return {
    version: config.version, enabled: config.enabled, activeProvider: config.activeProvider, dailyLimit: config.dailyLimit,
    ...p, providerConfigs,
    available: unavailableReason === null, unavailableReason,
    canImportEnvironment: Boolean(process.env.AMAP_WEB_SERVICE_KEY?.trim() || process.env.AMAP_KEY?.trim()),
  };
}
async function assertPlatform(tx: PostgresTransaction, actorId: string) {
  if (!/^[1-9]\d*$/.test(actorId) || !await one(tx, sql`select id from app.admin_users where id=${actorId} and role in ('super_admin','admin') and status='active' for share`)) fail('Forbidden', 403);
}
async function read(transaction?: PostgresTransaction) {
  if (transaction) return stored((await new PlatformConfigRepository(transaction).findByKey('default'))?.mapServiceConfig);
  return withPlatformTransaction(async tx => stored((await new PlatformConfigRepository(tx).findByKey('default'))?.mapServiceConfig));
}
export async function getPlatformMapConfig(actorId: string) {
  return withPlatformTransaction(async tx => {
    await assertPlatform(tx, actorId);
    return dto(stored((await new PlatformConfigRepository(tx).findByKey('default'))?.mapServiceConfig));
  });
}
export function validateMapConfigInput(value: unknown): MapConfigInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('map_config_invalid', 422);
  const input = value as MapConfigInput;
  if (Object.keys(input).some(k => !['expectedVersion', 'enabled', 'activeProvider', 'providerKey', 'dailyLimit', 'apiKey', 'signingKey', 'clearSigningKey', 'clearApiKey', 'rights'].includes(k))) fail('map_config_invalid', 422);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || typeof input.enabled !== 'boolean'
    || !Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || input.dailyLimit > 10000) fail('map_config_invalid', 422);
  if (!isMapProviderKey(input.activeProvider) || (input.providerKey !== undefined && !isMapProviderKey(input.providerKey))) fail('map_provider_not_implemented', 422);
  if ((input.providerKey || input.activeProvider) === 'tianditu' && input.signingKey) fail('map_config_invalid', 422);
  for (const k of ['apiKey', 'signingKey'] as const) if (input[k] !== undefined && (typeof input[k] !== 'string' || input[k]!.length > 512 || /[\s\x00-\x1f]/.test(input[k]!))) fail('map_config_invalid', 422);
  if (input.clearSigningKey !== undefined && typeof input.clearSigningKey !== 'boolean') fail('map_config_invalid', 422);
  if (input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean') fail('map_config_invalid', 422);
  if ((input.clearApiKey && input.apiKey) || (input.clearSigningKey && input.signingKey)) fail('map_config_invalid', 422);
  const r = input.rights;
  if (r !== undefined && (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !['commercialConfirmed', 'bindingConfirmed', 'reference', 'validUntil'].includes(k))
    || typeof r.commercialConfirmed !== 'boolean' || typeof r.bindingConfirmed !== 'boolean'
    || typeof r.reference !== 'string' || r.reference.length > 500 || /[\x00-\x1f]/.test(r.reference)
    || typeof r.validUntil !== 'string' || r.validUntil.length > 40
    || (r.validUntil !== '' && (!/^\d{4}-\d{2}-\d{2}T/.test(r.validUntil) || !Number.isFinite(Date.parse(r.validUntil)))))) fail('map_config_invalid', 422);
  return input;
}
async function update(actorId: string, expectedVersion: number, change: (current: StoredConfig) => StoredConfig) {
  return withPlatformTransaction(async tx => {
    await assertPlatform(tx, actorId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('platform-map-services',0))`);
    const repository = new PlatformConfigRepository(tx), row = await repository.ensureForUpdate('default'), current = stored(row.mapServiceConfig);
    if (current.version !== expectedVersion) fail('map_config_conflict', 409);
    const next = change(current);
    next.version = current.version + 1; next.updatedBy = actorId; next.updatedAt = new Date().toISOString(); delete next.lastTest;
    await repository.update('default', { mapServiceConfig: next });
    return dto(next);
  });
}
export async function savePlatformMapConfig(value: unknown, actorId: string) {
  const input = validateMapConfigInput(value); encryptionReady();
  return update(actorId, input.expectedVersion, current => {
    const providerKey = input.providerKey || input.activeProvider, p = current.providers[providerKey];
    const selected: ProviderSettings = {
      ...p,
      apiKeyEncrypted: input.clearApiKey ? '' : input.apiKey ? encryptText(input.apiKey) : p.apiKeyEncrypted,
      signingKeyEncrypted: input.clearSigningKey ? '' : input.signingKey ? encryptText(input.signingKey) : p.signingKeyEncrypted,
      rights: input.rights ? { ...input.rights, reference: input.rights.reference.trim() } : p.rights,
    };
    if (fingerprint(selected) !== fingerprint(p) || input.dailyLimit !== current.dailyLimit) { selected.revision++; delete selected.lastTest; }
    const next: StoredConfig = { ...current, enabled: input.enabled, activeProvider: input.activeProvider, dailyLimit: input.dailyLimit,
      providers: { ...current.providers, [providerKey]: selected } };
    if (next.enabled) toRuntime(next);
    return next;
  });
}
export async function importEnvironmentMapConfig(expectedVersion: number, actorId: string) {
  const key = process.env.AMAP_WEB_SERVICE_KEY?.trim() || process.env.AMAP_KEY?.trim();
  if (!key) fail('map_environment_missing', 422); encryptionReady();
  return update(actorId, expectedVersion, current => {
    // Import is explicit and atomic. It never replaces an already saved credential.
    if (current.providers.amap.apiKeyEncrypted) fail('map_config_conflict', 409);
    return { ...current, providers: { ...current.providers, amap: { ...current.providers.amap,
      apiKeyEncrypted: encryptText(key), signingKeyEncrypted: encryptText(process.env.AMAP_WEB_SERVICE_SIGNING_KEY?.trim() || ''),
      revision: current.providers.amap.revision + 1, lastTest: undefined,
    } } };
  });
}
export async function getCommunityRuntimeConfig(transaction?: PostgresTransaction): Promise<CommunityProviderConfig> {
  const config = await read(transaction);
  // Legacy deployments keep working until the explicit database import/save.
  if (!config.version) return providerConfig();
  if (!config.enabled) fail('community_provider_disabled', 503);
  return toRuntime(config);
}
export async function testPlatformMapConnection(actorId: string, expectedVersion: number, city: string, query: string, transport: typeof fetch = fetch, selectedProvider?: MapProviderKey) {
  const config = await withPlatformTransaction(async tx => {
    await assertPlatform(tx, actorId);
    const repository = new PlatformConfigRepository(tx), row = await repository.ensureForUpdate('default'), current = stored(row.mapServiceConfig);
    if (current.version !== expectedVersion) fail('map_config_conflict', 409);
    toRuntime(current, selectedProvider || current.activeProvider);
    const now = Date.now(), window = current.testWindow && now - current.testWindow.since < 60000 ? current.testWindow : { since: now, count: 0 };
    if (window.count >= 3) fail('map_test_rate_limited', 429);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(now));
    const day = current.testDay?.date === date ? current.testDay : { date, count: 0 };
    if (day.count >= 30) fail('map_test_daily_limited', 429);
    current.testWindow = { since: window.since, count: window.count + 1 };
    current.testDay = { date, count: day.count + 1 };
    await repository.update('default', { mapServiceConfig: current });
    return current;
  });
  const providerKey = selectedProvider || config.activeProvider;
  const start = Date.now(); let ok = false, message: string;
  try {
    const items = await createCommunityProvider(toRuntime(config, providerKey), transport).search(city, query);
    ok = true; message = `连接成功，返回 ${items.length} 条符合住宅小区条件的候选；本次测试未保存小区资料。`;
  } catch (error) { message = mapError(error).message; }
  const result = { ok, message, at: new Date().toISOString(), elapsedMs: Date.now() - start };
  await withPlatformTransaction(async tx => {
    await assertPlatform(tx, actorId);
    const repository = new PlatformConfigRepository(tx), row = await repository.ensureForUpdate('default'), current = stored(row.mapServiceConfig);
    if (current.version !== config.version) fail('map_config_conflict', 409);
    const p = current.providers[providerKey];
    await repository.update('default', { mapServiceConfig: { ...current, providers: { ...current.providers,
      [providerKey]: { ...p, lastTest: { ...result, revision: p.revision } },
    } } });
  });
  return result;
}
