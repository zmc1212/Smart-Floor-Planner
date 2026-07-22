const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_SIDE = 6000;
const MIN_IMAGE_SIDE = 320;

export type SupportedAiImageMimeType = 'image/jpeg' | 'image/png';

export function detectAiImageMimeType(buffer: Buffer): SupportedAiImageMimeType | null {
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer.toString('ascii', 1, 4) === 'PNG'
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function readPngSize(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegSize(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const size = buffer.readUInt16BE(offset + 2);
    if (size < 2) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += size + 2;
  }
  return null;
}

export function validateAiImage(input: { buffer: Buffer }) {
  const mimeType = detectAiImageMimeType(input.buffer);
  if (!mimeType) {
    throw new Error('仅支持 JPG 或 PNG 图片');
  }
  if (input.buffer.length === 0 || input.buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('图片大小必须在 8MB 以内');
  }

  const size = mimeType === 'image/png' ? readPngSize(input.buffer) : readJpegSize(input.buffer);
  if (!size) throw new Error('无法识别图片尺寸，请重新选择图片');
  if (Math.min(size.width, size.height) < MIN_IMAGE_SIDE) {
    throw new Error(`图片短边不能小于 ${MIN_IMAGE_SIDE}px`);
  }
  if (Math.max(size.width, size.height) > MAX_IMAGE_SIDE) {
    throw new Error(`图片长边不能超过 ${MAX_IMAGE_SIDE}px`);
  }

  return { ...size, mimeType };
}
