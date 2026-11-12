import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runNativeWorkflowScheduleTick } from '../live/period-report-schedule-runtime';

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...values };
}

async function emptyRoot() {
  return mkdtemp(path.join(tmpdir(), 'sfp-schedule-runtime-'));
}

test('a disabled flag returns before any store, database or dispatch work', async () => {
  const dir = await emptyRoot();
  const result = await runNativeWorkflowScheduleTick(env({
    NATIVE_WORKFLOW_SCHEDULE_ENABLED: '0',
    NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS: '1454',
    NATIVE_WORKFLOW_SCHEDULE_DIR: dir,
  }));
  assert.deepEqual(result, { enabled: false, reason: 'disabled' });
  assert.equal(existsSync(path.join(dir, 'runs')), false);
  assert.equal(existsSync(path.join(dir, 'control')), false);
});

test('an enabled flag without an allowlist performs no business work', async () => {
  const dir = await emptyRoot();
  const result = await runNativeWorkflowScheduleTick(env({
    NATIVE_WORKFLOW_SCHEDULE_ENABLED: '1',
    NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS: ' , ',
    NATIVE_WORKFLOW_SCHEDULE_DIR: dir,
  }));
  assert.deepEqual(result, { enabled: false, reason: 'no_enterprise_scope' });
  assert.equal(existsSync(path.join(dir, 'runs')), false);
});

test('an allowlist containing only invalid ids is not widened', async () => {
  const dir = await emptyRoot();
  const result = await runNativeWorkflowScheduleTick(env({
    NATIVE_WORKFLOW_SCHEDULE_ENABLED: 'true',
    NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS: 'abc,0,-1,1454x',
    NATIVE_WORKFLOW_SCHEDULE_DIR: dir,
  }));
  assert.deepEqual(result, { enabled: false, reason: 'no_enterprise_scope' });
  assert.equal(existsSync(path.join(dir, 'runs')), false);
});
