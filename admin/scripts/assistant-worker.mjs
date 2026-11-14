import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadAssistantWorkerConfig, readAssistantWorkerHealth } from './assistant-worker-health.mjs';

const { endpoint, secret, healthFile } = loadAssistantWorkerConfig();

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

const { health: previous } = await readAssistantWorkerHealth(healthFile);
const health = {
  workerPid: process.pid,
  lastRequestAt: previous?.lastRequestAt ?? null,
  lastSuccessAt: previous?.lastSuccessAt ?? null,
  lastFailureAt: previous?.lastFailureAt ?? null,
  consecutiveFailures: previous?.consecutiveFailures ?? 0,
  lastHttpStatus: previous?.lastHttpStatus ?? null,
  lastErrorCode: previous?.lastErrorCode ?? null,
};
const temporaryHealthFile = `${healthFile}.${randomUUID()}.tmp`;

async function saveHealth() {
  try {
    await writeFile(temporaryHealthFile, JSON.stringify(health));
    await rename(temporaryHealthFile, healthFile);
  } catch {
    await unlink(temporaryHealthFile).catch(() => {});
    console.error('[assistant-worker] health_file_unavailable');
  }
}

function recordFailure(errorCode) {
  health.lastFailureAt = Date.now();
  health.consecutiveFailures = Math.min(health.consecutiveFailures + 1, Number.MAX_SAFE_INTEGER);
  health.lastErrorCode = errorCode;
  console.error('[assistant-worker]', JSON.stringify({
    errorCode, at: health.lastFailureAt, httpStatus: health.lastHttpStatus,
  }));
}

const httpErrors = new Map([
  [401, 'unauthorized'],
  [422, 'invalid_request'],
  [503, 'worker_unavailable'],
]);

async function requestTick() {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    return { status: null, errorCode: 'endpoint_unreachable' };
  }

  const status = response.status;
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { status, errorCode: httpErrors.get(status) ?? 'job_execution_failed' };
  }
  try {
    if ((await response.json())?.success === true) return { status, errorCode: null };
  } catch {
    // A successful tick requires a valid acknowledgement. Keep raw responses out of diagnostics.
  }
  return { status, errorCode: 'job_execution_failed' };
}

if (!secret?.trim()) {
  health.lastHttpStatus = null;
  recordFailure('missing_secret');
  await saveHealth();
  process.exitCode = 1;
} else {
  while (!stopping) {
    health.lastRequestAt = Date.now();
    await saveHealth();
    if (stopping) break;
    const { status, errorCode } = await requestTick();
    health.lastHttpStatus = status;
    if (errorCode) {
      recordFailure(errorCode);
    } else {
      health.lastSuccessAt = Date.now();
      health.consecutiveFailures = 0;
      health.lastErrorCode = null;
    }
    await saveHealth();
    if (!stopping) await delay(2000);
  }
}
