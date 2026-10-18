// Local area names/codes from @vant/area-data (MIT), not an external POI database.
// Upstream: https://github.com/youzan/vant/tree/main/packages/vant-area-data
import { areaList } from '@vant/area-data';
const municipalities = ['11', '12', '31', '50'];
const cities = new Map<string, string>();
for (const [code, name] of Object.entries(areaList.city_list)) {
  if (municipalities.includes(code.slice(0, 2))) cities.set(code.slice(0, 2) + '0000', areaList.province_list[code.slice(0, 2) + '0000']);
  else if (/^[1-9]\d{3}00$/.test(code) && !/省直辖|自治区直辖/.test(name)) cities.set(code, name);
}
export const CITY_OPTIONS = [...cities.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
export function cityNameFor(code: string) { return cities.get(code) || ''; }
export function districtOptions(code: string) {
  if (!code) return [];
  const prefix = municipalities.includes(code.slice(0, 2)) ? code.slice(0, 2) : code.slice(0, 4);
  return Object.entries(areaList.county_list).filter(([key]) => key.startsWith(prefix)).map(([, name]) => ({ value: name, label: name }));
}
