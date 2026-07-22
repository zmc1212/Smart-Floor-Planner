import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAiImageMimeType, validateAiImage } from '../image-validation';

function pngBuffer(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('detects image MIME from bytes without multipart MIME metadata', () => {
  const buffer = pngBuffer(640, 480);

  assert.equal(detectAiImageMimeType(buffer), 'image/png');
  assert.deepEqual(validateAiImage({ buffer }), {
    width: 640,
    height: 480,
    mimeType: 'image/png',
  });
});

test('rejects a non-image payload', () => {
  assert.throws(
    () => validateAiImage({ buffer: Buffer.from('not an image') }),
    /仅支持 JPG 或 PNG 图片/
  );
});
