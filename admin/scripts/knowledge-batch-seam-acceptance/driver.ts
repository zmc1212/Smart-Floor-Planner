import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPair } from './process-pair.mjs';
import { createOfflineStore } from './offline-store';
import { assertTwoProcesses, assertSameItemOnce, assertCancellationFence, assertRecovered, assertConfigurationRejected } from './assertions.mjs';
import type { AcceptanceEvent, AcceptanceFixture } from './types';

if (!process.send) throw Error('SEAM_DRIVER_IPC_REQUIRED');
let closing = false, activePair: ReturnType<typeof createPair> | undefined;
process.once('disconnect', () => {
  if (closing) return;
  // Parent owned the acceptance lock. Stop only these children; do not clean fixtures after losing that lock.
  for (const child of activePair?.processes ?? []) if (child.exitCode === null && !child.signalCode) child.kill();
  process.exit(1);
});
type Config = { mode: 'offline' | 'service'; admin: string; output: string; factoryModule?: string; factoryExport?: string };
type Reply = { error?: string; value?: Record<string, unknown> };
const safeCode = (error: unknown) => {
  const value = (error as { code?: string; message?: string })?.code || (error as Error)?.message || '';
  return /^[a-zA-Z0-9_]{1,100}$/.test(value) ? value : 'SEAM_DRIVER_FAILED';
};
async function run(config: Config) {
  const events: AcceptanceEvent[] = [], cases: Array<Record<string, unknown>> = [];
  let fixture: AcceptanceFixture | undefined, pair: ReturnType<typeof createPair> | undefined;
  const report: Record<string, unknown> = { mode: config.mode, started: new Date().toISOString(), cases,
    reality: config.mode === 'offline' ? 'Two real OS processes, actual adapter, simulated serialized store/shared ports and association repair; not PostgreSQL'
      : 'Two real OS processes, real isolated PostgreSQL and injected business factory; no real external HTTP/Embedding/model calls' };
  const save = () => fs.writeFileSync(path.join(config.output, 'driver-report.json'), JSON.stringify(report, null, 2));
  try {
    if (config.mode === 'service') {
      if (!config.factoryModule || !config.factoryExport || !process.env.XIAOK_SEAM_LOCK_OWNER) throw Error('SEAM_FACTORY_NOT_READY');
      const { createPostgresFixture } = await import('./postgres-fixture');
      fixture = await createPostgresFixture(config.factoryModule, config.factoryExport,
        value => fs.writeFileSync(path.join(config.output, 'fixture-identities-audit.json'), JSON.stringify(value, null, 2)));
    } else fixture = createOfflineStore();
    assert.ok(fixture); const current = fixture;
    pair = createPair({ admin: config.admin, output: config.output, mode: config.mode, env: process.env,
      onBroker: (method: string, input: Record<string, unknown>, owner: number) => {
        if (!current.rpc) throw Error('SEAM_BROKER_NOT_ALLOWED'); return current.rpc(method, input, owner);
      }, onEvent: (event: AcceptanceEvent) => events.push(event) });
    activePair = pair;
    const pids = await pair.ready(); assertTwoProcesses(pids); report.pids = pids;
    process.send!({ type: 'pids', pids });
    const command = async (index: number, action: string, input: Record<string, unknown> = {}, allowFailure = false) => {
      const reply = await pair!.command(index, action, input) as Reply;
      if (reply.error && (!allowFailure || !['batch_cancelled', 'batch_concurrency_limit'].includes(reply.error))) throw Error(reply.error);
      return reply;
    };
    await Promise.all([0, 1].map(index => command(index, 'boot', { actor: current.actor, factoryModule: config.factoryModule, factoryExport: config.factoryExport })));
    const snapshot = async (batchId: string) => {
      const value = await current.snapshot(batchId, events);
      const network = await Promise.all([0, 1].map(index => command(index, 'network')));
      value.providerFetches = network.reduce((n, r) => n + Number(r.value!.providerFetches), 0);
      assert.ok(network.every(r => Number(r.value!.blockedSockets) === 0), 'SEAM_UNEXPECTED_SOCKET');
      return value;
    };
    const record = (name: string, evidence: Record<string, unknown>) => { cases.push({ name, passed: true, ...evidence }); save(); };

    const same = await current.prepare();
    await Promise.all([0, 1].map(index => command(index, 'resume', { evaluationId: same.items[0].evaluationId })));
    const one = await snapshot(same.batchId); assertSameItemOnce(one); record('same-item-two-processes', { after: one });
    await command(0, 'cancel', { batchId: same.batchId, requestKey: 'same-cleanup' });

    const race = await current.prepare(), raceBefore = await snapshot(race.batchId);
    await Promise.all([command(0, 'advance', { batchId: race.batchId }, true), command(1, 'cancel', { batchId: race.batchId, requestKey: 'race-cancel' })]);
    const fenced = await snapshot(race.batchId);
    assert.ok(fenced.counts.runs - raceBefore.counts.runs <= 1); assert.equal(fenced.intentCount, 1);
    await command(0, 'advance', { batchId: race.batchId }, true);
    const late = await snapshot(race.batchId); assertCancellationFence(fenced, late); record('advance-cancel-race-and-late-admission', { before: fenced, after: late });

    const interrupted = await current.prepare();
    await command(0, 'resume', { evaluationId: interrupted.items[0].evaluationId });
    const cancel = await command(1, 'cancel', { batchId: interrupted.batchId, requestKey: 'first-durable-cancel', failCancel: 'true' });
    assert.ok((cancel.value!.items as Array<{ action: string }>).some(i => i.action === 'unconfirmed'));
    const intent = await snapshot(interrupted.batchId);
    await command(0, 'advance', { batchId: interrupted.batchId }, true);
    const blocked = await snapshot(interrupted.batchId); assertCancellationFence(intent, blocked);
    const retried = await command(1, 'cancel', { batchId: interrupted.batchId, requestKey: 'second-client-cancel' });
    assert.equal(retried.value!.requestKey, 'first-durable-cancel'); record('committed-intent-survives-individual-cancel-failure', { before: intent, after: blocked });
    if(current.routeAfterCancellation){
      const prior=await snapshot(interrupted.batchId),route=await current.routeAfterCancellation(interrupted.batchId),now=await snapshot(interrupted.batchId);
      assertCancellationFence(prior,now);record('existing-authenticated-route-uses-shared-factory',{route,before:prior,after:now});
    }

    const lost = await current.prepare(); await command(0, 'resume', { evaluationId: lost.items[0].evaluationId });
    const original = await snapshot(lost.batchId); assert.ok(original.runId && original.conversationId);
    await current.loseAssociation(lost.batchId); const missing = await snapshot(lost.batchId);
    assert.equal(missing.runId, null); assert.equal(missing.runStatus, 'indeterminate'); assert.equal(missing.reservationStatus, 'reconciling');
    await Promise.all([0, 1].map(index => command(index, 'recover', { evaluationId: lost.items[0].evaluationId })));
    const recovered = await snapshot(lost.batchId); assertRecovered(original, missing, recovered);
    record('old-receipt-recovery-no-new-effects', { before: missing, after: recovered,
      providerBoundary: 'explicit synthetic marker; no real original provider HTTP; zero-delta HTTP is not a live retry proof' });
    await command(0, 'cancel', { batchId: lost.batchId, requestKey: 'lost-cleanup' });

    const drift = await current.prepare(), before = await snapshot(drift.batchId);
    const rejected = await command(1, 'drift', { batchId: drift.batchId });
    const after = await snapshot(drift.batchId); assertConfigurationRejected(before, after, rejected.value); record('actual-child-configuration-drift-before-admission', { before, after, rejection: rejected.value });

    if (config.mode === 'service' && current.leaseFor) {
      const queued = await current.prepare(); await command(0, 'resume', { evaluationId: queued.items[0].evaluationId });
      await snapshot(queued.batchId); const lease = await current.leaseFor(queued.batchId), prior = await snapshot(queued.batchId);
      // Lease token remains in memory/IPC only; never store it in the report or logs.
      const result = await command(1, 'provider-drift', { batchId: queued.batchId, lease });
      const now = await snapshot(queued.batchId); assertConfigurationRejected(prior, now, result.value);
      record('provider-start-configuration-drift-before-attempt-marker-http', { before: prior, after: now, rejection: result.value });
      await command(0, 'cancel', { batchId: queued.batchId, requestKey: 'provider-drift-cleanup' });
    } else report.deferred = ['Real PostgreSQL and provider-start gateway require the exact stable business SHA/factory; not executed'];
    assert.equal(current.activeTransactions?.() ?? 0, 0); report.passed = true;
  } catch (error) { report.passed = false; report.errorCode = safeCode(error); }
  finally {
    try { if (pair) await pair.close(); report.childrenStopped = true; } catch (error) { report.passed = false; report.cleanupError = safeCode(error); }
    if (pair && !report.childrenStopped) report.fixtureCleanup = 'pending_until_children_verified_stopped';
    else if (fixture?.cleanup) {
      try { report.fixtureCleanup = await fixture.cleanup(); } catch (error) { report.passed = false; report.cleanupError = safeCode(error); }
    }
    if(config.mode==='service'){
      try{await (await import('../../src/lib/postgresql')).closePostgresPool();}
      catch(error){report.passed=false;report.cleanupError=safeCode(error);}
    }
    report.events = events; report.finished = new Date().toISOString(); save();
  }
  process.send!({ type: 'complete', passed: report.passed, cases: cases.length, errorCode: report.errorCode });
  closing = true; process.disconnect!(); process.exitCode = report.passed ? 0 : 1;
}
process.once('message', (message: { type: string; config: Config }) => {
  if (message.type !== 'start') throw Error('SEAM_DRIVER_BOOT_REQUIRED');
  run(message.config).catch(error => { process.send!({ type: 'complete', passed: false, errorCode: safeCode(error) }); process.disconnect!(); process.exitCode = 1; });
});
