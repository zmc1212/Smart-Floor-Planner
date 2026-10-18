import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { AssistantError, fail, fingerprint } from '@/lib/assistant/contracts';
import { cityCode, inCity, shortText } from './contracts';
import { cityNameFor } from './regions';

export type CommunityPoi = { poiId: string; name: string; cityCode: string; cityName: string; district: string; address: string };
export type CommunityProviderConfig = { key: string; signingKey: string; license: string; validUntil: string; dailyLimit: number; providerKey?: string; configRevision?: number };
export function providerConfig(env: Record<string, string | undefined> = process.env): CommunityProviderConfig {
  const key = env.AMAP_WEB_SERVICE_KEY?.trim() || env.AMAP_KEY?.trim();
  if (!key) fail('community_provider_unconfigured', 503);
  const dailyLimit = Number(env.AMAP_APP_DAILY_LIMIT || 1000);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) fail('community_provider_unconfigured', 503);
  return { key, signingKey: env.AMAP_WEB_SERVICE_SIGNING_KEY?.trim() || '', license: env.AMAP_LICENSE_REFERENCE?.trim() || '',
    validUntil: Number.isFinite(Date.parse(env.AMAP_RIGHTS_VALID_UNTIL || '')) ? env.AMAP_RIGHTS_VALID_UNTIL! : '', dailyLimit };
}
function string(value: unknown) { return typeof value === 'string' ? value : ''; }
/** Residential POIs only; input tips/roads/entrances and ID-less suggestions never become community IDs. */
export function communityPoi(raw: Record<string, unknown>, city: string): CommunityPoi | null {
  if (!/^[A-Za-z0-9]{8,32}$/.test(string(raw.id)) || !/^12030[0-2]$/.test(string(raw.typecode))) return null;
  if (raw.adcode != null && typeof raw.adcode !== 'string' && !(Array.isArray(raw.adcode) && raw.adcode.length === 0)) return null;
  const code = string(raw.adcode).trim(), expectedCity = cityNameFor(city), providerCity = string(raw.cityname).trim();
  // Live v3 responses can omit adcode. Use exact structured city identity only;
  // never infer a city from a query, address substring, or the requested filter.
  // A present but contradictory/malformed adcode always fails closed.
  if (code ? !inCity(code, city) : !expectedCity || (providerCity !== expectedCity
    && !(['110000', '120000', '310000', '500000'].includes(city) && !providerCity && string(raw.pname).trim() === expectedCity))) return null;
  if (code && expectedCity && providerCity && providerCity !== expectedCity) return null;
  const name = string(raw.name).trim(), district = string(raw.adname).trim();
  if (!name || name.length > 100 || /出入口|停车场|停车位|[东西南北]门|道路|公交站/.test(name)) return null;
  // Ambiguous parent/phase results must be resolved by selecting a concrete provider record.
  if (/一期.*二期|[一二三四五六七八九]期[、/]|待定|暂名/.test(name)) return null;
  return { poiId: string(raw.id), name, cityCode: city, cityName: providerCity || expectedCity, district, address: string(raw.address).slice(0, 200) };
}
export class AmapCommunityProvider {
  constructor(readonly config: CommunityProviderConfig, private readonly transport: typeof fetch = fetch) {}
  private async request(path: 'text' | 'detail', parameters: Record<string, string>) {
    const params: Record<string, string> = { ...parameters, key: this.config.key, output: 'JSON' };
    if (this.config.signingKey) params.sig = createHash('md5').update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + this.config.signingKey).digest('hex');
    const url = new URL('https://restapi.amap.com/v3/place/' + path);
    url.search = new URLSearchParams(params).toString();
    let response: Response;
    try { response = await this.transport(url, { signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store' }); }
    catch { return fail('community_provider_unavailable', 503); }
    if (!response.ok || !response.body) fail('community_provider_unavailable', 503);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 512000) { await reader.cancel(); fail('community_provider_unavailable', 503); } chunks.push(value); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (data.status !== '1') {
        if (['10003', '10004', '10020', '10021', '10044'].includes(data.infocode)) fail('community_provider_quota', 429);
        if (['10001', '10002', '10005', '10006', '10007', '10008', '10009', '10012', '10013'].includes(data.infocode)) fail('community_provider_denied', 503);
        fail('community_provider_unavailable', 503);
      }
      if (!Array.isArray(data.pois)) fail('community_provider_unavailable', 503);
      return data.pois as Record<string, unknown>[];
    } catch (e) {
      if (e instanceof AssistantError) throw e;
      return fail('community_provider_unavailable', 503);
    } finally { reader.releaseLock(); }
  }
  async search(city: string, query: string) {
    cityCode(city); shortText(query, 50, true);
    if ([...query.trim()].length < 2) fail('invalid_community_query', 422);
    const rows = await this.request('text', { keywords: query.trim(), city, citylimit: 'true', types: '120300', offset: '10', page: '1', extensions: 'base' });
    return [...new Map(rows.map(r => communityPoi(r, city)).filter((p): p is CommunityPoi => p !== null).map(p => [p.poiId, p])).values()].slice(0, 10);
  }
  async detail(city: string, poiId: string) {
    const rows = await this.request('detail', { id: poiId, extensions: 'base' });
    const poi = rows.length === 1 ? communityPoi(rows[0], city) : null;
    if (!poi || poi.poiId !== poiId) fail('community_candidate_invalid', 422);
    return poi;
  }
}
function tokenSecret() { if (!process.env.JWT_SECRET) fail('community_provider_unconfigured', 503); return new TextEncoder().encode(process.env.JWT_SECRET); }
export async function candidateToken(enterpriseId: string, adminId: string, poi: CommunityPoi, providerKey = 'amap', configRevision?: number) {
  return new SignJWT({ enterpriseId, providerKey, configRevision, name: poi.name, city: poi.cityCode, poiId: poi.poiId, hash: fingerprint(poi) }).setProtectedHeader({ alg: 'HS256' }).setAudience('portfolio-community').setSubject(adminId).setIssuedAt().setExpirationTime('5m').sign(tokenSecret());
}
export async function readCandidate(token: unknown, enterpriseId: string, adminId: string) {
  if (typeof token !== 'string' || token.length > 2048) fail('community_candidate_invalid', 422);
  try {
    const { payload } = await jwtVerify(token, tokenSecret(), { audience: 'portfolio-community', algorithms: ['HS256'] });
    if (payload.sub !== adminId || payload.enterpriseId !== enterpriseId || typeof payload.poiId !== 'string' || typeof payload.city !== 'string' || typeof payload.hash !== 'string') fail('community_candidate_invalid', 422);
    cityCode(payload.city);
    if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.length > 100)) fail('community_candidate_invalid', 422);
    if (payload.configRevision !== undefined && (!Number.isSafeInteger(payload.configRevision) || Number(payload.configRevision) < 0)) fail('community_candidate_invalid', 422);
    return { city: payload.city, poiId: payload.poiId, hash: payload.hash, name: payload.name as string | undefined,
      configRevision: payload.configRevision as number | undefined, providerKey: typeof payload.providerKey === 'string' ? payload.providerKey : 'amap' };
  } catch { return fail('community_candidate_invalid', 422); }
}
