import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { normalizeLibraryCoverForCreation } from '@/lib/ai/prompt-template-cover';

async function solidImage(format: 'png' | 'jpeg' | 'webp') {
  const image = sharp({
    create: { width: 48, height: 40, channels: 3, background: { r: 240, g: 80, b: 40 } },
  });
  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'webp') return image.webp().toBuffer();
  return image.png().toBuffer();
}

test('library covers that are already jpeg or png stay in that format', async () => {
  const png = await normalizeLibraryCoverForCreation(await solidImage('png'));
  assert.equal(png.mimeType, 'image/png');
  assert.equal(png.width, 48);
  assert.equal(png.height, 40);

  const jpeg = await normalizeLibraryCoverForCreation(await solidImage('jpeg'));
  assert.equal(jpeg.mimeType, 'image/jpeg');
  assert.equal(jpeg.width, 48);
});

test('non-jpeg/png library covers are converted to png for creation references', async () => {
  const webp = await normalizeLibraryCoverForCreation(await solidImage('webp'));
  assert.equal(webp.mimeType, 'image/png');
  assert.equal(webp.width, 48);
  assert.equal(webp.height, 40);
});
