import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantDailyLimitsEnabled } from '../core/daily-limits';
import { assistantWritesEnabled } from '@/db/repositories/assistant-repository';

test('daily limits stay disabled unless explicitly enabled', () => {
  assert.equal(assistantDailyLimitsEnabled({}), false);
  assert.equal(assistantDailyLimitsEnabled({ ASSISTANT_DAILY_LIMITS_ENABLED: '0' }), false);
  assert.equal(assistantDailyLimitsEnabled({ ASSISTANT_DAILY_LIMITS_ENABLED: '1' }), true);
});

test('disabled daily limits accept zero ceilings while retaining assistant enablement and retention', () => {
  const previous = process.env.ASSISTANT_DAILY_LIMITS_ENABLED;
  try {
    delete process.env.ASSISTANT_DAILY_LIMITS_ENABLED;
    const settings = { enabled: true, retention_days: 30, daily_requests: 0, daily_tokens: 0, daily_cost_micros: 0 };
    assert.equal(assistantWritesEnabled(settings), true);
    assert.equal(assistantWritesEnabled({ ...settings, enabled: false }), false);
    assert.equal(assistantWritesEnabled({ ...settings, retention_days: 0 }), false);
    assert.equal(assistantWritesEnabled(undefined), false);
    process.env.ASSISTANT_DAILY_LIMITS_ENABLED = '1';
    assert.equal(assistantWritesEnabled(settings), false);
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_DAILY_LIMITS_ENABLED;
    else process.env.ASSISTANT_DAILY_LIMITS_ENABLED = previous;
  }
});
