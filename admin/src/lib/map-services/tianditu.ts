import { AssistantError, fail } from '@/lib/assistant/contracts';
import { cityCode, inCity, shortText } from '@/lib/portfolio/contracts';
import { cityNameFor } from '@/lib/portfolio/regions';
import type { CommunityPoi, CommunityProviderConfig } from '@/lib/portfolio/community-provider';

// Official v2 search protocol and type/admin tables:
// https://lbs.tianditu.gov.cn/server/search2.html
// https://download.tianditu.gov.cn/download/xzqh/Type.csv (120201 = 小区)
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function adminCode(value: unknown) {
  const code = string(value);
  return /^156[1-9]\d{5}$/.test(code) ? code.slice(3) : /^[1-9]\d{5}$/.test(code) ? code : '';
}
export function tiandituCommunityPoi(raw: Record<string, unknown>, city: string): CommunityPoi | null {
  const poiId = string(raw.hotPointID), name = string(raw.name), code = string(raw.typeCode);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(poiId) || code !== '120201' || !['101', ''].includes(String(raw.poiType ?? ''))) return null;
  if (!name || name.length > 100 || /[\x00-\x1f]|出入口|停车场|停车位|[东西南北]门|道路|公交站|一期.*二期|[一二三四五六七八九]期[、/]|待定|暂名/.test(name)) return null;
  const expected = cityNameFor(city), cityField = raw.cityCode, countyField = raw.countyCode;
  for (const value of [cityField, countyField]) {
    if (value != null && value !== '' && (!adminCode(value) || !inCity(adminCode(value), city))) return null;
  }
  const providerCity = string(raw.city), province = string(raw.province);
  if (providerCity && expected && providerCity !== expected) return null;
  if (!adminCode(cityField) && !adminCode(countyField) && (!expected || (providerCity !== expected
    && !(['110000', '120000', '310000', '500000'].includes(city) && !providerCity && province === expected)))) return null;
  return { poiId, name, cityCode: city, cityName: providerCity || expected, district: string(raw.county).slice(0, 100), address: string(raw.address).slice(0, 200) };
}
export class TiandituCommunityProvider {
  constructor(readonly config: CommunityProviderConfig, private readonly transport: typeof fetch = fetch) {}
  private async request(city: string, query: string) {
    const url = new URL('https://api.tianditu.gov.cn/v2/search');
    url.search = new URLSearchParams({ tk: this.config.key, type: 'query', postStr: JSON.stringify({ keyWord: query,
      specify: '156' + city, queryType: 12, start: 0, count: 10, dataTypes: '120201', show: 2,
    }) }).toString();
    let response: Response;
    try { response = await this.transport(url, { signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store' }); }
    catch { return fail('community_provider_unavailable', 503); }
    if (response.status === 429) fail('community_provider_quota', 429);
    if ([401, 403].includes(response.status)) fail('community_provider_denied', 503);
    if (!response.ok || !response.body) fail('community_provider_unavailable', 503);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 512000) { await reader.cancel(); fail('community_provider_unavailable', 503); } chunks.push(value); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const code = String(data.status?.infocode ?? '');
      if (code === '3001') return [];
      if (code !== '1000') fail('community_provider_unavailable', 503);
      // Suggestions, administrative statistics and line results are never POIs.
      if (String(data.resultType) !== '1') return [];
      if (!Array.isArray(data.pois)) fail('community_provider_unavailable', 503);
      return data.pois as Record<string, unknown>[];
    } catch (error) { if (error instanceof AssistantError) throw error; return fail('community_provider_unavailable', 503); }
    finally { reader.releaseLock(); }
  }
  async search(city: string, query: string) {
    cityCode(city); shortText(query, 50, true);
    if ([...query.trim()].length < 2) fail('invalid_community_query', 422);
    return this.find(city, query.trim());
  }
  private async find(city: string, query: string) {
    const raw = await this.request(city, query);
    return [...new Map(raw.map(r => tiandituCommunityPoi(r, city)).filter((p): p is CommunityPoi => p !== null).map(p => [p.poiId, p])).values()].slice(0, 10);
  }
  async detail(city: string, poiId: string, name?: string) {
    cityCode(city);
    if (!name || name.length > 100 || !/^[A-Za-z0-9_-]{8,128}$/.test(poiId)) fail('community_candidate_invalid', 422);
    shortText(name, 100, true);
    // The documented v2 service has no ID-detail endpoint. Requery the signed
    // candidate name in its city and require the exact original ID; never invent
    // an endpoint or accept a same-name result as the original record.
    const matches = (await this.find(city, name)).filter(p => p.poiId === poiId);
    if (matches.length !== 1) fail('community_candidate_invalid', 422);
    return matches[0];
  }
}
