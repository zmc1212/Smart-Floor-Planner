import { CITY_OPTIONS, cityNameFor, districtOptions } from '@/lib/portfolio/regions';

/** Coarse, short-lived browsing context; never a housing fact or a home address. */
export type NearbyRegion = { cityCode: string; cityName: string; district: string; source: 'wechat_location'; resolvedAt: string };
export const locationLifetimeMs = 30 * 60 * 1000;
export function nearbyRegion(entry: unknown, now = Date.now()): NearbyRegion | null {
  const value = (entry as { nearbyRegion?: NearbyRegion } | null)?.nearbyRegion;
  if (!value || value.source !== 'wechat_location' || cityNameFor(value.cityCode) !== value.cityName || !value.cityName
    || (value.district && !districtOptions(value.cityCode).some(d => d.value === value.district))) return null;
  const age = now - Date.parse(value.resolvedAt);
  return Number.isFinite(age) && age >= 0 && age < locationLifetimeMs ? value : null;
}

/** Explicit housing locations win. Ambiguous/negated locations never fall back
 * silently to the device location. Style uncertainty does not erase a city. */
export function recommendationRegion(entry: unknown, housing = '', trigger = '') {
  for (const text of [trigger, housing]) {
    const cities = CITY_OPTIONS.filter(c => text.includes(c.label.replace(/市$/, '')));
    if (!cities.length) continue;
    if (cities.length !== 1 || /[？?]|不在|不是|不确定|没定|假如|假设/.test(text)) return null;
    const city = cities[0];
    const districts = districtOptions(city.value).filter(d => text.includes(d.value));
    return { cityCode: city.value, cityName: city.label, district: districts.length === 1 ? districts[0].value : '', source: 'housing' as const };
  }
  return nearbyRegion(entry);
}
