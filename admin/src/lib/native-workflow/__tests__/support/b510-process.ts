import { setTimeout as delay } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { NextRequest } from 'next/server';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { GET as construction } from '@/app/api/miniprogram/construction/[[...path]]/route';
import { GET as assistant } from '@/app/api/miniprogram/assistant/[...path]/route';
import { POST as worker } from '@/app/api/internal/assistant/jobs/run/route';
import { closePostgresPool } from '@/lib/postgresql';
import { advanceConstructionReports } from '@/lib/construction/report-worker';
import { createFileWorkflowStore } from '../../store/file-store';
import { createFileWorkflowRunStore } from '../../live/run-store';
import { createFilePeriodReportBatchStore } from '../../live/period-report-batch-store';
import { createFilePeriodReportScheduleStore } from '../../live/period-report-schedule-store';
import { createDatabasePeriodReportScheduleEnvironment } from '../../live/period-report-schedule-ports';
import { runScheduledPeriodReportDispatch } from '../../live/period-report-schedule';
import { scheduleRunId } from '../../live/period-report-schedule-types';
import { runNativeDelegationTick } from '../../live/delegation-worker';
import { createFileDurableTaskStore } from '../../live/durable-task-store';

/** Two isolated HTTP hosts exercise the actual signed Admin route handlers. */
async function serveAdminRoutes() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const [, api, mini, namespace, ...path] = url.pathname.split('/');
      if (request.method !== 'GET' || api !== 'api' || mini !== 'miniprogram' || !['assistant', 'construction'].includes(namespace)) {
        response.writeHead(404).end(); return;
      }
      const input = new NextRequest(url, { headers: { authorization: request.headers.authorization ?? '' } });
      const route = namespace === 'construction' ? construction : assistant;
      const output = await route(input, { params: Promise.resolve({ path }) });
      response.writeHead(output.status, { 'content-type': output.headers.get('content-type') ?? 'application/json' });
      response.end(Buffer.from(await output.arrayBuffer()));
    } catch { response.writeHead(503).end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('HTTP test listener failed');
  process.send?.({ result: { port: address.port, pid: process.pid } });
  await new Promise<void>(resolve => server.once('close', resolve));
}

async function execute() {
  const [action, root, enterpriseId, time, fault] = process.argv.slice(2);
  const now = () => new Date(time);
  if (action === 'admin-http') return serveAdminRoutes();
  if (action === 'claim') return claimJob();
  if (action === 'worker') {
    const result = await worker(new Request('http://localhost/api/internal/assistant/jobs/run', {
      method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
    }));
    const body = await result.json();
    return { status: result.status, code: body.code, claimed: body.data?.claimed };
  }
  if (action === 'delegation') return runNativeDelegationTick();
  if (action === 'legacy') return advanceConstructionReports(now(), enterpriseId);
  if (action === 'task-lease') {
    return createFileDurableTaskStore({ rootDir: root }).acquireLease({
      enterpriseId, taskId: 'b510-lease', owner: String(process.pid), token: String(process.pid),
      now: now(), ttlMs: 60000,
    });
  }
  if (action !== 'schedule') throw Error('Unknown B5.10 process action');
  const definitions = createFileWorkflowStore({ rootDir: join(root, 'definitions') });
  const store = createFilePeriodReportScheduleStore({ rootDir: join(root, 'schedule') });
  const batchStore = createFilePeriodReportBatchStore({ rootDir: join(root, 'batch') });
  const runStore = createFileWorkflowRunStore({ rootDir: join(root, 'run') });
  const environment = createDatabasePeriodReportScheduleEnvironment({
    now, runStore,
    loadPublished: async (input) => {
      const versions = (await definitions.get('period-report-weekly'))?.versions ?? [];
      const published = input ? versions.find(version => version.revision === input.revision) : versions.at(-1);
      if (!published) throw Error('Weekly definition missing in this instance');
      return published;
    },
  });
  const discover = environment.discover;
  if (fault) environment.discover = async (input) => {
    if (input.enterpriseId === enterpriseId.split(',')[0]) {
      if (fault === 'kill') {
        process.send?.({ checkpoint: 'database_claim_committed' });
        await delay(60_000);
      }
      if (fault === 'file') {
        const runId = scheduleRunId(input.enterpriseId, input.period.periodStart);
        await mkdir(join(root, 'schedule', 'runs', runId + '.json'), { recursive: true });
      }
    }
    return discover(input);
  };
  return runScheduledPeriodReportDispatch({ enterpriseIds: enterpriseId.split(','), mode: 'tick' }, {
    store, batchStore, runStore, environment,
  });
}

async function main() {
  try {
    if (process.env.B59_LIVE_DEVELOPMENT !== '1' || process.env.NODE_ENV === 'production' || !process.send)
      throw Error('B5.10 requires the isolated test controller');
    const url = new URL(process.env.DATABASE_URL ?? '');
    const outageTransport = process.argv[2] === 'worker' && process.env.B510_DB_OUTAGE === '1';
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.pathname !== '/xiaok_b59_test'
      || url.username !== 'sfp_app' || url.search || url.hash
      || (!outageTransport && url.port !== (process.env.XIAOK_ISOLATED_POSTGRES_PORT || '55433')))
      throw Error('Unexpected B5.10 database target');
    const result = await execute();
    process.send({ result });
    if (process.env.B510_HOLD_LEASE === '1') await delay(60_000);
  } catch (error) {
    // Error causes can contain queries and credentials. Only pass an error code.
    const code = (error as { code?: string }).code;
    process.send?.({ error: typeof code === 'string' && /^[a-z0-9_]+$/i.test(code) ? code : 'acceptance_child_error' });
    process.exitCode = 1;
  } finally {
    await closePostgresPool();
    if (process.connected) process.disconnect();
  }
}
void main();
