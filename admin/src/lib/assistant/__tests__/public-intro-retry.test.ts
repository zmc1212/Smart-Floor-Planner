import test from 'node:test';
import assert from 'node:assert/strict';
import { publicIntroEntryDecision } from '@/lib/construction/public-customer';

test('a succeeded opening retry keeps the visited version on existing', () => {
  assert.equal(publicIntroEntryDecision({ attempts: 2 }, 'succeeded'), 'existing');
  assert.equal(publicIntroEntryDecision({ attempts: 1 }, 'succeeded'), 'existing');
  assert.equal(publicIntroEntryDecision({ attempts: 2 }, 'queued'), 'existing');
  assert.equal(publicIntroEntryDecision({ attempts: 2 }, 'running'), 'existing');
  // The marker's run may already be gone; the entry still reuses it.
  assert.equal(publicIntroEntryDecision({ attempts: 2 }, undefined), 'existing');
});

test('a second failed opening retry is unavailable', () => {
  assert.equal(publicIntroEntryDecision({ attempts: 2 }, 'failed'), 'unavailable');
  assert.equal(publicIntroEntryDecision({ attempts: 3 }, 'cancelled'), 'unavailable');
});

test('the first failed opening may be regenerated on a later entry', () => {
  assert.equal(publicIntroEntryDecision({ attempts: 1 }, 'failed'), 'new');
  assert.equal(publicIntroEntryDecision({ attempts: 1 }, 'cancelled'), 'new');
  assert.equal(publicIntroEntryDecision({}, 'failed'), 'new');
});
