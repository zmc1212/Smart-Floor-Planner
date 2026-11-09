import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraLocalConfig } from '../construction-camera-local-config.mjs';

const source = 'postgresql://app:private@127.0.0.1:55432/xiaok_embedding_eval';
test('cloud journey isolates database, listeners, build and service origins', () => {
  const { env, appPort } = cameraLocalConfig(source, { WVP_ADMIN_PASSWORD: 'private' }, {
    CAMERA_LOCAL_DATABASE: 'cloud_camera_eval_cloud_20261106',
    CAMERA_APP_ORIGIN: 'http://127.0.0.1:3418', CAMERA_PUBLIC_ORIGIN: 'http://localhost:3417',
    CAMERA_WVP_ORIGIN: 'http://127.0.0.1:38180', CAMERA_MEDIA_ORIGIN: 'http://127.0.0.1:38181', NEXT_DIST_DIR: '.next-camera-cloud',
  });
  assert.equal(new URL(env.DATABASE_URL).pathname, '/cloud_camera_eval_cloud_20261106');
  assert.equal(env.CAMERA_GATEWAY_PORT, '3417'); assert.equal(appPort, '3418');
  assert.equal(env.CAMERA_WVP_ORIGIN, 'http://127.0.0.1:38180');
  assert.equal(env.CAMERA_MEDIA_ORIGIN, 'http://127.0.0.1:38181'); assert.equal(env.NEXT_DIST_DIR, '.next-camera-cloud');
});
test('local default retains the original camera evaluation endpoints', () => {
  const { env, appPort } = cameraLocalConfig(source, {});
  assert.equal(new URL(env.DATABASE_URL).pathname, '/cloud_camera_eval');
  assert.equal(appPort, '3018'); assert.equal(env.CAMERA_GATEWAY_PORT, '3017');
});
test('nonisolated database targets and malformed database names fail before launch', () => {
  for (const url of [source.replace('55432', '5432'), source.replace('127.0.0.1', 'db.example.com')]) assert.throws(() => cameraLocalConfig(url, {}));
  for (const name of ['smart_floor_planner', 'cloud_camera_eval/other', 'cloud_camera_eval?x=y']) assert.throws(() => cameraLocalConfig(source, {}, { CAMERA_LOCAL_DATABASE: name }));
});
test('shared, remote, overlapping listeners and unrelated build outputs are refused', () => {
  for (const origin of ['http://localhost:3006', 'https://example.com:3418', 'http://localhost:3418/api', 'http://localhost:3418?x=y']) assert.throws(() => cameraLocalConfig(source, {}, { CAMERA_APP_ORIGIN: origin }));
  assert.throws(() => cameraLocalConfig(source, {}, { CAMERA_APP_ORIGIN: 'http://127.0.0.1:3017' }));
  assert.throws(() => cameraLocalConfig(source, {}, { NEXT_DIST_DIR: '.next' }));
});
