import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupTime, recordingCleanup } from '../camera-cleanup-contract';

const record = { id: '42', started_at: '2026-10-23T00:00:00.123Z', ended_at: new Date('2026-10-23T00:10:00.456Z'), bytes: '9223372036854775807', state: 'deleting', deleted_at: null, last_error: null };
test('cleanup disclosure keeps exact bytes/times and removes private metadata and arbitrary failures', () => {
  const result = recordingCleanup({ ...record, last_error: 'password=private /opt/media/secret.mp4', source_id: 123, file_path: '/opt/media/secret.mp4' });
  assert.deepEqual(result, { id: '42', startedAt: '2026-10-23T00:00:00.123Z', endedAt: '2026-10-23T00:10:00.456Z', bytes: '9223372036854775807', state: 'deleting', deletedAt: null, failure: 'retry_pending' });
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(recordingCleanup({ ...record, last_error: 'camera_recording_conflict' }).failure, 'identity_conflict');
  assert.equal(recordingCleanup({ ...record, last_error: 'camera_recording_delete_unconfirmed' }).failure, 'delete_unconfirmed');
});
test('old errors do not turn completed/missing rows into retries or fabricate completion times', () => {
  for (const state of ['deleted', 'missing']) {
    const result = recordingCleanup({ ...record, state, last_error: 'stale', deleted_at: 'invalid' });
    assert.equal(result.failure, null); assert.equal(result.deletedAt, null);
  }
  assert.equal(recordingCleanup({ ...record, state: 'deleted', deleted_at: '2026-10-23T01:00:00.123Z' }).deletedAt, '2026-10-23T01:00:00.123Z');
  assert.equal(recordingCleanup({ ...record, state: 'missing', deleted_at: '2026-10-23T01:00:00.123Z' }).deletedAt, null);
  assert.equal(cleanupTime(null), '未记录'); assert.match(cleanupTime('2026-10-22T23:59:59Z'), /2026\/10\/23.*07:59:59/);
});
