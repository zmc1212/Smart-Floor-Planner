import { fail, id } from '@/lib/assistant/contracts';
import { object, text } from './contracts';
import { cityNameFor, districtOptions } from '@/lib/portfolio/regions';

export type PublicMask = { x: number; y: number; width: number; height: number };
export type PublicSourceInput = { kind: 'site_record' | 'consultation_message'; id: string; sourceHash: string; text: string };
export type PublicPhotoInput = { recordId: string; mediaId: string; masks: PublicMask[] };
export type PublicMaterialInput = { name: string; cityCode: string; cityName: string; district: string; sources: PublicSourceInput[]; photos: PublicPhotoInput[] };
export type PublicContent = { name: string; cityCode: string; cityName: string; district: string; stageName: string;
  excerpts: Array<{ role: string; text: string; date: string }>; sourceCount: number; photoCount: number };
export function noPublicPii(value: string) {
  if (/1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\d{1,4}\s*(?:栋|幢|单元|号楼|室)/i.test(value)) fail('public_material_sensitive', 422);
  return value;
}
export function publicMaterialInput(value: unknown): PublicMaterialInput {
  const v = object(value, ['name', 'cityCode', 'district', 'sources', 'photos']);
  const name = noPublicPii(text(v.name, 80)), cityCode = text(v.cityCode, 6), cityName = cityNameFor(cityCode), district = text(v.district, 50);
  if (!cityName || !districtOptions(cityCode).some(d => d.value === district)) fail('invalid_public_material', 422);
  if (!Array.isArray(v.sources) || !v.sources.length || v.sources.length > 8 || !Array.isArray(v.photos) || v.photos.length > 4) fail('invalid_public_material', 422);
  const sources = v.sources.map((input: unknown) => {
    const s = object(input, ['kind', 'id', 'sourceHash', 'text']);
    if (!['site_record', 'consultation_message'].includes(String(s.kind)) || typeof s.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(s.sourceHash)) fail('invalid_public_material', 422);
    return { kind: s.kind as PublicSourceInput['kind'], id: id(s.id), sourceHash: s.sourceHash, text: noPublicPii(text(s.text, 1800)) };
  });
  if (new Set(sources.map(s => s.kind + ':' + s.id)).size !== sources.length) fail('invalid_public_material', 422);
  const photos = v.photos.map((input: unknown) => {
    const p = object(input, ['recordId', 'mediaId', 'masks']);
    if (!Array.isArray(p.masks) || p.masks.length > 12) fail('invalid_public_material', 422);
    const masks = p.masks.map((input: unknown) => {
      const m = object(input, ['x', 'y', 'width', 'height']);
      if (Object.values(m).length !== 4 || Object.values(m).some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)
        || Number(m.width) <= 0 || Number(m.height) <= 0 || Number(m.x) + Number(m.width) > 1.000001 || Number(m.y) + Number(m.height) > 1.000001) fail('invalid_public_material', 422);
      return m as PublicMask;
    });
    const recordId = id(p.recordId);
    if (!sources.some(s => s.kind === 'site_record' && s.id === recordId)) fail('invalid_public_material', 422);
    return { recordId, mediaId: id(p.mediaId), masks };
  });
  if (new Set(photos.map(p => p.mediaId)).size !== photos.length) fail('invalid_public_material', 422);
  return { name, cityCode, cityName, district, sources, photos };
}
/** Quotes may be clipped or masked; invented words cannot become a speaker's quote. */
export function excerptOf(original: string, excerpt: string) {
  const parts = excerpt.split('[已隐藏]'); let cursor = 0;
  if (!parts.some(s => s.trim())) return false;
  for (const part of parts) { if (!part) continue; const position = original.indexOf(part, cursor); if (position < 0) return false; cursor = position + part.length; }
  return true;
}
export function publicRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail('invalid_public_material', 422);
  return Number(value);
}
export const publicStatusLabels: Record<string, string> = { draft: '草稿', pending_owner: '待业主决定', owner_approved: '业主已同意，待企业审核', rejected: '审核退回', published: '已公开', declined: '业主暂不公开', withdrawn: '已撤回' };
