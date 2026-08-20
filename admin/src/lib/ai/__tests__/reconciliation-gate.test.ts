import assert from 'node:assert/strict';
import test from 'node:test';
import { createReconciliationGate } from '../reconciliation-gate';

test('reconciliation gate shares concurrent work for one tenant', async () => {
  const gate = createReconciliationGate();
  let calls = 0;
  let release!: (value: number) => void;
  const work = () => {
    calls += 1;
    return new Promise<number>((resolve) => { release = resolve; });
  };
  const first = gate.run('tenant:1', work);
  const second = gate.run('tenant:1', work);
  await Promise.resolve();
  assert.equal(calls, 1);
  release(3);
  assert.deepEqual(await Promise.all([first, second]), [3, 3]);
});

test('reconciliation gate briefly reuses a completed tenant result', async () => {
  let time = 1_000;
  const gate = createReconciliationGate({ cooldownMs: 1_000, now: () => time });
  let calls = 0;
  const work = async () => ++calls;
  assert.equal(await gate.run('tenant:1', work), 1);
  time += 999;
  assert.equal(await gate.run('tenant:1', work), 1);
  assert.equal(calls, 1);
  time += 1;
  assert.equal(await gate.run('tenant:1', work), 2);
});
