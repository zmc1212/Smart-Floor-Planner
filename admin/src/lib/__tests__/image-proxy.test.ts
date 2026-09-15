import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import {
  assertAllowedImageContentType,
  assertSafeRemoteImageUrl,
} from '@/lib/ai/image-proxy';
import { GET as imageProxy } from '@/app/api/ai/image-proxy/route';

const route = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/ai/image-proxy/route.ts'),
  'utf8'
);

test('image proxy rejects private and credential-bearing targets', async () => {
  await assert.rejects(() => assertSafeRemoteImageUrl('http://127.0.0.1/image.png'), /Private image host/);
  await assert.rejects(() => assertSafeRemoteImageUrl('http://169.254.169.254/latest/meta-data/'), /Private image host/);
  await assert.rejects(() => assertSafeRemoteImageUrl('http://localhost/image.png'), /Private image host/);
  await assert.rejects(() => assertSafeRemoteImageUrl('https://user:pass@8.8.8.8/image.png'), /credentials/);
});

test('image proxy accepts public IP targets and only image content types', async () => {
  assert.equal((await assertSafeRemoteImageUrl('https://8.8.8.8/image.png')).hostname, '8.8.8.8');
  assert.equal(assertAllowedImageContentType('image/png; charset=binary'), 'image/png');
  assert.throws(() => assertAllowedImageContentType('text/html'), /allowed image/);
});

test('image proxy enforces the Admin AI boundary and safe response policy', () => {
  assert.match(route, /withTenantRoute\(/);
  assert.match(route, /getEffectivePermissions/);
  assert.match(route, /redirect: 'manual'/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
  assert.match(route, /readBoundedImageBody/);
});

test('image proxy rejects anonymous callers before fetching a target', async () => {
  const response = await imageProxy(new Request('http://localhost/api/ai/image-proxy?url=https%3A%2F%2F8.8.8.8%2Fimage.png'));
  assert.equal(response.status, 401);
});
