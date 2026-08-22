import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  isHttpSourceUrl,
  normalizeLibraryCoverForCreation,
  readLibraryCoverBuffer,
} from '@/lib/ai/prompt-template-cover';

async function solidImage(format: 'png' | 'jpeg' | 'webp') {
  const image = sharp({
    create: { width: 48, height: 40, channels: 3, background: { r: 240, g: 80, b: 40 } },
  });
  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'webp') return image.webp().toBuffer();
  return image.png().toBuffer();
}

function coverAsset(sourceUrl?: string) {
  return {
    storageProvider: 'local',
    storageKey: 'prompt-library/missing.png',
    sourceUrl,
  };
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

test('http(s) imported cover URLs are accepted and other schemes are rejected', () => {
  assert.equal(isHttpSourceUrl('https://cdn.example.com/cover.png'), true);
  assert.equal(isHttpSourceUrl('http://cdn.example.com/cover.png'), true);
  assert.equal(isHttpSourceUrl('file:///tmp/cover.png'), false);
  assert.equal(isHttpSourceUrl(''), false);
});

test('clone cover bytes prefer the stored object and fall back to the imported source URL', async () => {
  const stored = await solidImage('png');
  const remote = await solidImage('jpeg');
  const fromStore = await readLibraryCoverBuffer(coverAsset('https://cdn.example.com/cover.jpg'), {
    getProvider: async () => ({
      getObject: async () => stored,
    }),
    fetchImpl: async () => {
      throw new Error('source URL should not be fetched when the stored object is readable');
    },
  });
  assert.equal(fromStore.equals(stored), true);

  const fromSource = await readLibraryCoverBuffer(coverAsset('https://cdn.example.com/cover.jpg'), {
    getProvider: async () => ({
      getObject: async () => {
        throw new Error('ENOENT');
      },
    }),
    fetchImpl: async () => new Response(remote, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
  });
  assert.equal(fromSource.equals(remote), true);
});

test('missing stored cover without a usable source URL stays a read failure', async () => {
  await assert.rejects(
    () => readLibraryCoverBuffer(coverAsset(), {
      getProvider: async () => ({
        getObject: async () => {
          throw new Error('ENOENT');
        },
      }),
    }),
    /ENOENT/,
  );

  await assert.rejects(
    () => readLibraryCoverBuffer(coverAsset('https://cdn.example.com/cover.jpg'), {
      getProvider: async () => ({
        getObject: async () => {
          throw new Error('ENOENT');
        },
      }),
      fetchImpl: async () => new Response('missing', { status: 404 }),
    }),
    /ENOENT/,
  );
});
