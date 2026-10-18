import sharp from 'sharp';
import { fail, fingerprint } from '../contracts';

export type ReferenceCase = {
  source: string; authorization: string; tags: string[];
  imageBase64: string; mimeType: 'image/jpeg';
};
export const REFERENCE_NOTICE = '仅供装修方向参考，不是你家的正式施工方案；可直接说喜欢或不合适。';
export const NO_REFERENCE = '目前没有匹配且可用的授权参考案例。可以继续聊你的想法，或请设计师结合实际情况提供参考。';

/** Rights are attested by the authorized curator, never inferred from an image or URL. */
export function referenceCase(value: unknown): ReferenceCase {
  const v = value as ReferenceCase;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['source','authorization','tags','imageBase64','mimeType'].includes(k))
    || typeof v.source !== 'string' || !v.source.trim() || v.source.length > 500
    || typeof v.authorization !== 'string' || !v.authorization.trim() || v.authorization.length > 500
    || !Array.isArray(v.tags) || !v.tags.length || v.tags.length > 12
    || v.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 30)
    || typeof v.imageBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.imageBase64)
    || v.mimeType !== 'image/jpeg') fail('invalid_reference_case', 422);
  const bytes = Buffer.from(v.imageBase64, 'base64');
  if (bytes.length > 300 * 1024 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.toString('base64') !== v.imageBase64) fail('invalid_reference_case', 422);
  return { source: v.source.trim(), authorization: v.authorization.trim(), tags: [...new Set(v.tags.map(t => t.trim()))], imageBase64: v.imageBase64, mimeType: 'image/jpeg' };
}
export async function prepareReferenceCase(value: unknown): Promise<ReferenceCase> {
  const v = value as ReferenceCase;
  if (!v || typeof v.imageBase64 !== 'string' || v.imageBase64.length > 5600000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.imageBase64)) fail('invalid_reference_case', 422);
  try {
    const input = Buffer.from(v.imageBase64, 'base64');
    const image = sharp(input, { limitInputPixels: 24000000, animated: false });
    const meta = await image.metadata();
    if (!['png','jpeg'].includes(meta.format || '') || (meta.pages || 1) > 1) fail('invalid_reference_case', 422);
    for (const [size, quality] of [[1200,72],[1200,60],[960,60],[800,48]]) {
      const bytes = await image.clone().rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (bytes.length <= 300 * 1024) return referenceCase({ ...v, imageBase64: bytes.toString('base64'), mimeType: 'image/jpeg' });
    }
    return fail('invalid_reference_case', 422);
  } catch { return fail('invalid_reference_case', 422); }
}
export function referenceContent(body: string, value: unknown) {
  const reference = referenceCase(value);
  if (!body.trim() || body.length > 400) fail('invalid_reference_case', 422);
  return { reference, rendered: body, hash: fingerprint({ source: 'reference_case', body, reference }) };
}
