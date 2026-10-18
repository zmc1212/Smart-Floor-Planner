import { fail, id } from '@/lib/assistant/contracts';
import { EMPTY_WORK } from './options';

export const PORTFOLIO_ROLES = ['super_admin', 'admin', 'enterprise_admin', 'designer'] as const;
export type WorkImage = { assetId: string; kind: 'render' | 'photo'; aiGenerated: boolean; showroom: boolean; caption: string };
export type WorkContent = {
  title: string; description: string; primaryStyle: string; secondaryStyles: string[];
  cityCode: string; cityName: string; district: string; communityId: string | null;
  area: number | null; rooms: string; authorRole: string; source: string; authorization: string;
  rightsUntil: string | null; images: WorkImage[]; coverAssetId: string | null;
  showOnProfile: boolean; recommendable: boolean;
};
export { EMPTY_WORK } from './options';
export function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('invalid_portfolio', 422);
  return value as Record<string, unknown>;
}
export function shortText(value: unknown, max: number, required = false) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > max || (required && !value.trim())) fail('invalid_portfolio', 422);
  return value.trim();
}
export function cityCode(value: unknown) {
  const code = shortText(value, 6, true);
  // Provider city filtering is limited to prefecture/municipality codes, never free text.
  if (!/^[1-9]\d{3}00$/.test(code) || (code.endsWith('0000') && !['110000', '120000', '310000', '500000'].includes(code))) fail('invalid_community_city', 422);
  return code;
}
export function inCity(adcode: unknown, city: string) {
  if (typeof adcode !== 'string' || !/^\d{6}$/.test(adcode)) return false;
  return ['11', '12', '31', '50'].includes(city.slice(0, 2)) ? adcode.startsWith(city.slice(0, 2)) : adcode.startsWith(city.slice(0, 4));
}
function flag(value: unknown) { if (typeof value !== 'boolean') fail('invalid_portfolio', 422); return value; }
export function workContent(value: unknown, complete = false): WorkContent {
  const v = object(value, Object.keys(EMPTY_WORK));
  const data = { ...EMPTY_WORK, ...v };
  if (!Array.isArray(data.secondaryStyles) || data.secondaryStyles.length > 2) fail('invalid_portfolio', 422);
  const primaryStyle = shortText(data.primaryStyle, 30, complete);
  const secondaryStyles = data.secondaryStyles.map(t => shortText(t, 30, true));
  if (new Set([primaryStyle, ...secondaryStyles]).size !== secondaryStyles.length + 1) fail('invalid_portfolio', 422);
  if (!Array.isArray(data.images) || data.images.length > 20) fail('invalid_portfolio', 422);
  const images = data.images.map(item => {
    const i = object(item, ['assetId', 'kind', 'aiGenerated', 'showroom', 'caption']);
    if (!['render', 'photo'].includes(String(i.kind))) fail('invalid_portfolio', 422);
    const aiGenerated = flag(i.aiGenerated), showroom = flag(i.showroom);
    if ((i.kind === 'photo' && aiGenerated) || (i.kind === 'render' && showroom)) fail('invalid_image_group', 422);
    return { assetId: id(i.assetId), kind: i.kind as WorkImage['kind'], aiGenerated, showroom, caption: shortText(i.caption ?? '', 100) };
  });
  if (new Set(images.map(i => i.assetId)).size !== images.length) fail('invalid_portfolio', 422);
  const coverAssetId = data.coverAssetId == null ? null : id(data.coverAssetId);
  if (coverAssetId && !images.some(i => i.assetId === coverAssetId)) fail('invalid_portfolio', 422);
  if (complete && (!images.length || !coverAssetId)) fail('portfolio_not_ready', 422);
  const code = data.cityCode ? cityCode(data.cityCode) : '';
  if (complete && !code) fail('invalid_community_city', 422);
  const area = data.area;
  if (area !== null && (typeof area !== 'number' || !Number.isFinite(area) || area <= 0 || area > 100000)) fail('invalid_portfolio', 422);
  let rightsUntil: string | null = null;
  if (data.rightsUntil != null) {
    if (typeof data.rightsUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.rightsUntil) || !Number.isFinite(Date.parse(data.rightsUntil))) fail('invalid_portfolio', 422);
    rightsUntil = new Date(data.rightsUntil).toISOString();
    if (complete && Date.parse(rightsUntil) <= Date.now()) fail('portfolio_rights_expired', 422);
  }
  return {
    title: shortText(data.title, 50, complete), description: shortText(data.description, 400, complete), primaryStyle, secondaryStyles,
    cityCode: code, cityName: shortText(data.cityName, 50, complete), district: shortText(data.district, 100),
    communityId: data.communityId == null ? null : id(data.communityId), area, rooms: shortText(data.rooms, 30),
    authorRole: shortText(data.authorRole, 100, complete), source: shortText(data.source, 500, complete), authorization: shortText(data.authorization, 500, complete),
    rightsUntil, images, coverAssetId, showOnProfile: flag(data.showOnProfile), recommendable: flag(data.recommendable),
  };
}
export type DesignerProfile = { bio: string; cities: Array<{ code: string; name: string; districts: string[] }>; styles: string[]; featuredWorkIds: string[] };
export function designerProfile(value: unknown): DesignerProfile {
  const v = object(value, ['bio', 'cities', 'styles', 'featuredWorkIds']);
  if (!Array.isArray(v.cities) || v.cities.length > 10 || !Array.isArray(v.styles) || v.styles.length > 8 || !Array.isArray(v.featuredWorkIds) || v.featuredWorkIds.length > 12) fail('invalid_portfolio', 422);
  return { bio: shortText(v.bio, 500), cities: v.cities.map(item => {
    const c = object(item, ['code', 'name', 'districts']);
    if (!Array.isArray(c.districts) || c.districts.length > 30) fail('invalid_portfolio', 422);
    return { code: cityCode(c.code), name: shortText(c.name, 50, true), districts: c.districts.map(d => shortText(d, 50, true)) };
  }), styles: [...new Set(v.styles.map(t => shortText(t, 30, true)))], featuredWorkIds: [...new Set(v.featuredWorkIds.map(id))] };
}
