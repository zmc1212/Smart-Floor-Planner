import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = fileURLToPath(new URL('../', import.meta.url));
const errorCodes = new Set([
  'missing_secret',
  'preflight_unavailable',
  'safety_gate_closed',
  'safety_gate_invalid',
  'endpoint_unreachable',
  'unauthorized',
  'invalid_request',
  'worker_unavailable',
  'job_execution_failed',
  'health_file_unavailable',
]);

const gateStatuses = new Set(['open', 'closed']);
const gateModes = new Set(['enterprise', 'pilot', null]);

function preflightEndpointFor(endpoint) {
  return endpoint.replace(/\/run(?=$|[?#])/u, '/preflight');
}

export function loadAssistantWorkerConfig() {
  // Match next dev; explicitly supplied container environment still wins.
  nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== 'production', {
    info() {},
    error() { console.error('[assistant-worker] environment_load_failed'); },
  });
  const endpoint = process.env.ASSISTANT_WORKER_ENDPOINT || 'http://localhost:3006/api/internal/assistant/jobs/run';
  return {
    endpoint,
    preflightEndpoint: process.env.ASSISTANT_WORKER_PREFLIGHT_ENDPOINT || preflightEndpointFor(endpoint),
    secret: process.env.CRON_SECRET,
    healthFile: process.env.ASSISTANT_WORKER_HEALTH_FILE || path.join(tmpdir(), 'assistant-worker-health.json'),
  };
}

const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0 ? value : null;

export async function readAssistantWorkerHealth(healthFile) {
  let raw;
  try {
    raw = await readFile(healthFile, 'utf8');
  } catch (error) {
    return { fileError: error.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }

  try {
    const data = JSON.parse(raw);
    const lastSuccessAt = positiveInteger(data?.lastSuccessAt);
    const workerPid = positiveInteger(data?.workerPid);
    if (lastSuccessAt === null && workerPid === null) return { fileError: 'invalid' };
    const httpStatus = positiveInteger(data.lastHttpStatus);
    const failures = data.consecutiveFailures;
    const gate = data?.safetyGate;
    const safetyGate = gate && gateStatuses.has(gate.status)
      ? {
          status: gate.status,
          reason: typeof gate.reason === 'string' ? gate.reason.slice(0, 64) : null,
          deliveryScope: ['pilot', 'enterprise', 'none'].includes(gate.deliveryScope) ? gate.deliveryScope : null,
          mode: gateModes.has(gate.mode) ? gate.mode : null,
          enterpriseId: typeof gate.enterpriseId === 'string' ? gate.enterpriseId : null,
          pilotId: typeof gate.pilotId === 'string' ? gate.pilotId : null,
        }
      : null;
    return {
      health: {
        workerPid,
        lastRequestAt: positiveInteger(data.lastRequestAt),
        lastSuccessAt,
        lastFailureAt: positiveInteger(data.lastFailureAt),
        consecutiveFailures: Number.isSafeInteger(failures) && failures >= 0 ? failures : null,
        lastHttpStatus: httpStatus >= 100 && httpStatus < 600 ? httpStatus : null,
        lastErrorCode: errorCodes.has(data.lastErrorCode) ? data.lastErrorCode : null,
        safetyGate,
      },
    };
  } catch {
    return { fileError: 'invalid' };
  }
}
