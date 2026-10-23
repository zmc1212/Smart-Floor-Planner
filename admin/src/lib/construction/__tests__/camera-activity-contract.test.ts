import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordingActivity, recordingActivityDetail } from '../camera-activity-contract';

const row = { id: '9007199254740993', created_at: new Date('2026-10-23T09:00:00.123Z'), actor_ref: { kind: 'admin', id: 'private-admin-id' }, action: 'camera.recording.configure', snapshot: { enabled: true, retentionDays: 3, secret: 'never-return-this' } };
test('policy intent preserves exact IDs and timestamp while exposing only safe fields', () => {
  const item = recordingActivity(row)!;
  assert.equal(item.id, '9007199254740993'); assert.equal(item.createdAt, '2026-10-23T09:00:00.123Z');
  assert.equal(recordingActivityDetail(item), '连续录像开启；保留 3 天');
  assert.equal(JSON.stringify(item).includes('private-admin-id'), false); assert.equal(JSON.stringify(item).includes('never-return-this'), false);
});
test('unknown and malformed historical fields stay unknown instead of implying a stopped recorder', () => {
  const item = recordingActivity({ ...row, actor_ref: null, snapshot: { enabled: 'false', retentionDays: 0 } })!;
  assert.equal(item.actor, 'unknown'); assert.equal(item.enabled, null); assert.equal(item.retentionDays, null);
  assert.equal(recordingActivityDetail(item), '开启状态未记录；保留天数未记录');
  assert.equal(recordingActivity({ ...row, action: 'camera.private-debug' }), null);
});
test('storage records whitelist reasons and bounded measurements without asserting actual recorder actions', () => {
  const item = recordingActivity({ ...row, action: 'camera.storage.blocked', actor_ref: { kind: 'system' }, snapshot: { reason: 'camera_storage_low', usedPercent: 95.12, enabled: true, retentionDays: 3 } })!;
  assert.equal(item.enabled, null); assert.equal(item.retentionDays, null); assert.equal(item.actor, 'system');
  assert.equal(recordingActivityDetail(item), '空间低于保护阈值；当时已用 95.1%');
  const invalid = recordingActivity({ ...row, action: 'camera.storage.unavailable', snapshot: { reason: 'https://private.example/secret', usedPercent: Infinity } })!;
  assert.equal(invalid.reason, null); assert.equal(invalid.usedPercent, null); assert.equal(recordingActivityDetail(invalid), '原因未记录');
  const unavailable = recordingActivity({ ...row, action: 'camera.storage.unavailable', snapshot: { reason: 'camera_storage_unavailable', usedPercent: 88 } })!;
  assert.equal(recordingActivityDetail(unavailable), '暂时无法确认存储容量；最近已知已用 88.0%');
});
