import assert from 'node:assert/strict';
import { closePostgresPool } from '@/lib/postgresql';
import { createPostgresDurableTaskStore } from '../../live/durable-task-postgres-store';
import { createDurableTaskRuntime } from '../../live/durable-task-runtime';
import { WorkflowOperationError } from '../../errors';
import { createPostgresWorkflowRunStore } from '../../live/runtime-postgres-stores';

async function main() {
  assert.equal(process.env.B511_PG_TEST, '1');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.deepEqual([url.protocol, url.hostname, url.pathname, url.username, url.search, url.hash],
    ['postgresql:', '127.0.0.1', '/xiaok_b511_test', 'sfp_app', '', '']);
  const [action, enterpriseId, id, expected, label] = process.argv.slice(2);
  if (action === 'claim') {
    const runtime = createDurableTaskRuntime({ store: createPostgresDurableTaskStore() });
    const claim = await runtime.claim({ enterpriseId, taskId: id, owner: 'worker-' + process.pid, leaseTtlMs: Number(expected) });
    return { pid: process.pid, lease: claim?.lease ?? null };
  }
  if (action === 'run-update') {
    const store = createPostgresWorkflowRunStore(enterpriseId);
    try {
      const record = await store.get(id);
      assert.ok(record);
      const result = await store.update({
        ...record, storeRevision: Number(expected),
        state: { ...record.state, outcome: label },
      });
      return { pid: process.pid, revision: result.storeRevision, outcome: result.state.outcome };
    } catch (error) {
      return { pid: process.pid, error: error instanceof WorkflowOperationError ? error.code : 'database_unavailable' };
    }
  }
  if (action === 'schedule') {
    const { runNativeWorkflowScheduleTick } = await import('../../live/period-report-schedule-runtime');
    return { pid: process.pid, result: await runNativeWorkflowScheduleTick() };
  }
  if (action === 'assistant') {
    const { POST } = await import('@/app/api/internal/assistant/jobs/run/route');
    const response = await POST(new Request('http://127.0.0.1/api/internal/assistant/jobs/run', {
      method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! },
    }));
    return { pid: process.pid, status: response.status, body: await response.json() };
  }
  throw new Error('unknown fixture operation');
}

main().then((result) => console.log('B511 ' + JSON.stringify(result)), (error: unknown) => {
  const cause = error instanceof Error ? error.cause : undefined;
  const details = cause instanceof Error ? cause.message : error instanceof Error && !('query' in error) ? error.message : '';
  console.error(error instanceof WorkflowOperationError ? error.code : 'B511 fixture process failed ' + details);
  process.exitCode = 1;
}).finally(closePostgresPool);
