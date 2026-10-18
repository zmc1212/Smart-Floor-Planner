import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  candidateReasons,
  isRetentionEligible,
  isRetentionRedacted,
  parseRetentionCliArgs,
  redactedCitationLocator,
  redactedMessageContent,
  retentionCutoff,
  RETENTION_CITATION_MARKER,
  RETENTION_BATCH_SIZE,
  RETENTION_MARKER,
} from '@/lib/assistant/retention/contract';
import { citationProjection } from '@/lib/assistant/knowledge/sources';

test('retention cutoff is calculated in UTC and rejects disabled values', () => {
  const now = new Date('2026-10-15T00:30:00.000Z');
  assert.equal(retentionCutoff(now, 30).toISOString(), '2026-09-15T00:30:00.000Z');
  assert.throws(() => retentionCutoff(now, 0), /assistant_disabled/);
  assert.throws(() => retentionCutoff(now, 1.5), /assistant_disabled/);
});

test('redaction uses the existing message content contract and carries stable markers', () => {
  const message = redactedMessageContent();
  assert.deepEqual(message.blocks, [{
    type: 'notice',
    code: 'retention_redacted',
    fallbackText: '内容已按保留策略清理',
  }]);
  assert.equal(message.retentionRedacted, true);
  assert.equal(message.marker, RETENTION_MARKER);
  assert.equal(isRetentionRedacted(message), true);
  assert.deepEqual(redactedCitationLocator(), {
    retentionRedacted: true,
    retentionVersion: 1,
    marker: RETENTION_CITATION_MARKER,
  });
});

test('a redacted citation short-circuits before resolving the retained knowledge source', async () => {
  const result = await citationProjection(
    {} as never,
    { enterpriseId: '1', principal: { kind: 'user', userId: '1' }, contextVersion: 1, capabilities: [] },
    {} as never,
    { id: '1', locator: redactedCitationLocator() } as never,
  );
  assert.deepEqual(result, { id: '1', available: false, reason: 'source_unavailable' });
});

test('candidate eligibility exposes every safety blocker without deleting protected data', () => {
  assert.equal(RETENTION_BATCH_SIZE, 100);
  const reasons = candidateReasons({
    activeRun: true,
    activeJob: true,
    activeProviderAttempt: true,
    unknownCost: true,
  });
  assert.deepEqual(reasons, ['active_run', 'active_job', 'active_provider_attempt', 'unknown_cost']);
  assert.equal(isRetentionEligible(reasons), false);
  assert.equal(isRetentionEligible([]), true);
});

test('CLI defaults to dry-run, accepts an injected clock only there, and bounds IDs', () => {
  assert.deepEqual(parseRetentionCliArgs(['--enterprise-id', '12', '--admin-id', '34']), {
    enterpriseId: '12',
    adminId: '34',
    mode: 'dry-run',
    now: undefined,
    afterConversationId: undefined,
  });
  const dryRun = parseRetentionCliArgs([
    '--enterprise-id', '12', '--admin-id', '34', '--now', '2026-10-15T00:00:00Z',
  ]);
  assert.equal(dryRun.now?.toISOString(), '2026-10-15T00:00:00.000Z');
  assert.equal(parseRetentionCliArgs(['--enterprise-id', '12', '--admin-id', '34', '--apply']).mode, 'apply');
  assert.equal(parseRetentionCliArgs([
    '--enterprise-id', '12', '--admin-id', '34', '--after-conversation-id', '56',
  ]).afterConversationId, '56');
  assert.throws(() => parseRetentionCliArgs([
    '--enterprise-id', '12', '--admin-id', '34', '--apply', '--now', '2026-10-15T00:00:00Z',
  ]), /only supported for dry-run/);
  assert.throws(() => parseRetentionCliArgs([
    '--enterprise-id', '9223372036854775808', '--admin-id', '34',
  ]), /positive PostgreSQL bigint/);
  assert.throws(() => parseRetentionCliArgs(['--enterprise-id', '12']), /--admin-id is required/);
});
