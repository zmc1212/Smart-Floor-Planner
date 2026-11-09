import { fail, id } from '@/lib/assistant/contracts';
import { EMPTY_WORK, LAYOUT_OPTIONS, PORTFOLIO_DEFAULT_AVATARS, SPACE_OPTIONS, TOUR_HOSTS, type PortfolioDefaultAvatar } from './options';
import { DEFAULT_PORTFOLIO_TEMPLATE, PORTFOLIO_TEMPLATES, type PortfolioTemplate } from './templates';

export const PORTFOLIO_ROLES = ['super_admin', 'admin', 'enterprise_admin', 'designer'] as const;
export type WorkImage = { assetId: string; kind: 'render' | 'photo'; aiGenerated: boolean; showroom: boolean; caption: string; space: string };
export type WorkPlanComparison = {
  originalAssetId: string | null; designAssetId: string | null; aligned: boolean;
  changes: Array<{ title: string; text: string }>;
};
export type WorkContent = {
  title: string; description: string; primaryStyle: string; secondaryStyles: string[];
  cityCode: string; cityName: string; district: string; communityId: string | null;
  area: number | null; rooms: string; layoutTypes: string[]; authorRole: string; source: string; authorization: string;
  rightsUntil: string | null; highlights: string[]; materials: string[]; palette: Array<{ name: string; hex: string }>;
  tours: Array<{ url: string; provider: string; title: string }>; images: WorkImage[]; coverAssetId: string | null;
  showOnProfile: boolean; recommendable: boolean;
  planComparison?: WorkPlanComparison;
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
export function tourUrl(value: unknown, hosts: Readonly<Record<string, string>> = TOUR_HOSTS) {
  const raw = shortText(value, 500, true);
  let url: URL;
  try { url = new URL(raw); } catch { fail('invalid_portfolio_tour', 422); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)) fail('invalid_portfolio_tour', 422);
  const hostname = url.hostname.toLowerCase();
  const host = Object.keys(hosts).find(candidate => hostname === candidate || hostname.endsWith('.' + candidate));
  if (!host) fail('invalid_portfolio_tour', 422);
  return { url: url.href, provider: hosts[host] };
}
function flag(value: unknown) { if (typeof value !== 'boolean') fail('invalid_portfolio', 422); return value; }
function optionList(value: unknown, options: readonly string[]) {
  if (!Array.isArray(value)) fail('invalid_portfolio', 422);
  const list = value.map(item => shortText(item, 30, true));
  if (list.some(item => !options.includes(item))) fail('invalid_portfolio', 422);
  if (new Set(list).size !== list.length) fail('invalid_portfolio', 422);
  return list;
}
function shortList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) fail('invalid_portfolio', 422);
  return value.map(item => shortText(item, maxLength, true));
}
export function planComparison(value: unknown): WorkPlanComparison {
  const v = object(value ?? {}, ['originalAssetId', 'designAssetId', 'aligned', 'changes']);
  const originalAssetId = v.originalAssetId == null ? null : id(v.originalAssetId);
  const designAssetId = v.designAssetId == null ? null : id(v.designAssetId);
  const aligned = v.aligned === undefined ? false : flag(v.aligned);
  const changes = v.changes ?? [];
  if (!Array.isArray(changes) || changes.length > 6 || (originalAssetId && originalAssetId === designAssetId)
    || ((!originalAssetId || !designAssetId) && (aligned || changes.length))) fail('invalid_portfolio', 422);
  return { originalAssetId, designAssetId, aligned, changes: changes.map(item => {
    const change = object(item, ['title', 'text']);
    return { title: shortText(change.title, 60, true), text: shortText(change.text ?? '', 180) };
  }) };
}
export function workAssetIds(content: Pick<WorkContent, 'images' | 'planComparison'>) {
  return [...new Set([...content.images.map(image => image.assetId),
    content.planComparison?.originalAssetId, content.planComparison?.designAssetId].filter((asset): asset is string => Boolean(asset)))];
}
export function workContent(value: unknown, complete = false): WorkContent {
  const v = object(value, Object.keys(EMPTY_WORK));
  const data = { ...EMPTY_WORK, ...v };
  if (!Array.isArray(data.secondaryStyles) || data.secondaryStyles.length > 2) fail('invalid_portfolio', 422);
  const primaryStyle = shortText(data.primaryStyle, 30, complete);
  const secondaryStyles = data.secondaryStyles.map(t => shortText(t, 30, true));
  if (new Set([primaryStyle, ...secondaryStyles]).size !== secondaryStyles.length + 1) fail('invalid_portfolio', 422);
  if (!Array.isArray(data.images) || data.images.length > 20) fail('invalid_portfolio', 422);
  const images = data.images.map(item => {
    const i = object(item, ['assetId', 'kind', 'aiGenerated', 'showroom', 'caption', 'space']);
    if (!['render', 'photo'].includes(String(i.kind))) fail('invalid_portfolio', 422);
    const aiGenerated = flag(i.aiGenerated), showroom = flag(i.showroom);
    if ((i.kind === 'photo' && aiGenerated) || (i.kind === 'render' && showroom)) fail('invalid_image_group', 422);
    const space = i.space == null ? '' : shortText(i.space, 20);
    if (space && !SPACE_OPTIONS.includes(space)) fail('invalid_portfolio', 422);
    return { assetId: id(i.assetId), kind: i.kind as WorkImage['kind'], aiGenerated, showroom, caption: shortText(i.caption ?? '', 100), space };
  });
  const layoutTypes = optionList(data.layoutTypes, LAYOUT_OPTIONS);
  if (layoutTypes.length > 3) fail('invalid_portfolio', 422);
  const highlights = shortList(data.highlights, 6, 60);
  const materials = shortList(data.materials, 6, 40);
  if (!Array.isArray(data.palette) || data.palette.length > 6) fail('invalid_portfolio', 422);
  const palette = data.palette.map(item => {
    const p = object(item, ['name', 'hex']);
    const hex = shortText(p.hex, 7, true);
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) fail('invalid_portfolio', 422);
    return { name: shortText(p.name, 20, true), hex };
  });
  if (!Array.isArray(data.tours) || data.tours.length > 3) fail('invalid_portfolio', 422);
  const tours = data.tours.map(item => {
    const t = object(item, ['url', 'provider', 'title']);
    return { ...tourUrl(t.url), title: shortText(t.title, 60, true) };
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
    communityId: data.communityId == null ? null : id(data.communityId), area, rooms: shortText(data.rooms, 30), layoutTypes,
    authorRole: shortText(data.authorRole, 100, complete), source: shortText(data.source, 500, complete), authorization: shortText(data.authorization, 500, complete),
    rightsUntil, highlights, materials, palette, tours, images, coverAssetId, planComparison: planComparison(data.planComparison),
    showOnProfile: flag(data.showOnProfile), recommendable: flag(data.recommendable),
  };
}
export type DesignerProfile = { template: PortfolioTemplate; defaultAvatar?: PortfolioDefaultAvatar; bio: string; cities: Array<{ code: string; name: string; districts: string[] }>; styles: string[]; layoutSpecialties: string[]; featuredWorkIds: string[] };
export function designerProfile(value: unknown): DesignerProfile {
  const v = object(value, ['template', 'defaultAvatar', 'bio', 'cities', 'styles', 'layoutSpecialties', 'featuredWorkIds']);
  const template = v.template === undefined ? DEFAULT_PORTFOLIO_TEMPLATE : v.template;
  if (!PORTFOLIO_TEMPLATES.some(option => option.value === template)) fail('invalid_portfolio', 422);
  const avatar = PORTFOLIO_DEFAULT_AVATARS.find(option => option.value === v.defaultAvatar);
  if (v.defaultAvatar !== undefined && !avatar) fail('invalid_portfolio', 422);
  if (!Array.isArray(v.cities) || v.cities.length > 10 || !Array.isArray(v.styles) || v.styles.length > 8 || !Array.isArray(v.featuredWorkIds) || v.featuredWorkIds.length > 12) fail('invalid_portfolio', 422);
  const layoutSpecialties = optionList(v.layoutSpecialties ?? [], LAYOUT_OPTIONS);
  if (layoutSpecialties.length > 6) fail('invalid_portfolio', 422);
  return { template: template as PortfolioTemplate, ...(avatar ? { defaultAvatar: avatar.value } : {}), bio: shortText(v.bio, 500), cities: v.cities.map(item => {
    const c = object(item, ['code', 'name', 'districts']);
    if (!Array.isArray(c.districts) || c.districts.length > 30) fail('invalid_portfolio', 422);
    return { code: cityCode(c.code), name: shortText(c.name, 50, true), districts: c.districts.map(d => shortText(d, 50, true)) };
  }), styles: [...new Set(v.styles.map(t => shortText(t, 30, true)))], layoutSpecialties, featuredWorkIds: [...new Set(v.featuredWorkIds.map(id))] };
}
