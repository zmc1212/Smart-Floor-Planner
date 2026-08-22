import jsQR from 'jsqr';
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

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg']);

/** Personal WeChat add-friend QR payloads we accept for designer contact. */
const PERSONAL_PATTERNS: RegExp[] = [
  /^https?:\/\/u\.weixin\.qq\.com\//i,
  /^https?:\/\/weixin\.qq\.com\/r\//i,
  /^https?:\/\/weixin\.qq\.com\/dl\//i,
  /^weixin:\/\/contacts\/profile\//i,
  /^https?:\/\/work\.weixin\.qq\.com\/[uw]\//i,
];

const REJECTED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^wxp:\/\//i, reason: '这是收款码，请上传个人微信二维码' },
  { pattern: /tenpay|wx\.tenpay\.com|payapp\.weixin/i, reason: '这是收款码，请上传个人微信二维码' },
  { pattern: /^https?:\/\/c\.weixin\.qq\.com\//i, reason: '这是群聊码，请上传个人微信二维码' },
  { pattern: /weixin:\/\/.*(group|chatroom)/i, reason: '这是群聊码，请上传个人微信二维码' },
  { pattern: /^https?:\/\/mp\.weixin\.qq\.com\//i, reason: '这是公众号相关二维码，请上传个人微信二维码' },
  { pattern: /gh_/i, reason: '这是公众号相关二维码，请上传个人微信二维码' },
];

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

export function isPersonalWechatFriendPayload(payload: string): boolean {
  const text = String(payload || '').trim();
  if (!text) return false;
  for (const { pattern } of REJECTED_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return PERSONAL_PATTERNS.some((pattern) => pattern.test(text));
}

function rejectReasonForPayload(payload: string): string | null {
  const text = String(payload || '').trim();
  for (const { pattern, reason } of REJECTED_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  if (!PERSONAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return '请上传微信「我」页的个人二维码（长按可添加好友）';
  }
  return null;
}

export type PreparedStaffWechatQr = {
  buffer: Buffer;
  mimeType: 'image/png';
  width: number;
  height: number;
  payload: string;
};

/**
 * Decode and validate a designer personal WeChat QR image.
 * Accepts PNG/JPEG only; always returns a PNG buffer for storage.
 */
export async function prepareStaffWechatQrUpload(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<PreparedStaffWechatQr> {
  const mimeType = String(input.mimeType || '').toLowerCase().split(';')[0].trim();
  if (mimeType === 'image/webp' || mimeType === 'image/gif') {
    throw new StaffWechatQrError(
      'unsupported_image_type',
      '请上传 PNG 或 JPEG 格式的个人微信二维码（不支持 WebP/GIF）'
    );
  }
  if (!ALLOWED_MIME.has(mimeType) && !mimeType.startsWith('image/')) {
    throw new StaffWechatQrError('unsupported_image_type', '请上传二维码图片');
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new StaffWechatQrError(
      'unsupported_image_type',
      '请上传 PNG 或 JPEG 格式的个人微信二维码'
    );
  }
  if (!input.buffer?.length) {
    throw new StaffWechatQrError('empty_image', '二维码图片为空，请重新选择');
  }

  let rgba: { data: Buffer; info: sharp.OutputInfo };
  try {
    rgba = await sharp(input.buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new StaffWechatQrError('invalid_image', '无法读取图片，请重新从微信「我」页保存二维码');
  }

  const { width, height } = rgba.info;
  if (!width || !height || width < 80 || height < 80) {
    throw new StaffWechatQrError('qr_too_small', '二维码太小或截图不全，请重新保存完整二维码');
  }

  const code = jsQR(
    new Uint8ClampedArray(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength),
    width,
    height,
    { inversionAttempts: 'attemptBoth' }
  );
  if (!code?.data) {
    throw new StaffWechatQrError(
      'qr_not_found',
      '未识别到二维码，请上传清晰的个人微信二维码（不要截屏裁切过小）'
    );
  }

  const rejectReason = rejectReasonForPayload(code.data);
  if (rejectReason) {
    throw new StaffWechatQrError('qr_not_personal', rejectReason);
  }

  const pngBuffer = await sharp(input.buffer).png().toBuffer();
  const meta = await sharp(pngBuffer).metadata();

  return {
    buffer: pngBuffer,
    mimeType: 'image/png',
    width: Number(meta.width) || width,
    height: Number(meta.height) || height,
    payload: code.data.trim(),
  };
}
