import sharp from 'sharp';

export class StaffWechatQrError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'StaffWechatQrError';
    this.code = code;
    this.status = status;
  }
}

const ALLOWED_STORE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg']);

export function normalizeStaffWechatId(raw: unknown): string {
  return String(raw || '').trim();
}

export function validateStaffWechatId(raw: unknown): string {
  const wechatId = normalizeStaffWechatId(raw);
  if (!wechatId || wechatId.length > 64) {
    throw new StaffWechatQrError(
      'invalid_wechat_id',
      '请填写 1–64 个字符的微信号（微信「我」页中的微信号，不是昵称）'
    );
  }
  // WeChat IDs are Latin letters, digits, underscore, hyphen; Chinese is nickname.
  if (/[\u4e00-\u9fff]/.test(wechatId)) {
    throw new StaffWechatQrError(
      'invalid_wechat_id',
      '请填写微信号，不要填微信昵称'
    );
  }
  if (/\s/.test(wechatId)) {
    throw new StaffWechatQrError('invalid_wechat_id', '微信号不能包含空格');
  }
  return wechatId;
}

function sniffImageMime(buffer: Buffer, declared: string): string {
  const declaredMime = String(declared || '').toLowerCase().split(';')[0].trim();
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (declaredMime === 'image/jpg' || declaredMime === 'image/jpeg') return 'image/jpeg';
  if (declaredMime === 'image/png') return 'image/png';
  return declaredMime;
}

export type PreparedStaffWechatQr = {
  buffer: Buffer;
  mimeType: 'image/png';
  width: number;
  height: number;
};

/**
 * Store a designer personal WeChat QR image.
 * Accepts PNG/JPEG (including Mini Program uploads whose MIME is empty/octet-stream).
 * Does not decode or whitelist QR payload: WeChat 二维码名片 screenshots often fail jsQR.
 */
export async function prepareStaffWechatQrUpload(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<PreparedStaffWechatQr> {
  if (!input.buffer?.length) {
    throw new StaffWechatQrError('empty_image', '二维码图片为空，请重新选择');
  }

  const mimeType = sniffImageMime(input.buffer, input.mimeType);
  if (mimeType === 'image/webp' || mimeType === 'image/gif') {
    throw new StaffWechatQrError(
      'unsupported_image_type',
      '请上传 PNG 或 JPEG 格式的个人微信二维码（不支持 WebP/GIF）'
    );
  }
  if (!ALLOWED_STORE_MIME.has(mimeType)) {
    throw new StaffWechatQrError(
      'unsupported_image_type',
      '请上传 PNG 或 JPEG 格式的个人微信二维码'
    );
  }

  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(input.buffer).rotate().metadata();
    width = Number(meta.width) || 0;
    height = Number(meta.height) || 0;
  } catch {
    throw new StaffWechatQrError('invalid_image', '无法读取图片，请重新从微信「我」页保存二维码名片');
  }

  if (!width || !height || width < 80 || height < 80) {
    throw new StaffWechatQrError('qr_too_small', '图片太小，请重新保存完整二维码名片');
  }

  const pngBuffer = await sharp(input.buffer).rotate().png().toBuffer();
  const storedMeta = await sharp(pngBuffer).metadata();

  return {
    buffer: pngBuffer,
    mimeType: 'image/png',
    width: Number(storedMeta.width) || width,
    height: Number(storedMeta.height) || height,
  };
}
