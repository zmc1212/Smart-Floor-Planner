import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadAssistantWorkerConfig } from './assistant-worker-health.mjs';

const { endpoint, preflightEndpoint, secret, healthFile } = loadAssistantWorkerConfig();

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

const health = {
  workerPid: process.pid,
  lastRequestAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
  lastHttpStatus: null,
  lastErrorCode: null,
  safetyGate: null,
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

function recordSuccess() {
  health.lastSuccessAt = Date.now();
  health.consecutiveFailures = 0;
  health.lastErrorCode = null;
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
    return { status: null, errorCode: 'endpoint_unreachable', gate: null };
  }

  const status = response.status;
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { status, errorCode: httpErrors.get(status) ?? 'job_execution_failed', gate: null };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    // A successful tick requires a valid acknowledgement. Keep raw responses out of diagnostics.
    return { status, errorCode: 'job_execution_failed', gate: null };
  }
  if (payload?.success !== true) {
    return { status, errorCode: 'job_execution_failed', gate: null };
  }
  return { status, errorCode: null, gate: sanitizeGate(payload?.data?.workerSafetyGate) };
}

/** The Worker must refuse to run business tasks unless the server opens the
 * reminder and weekly-report deployment gate. The server re-evaluates the
 * saved platform switch on every tick, so a super admin can start or stop the
 * Worker from the admin UI without a container restart. */
function sanitizeGate(gate) {
  if (!gate || (gate.status !== 'open' && gate.status !== 'closed')) return null;
  return {
    status: gate.status,
    reason: typeof gate.reason === 'string' ? gate.reason : null,
    deliveryScope: typeof gate.deliveryScope === 'string' ? gate.deliveryScope : 'none',
    mode: gate.mode === 'enterprise' || gate.mode === 'pilot' ? gate.mode : null,
    enterpriseId: typeof gate.enterpriseId === 'string' ? gate.enterpriseId : null,
    pilotId: typeof gate.pilotId === 'string' ? gate.pilotId : null,
  };
}

async function requestPreflight() {
  let response;
  try {
    response = await fetch(preflightEndpoint, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return { errorCode: 'preflight_unavailable' };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { errorCode: response.status === 401 ? 'unauthorized' : 'preflight_unavailable' };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { errorCode: 'safety_gate_invalid' };
  }
  if (payload?.success !== true) return { errorCode: 'safety_gate_invalid' };
  const gate = sanitizeGate(payload?.data?.safetyGate);
  if (!gate || !gate.reason) return { errorCode: 'safety_gate_invalid' };
  return { gate };
}

/** The Worker stays resident while the gate is closed. A closed gate is the
 * normal idle state of an installed Worker: the platform switch is off, or the
 * pilot scope is not configured yet. Only an unreachable or invalid preflight
 * or a missing secret stops the process, so a configuration mistake is visible
 * instead of being retried forever. */
async function idleLoop() {
  while (!stopping) {
    const preflight = await requestPreflight();
    if (preflight.errorCode) {
      health.lastHttpStatus = null;
      recordFailure(preflight.errorCode);
      await saveHealth();
      if (!stopping) await delay(5000);
      continue;
    }
    health.safetyGate = preflight.gate;
    health.consecutiveFailures = 0;
    health.lastErrorCode = null;
    await saveHealth();
    console.error('[assistant-worker] safety_gate', JSON.stringify(preflight.gate));
    if (preflight.gate.status === 'open') return true;
    if (!stopping) await delay(5000);
  }
  return false;
}

async function runLoop() {
  while (!stopping) {
    if (health.safetyGate?.status !== 'open') {
      const opened = await idleLoop();
      if (!opened) break;
      continue;
    }
    health.lastRequestAt = Date.now();
    await saveHealth();
    if (stopping) break;
    const { status, errorCode, gate } = await requestTick();
    health.lastHttpStatus = status;
    if (gate) health.safetyGate = gate;
    if (errorCode) {
      recordFailure(errorCode);
    } else {
      recordSuccess();
    }
    await saveHealth();
    if (!stopping) await delay(2000);
  }
}

// A waiting Weixin long poll must not hold up regular model jobs, reminders or reports.
async function runWechatLoop() {
  const channelEndpoint = new URL(endpoint);
  if (!channelEndpoint.pathname.endsWith('/jobs/run')) return;
  channelEndpoint.pathname = channelEndpoint.pathname.replace(/\/run$/, '/wechat');
  while (!stopping) {
    let active = false;
    if (health.safetyGate?.status === 'open') {
      try {
        const response = await fetch(channelEndpoint, { method: 'POST', headers: { 'x-cron-secret': secret },
          signal: AbortSignal.timeout(120000) });
        if (response.ok) active = (await response.json()).active === true;
        else { await response.body?.cancel(); console.error('[assistant-worker] wechat_endpoint_unavailable', response.status); }
      } catch { console.error('[assistant-worker] wechat_endpoint_unreachable'); }
    }
    if (!stopping) await delay(active ? 1100 : 5000);
  }
}

// A recreated worker must report its own preflight and tick. A recent reply
// from the previous container can still be present on the shared volume.
await saveHealth();
if (!secret?.trim()) {
  health.lastHttpStatus = null;
  recordFailure('missing_secret');
  await saveHealth();
  process.exitCode = 1;
} else {
  const preflight = await requestPreflight();
  if (preflight.errorCode) {
    health.lastHttpStatus = null;
    recordFailure(preflight.errorCode);
    await saveHealth();
    process.exitCode = 1;
  } else {
    health.safetyGate = preflight.gate;
    console.error('[assistant-worker] safety_gate', JSON.stringify(preflight.gate));
    await saveHealth();
    // Installed but maybe idle: runLoop waits on the gate and re-checks it
    // before every tick, so an admin start/stop needs no container restart.
    await Promise.all([runLoop(), runWechatLoop()]);
  }
}
