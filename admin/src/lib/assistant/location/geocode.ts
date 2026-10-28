import { createHash } from 'node:crypto';
import { AssistantError, fail } from '../contracts';
import type { CommunityProviderConfig } from '@/lib/portfolio/community-provider';
import { cityNameFor, districtOptions } from '@/lib/portfolio/regions';
import type { NearbyRegion } from './region';

export type Coordinates = { latitude: number; longitude: number; coordinateSystem: 'gcj02' };
export function coordinates(input: unknown): Coordinates {
  const value = input as Coordinates;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k => !['latitude', 'longitude', 'coordinateSystem'].includes(k))
    || value.coordinateSystem !== 'gcj02' || typeof value.latitude !== 'number' || typeof value.longitude !== 'number'
    || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)
    || value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) fail('invalid_location', 422);
  return value;
}

/** Only structured provider administrative codes become browsing context.
 * Coordinates, full addresses and POIs never leave this adapter. */
export async function reverseRegion(input: Coordinates, config: CommunityProviderConfig, transport: typeof fetch = fetch): Promise<NearbyRegion> {
  coordinates(input);
  if (config.providerKey && config.providerKey !== 'amap') fail('map_provider_not_implemented', 503);
  const params: Record<string, string> = { key: config.key, location: `${input.longitude.toFixed(6)},${input.latitude.toFixed(6)}`, extensions: 'base', output: 'JSON' };
  if (config.signingKey) params.sig = createHash('md5').update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + config.signingKey).digest('hex');
  const url = new URL('https://restapi.amap.com/v3/geocode/regeo'); url.search = new URLSearchParams(params).toString();
  try {
    const response = await transport(url, { signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store' });
    if (!response.ok || !response.body) fail('location_unavailable', 503);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
        if (size > 64000) { await reader.cancel(); fail('location_unavailable', 503); } chunks.push(chunk.value); }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data.status !== '1') fail('location_unavailable', 503);
    const part = data.regeocode?.addressComponent;
    if (!part || typeof part.adcode !== 'string' || !/^[1-9]\d{5}$/.test(part.adcode)) fail('location_unavailable', 503);
    const cityCode = ['11', '12', '31', '50'].includes(part.adcode.slice(0, 2)) ? part.adcode.slice(0, 2) + '0000' : part.adcode.slice(0, 4) + '00';
    const cityName = cityNameFor(cityCode);
    const providerCity = typeof part.city === 'string' && part.city ? part.city : part.province;
    if (!cityName || providerCity !== cityName || typeof part.district !== 'string'
      || !districtOptions(cityCode).some(d => d.value === part.district)) fail('location_unavailable', 503);
    return { cityCode, cityName, district: part.district, source: 'wechat_location', resolvedAt: new Date().toISOString() };
  } catch (error) { if (error instanceof AssistantError) throw error; return fail('location_unavailable', 503); }
}
