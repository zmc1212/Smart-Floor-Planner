import { loadAssistantWorkerConfig, readAssistantWorkerHealth } from './assistant-worker-health.mjs';

function processStatusFor(pid) {
  if (pid === null || pid > 2147483647) return 'unknown';
  try {
    process.kill(pid, 0);
    return 'running';
  } catch (error) {
    return error.code === 'ESRCH' ? 'stopped' : 'unknown';
  }
}

function healthStatus({ health, fileError }) {
  if (!health) {
    return { healthy: false, reason: 'health_file_unavailable', fileError, processStatus: 'unknown', tickStatus: 'unknown', safetyGate: null };
  }

  const processStatus = processStatusFor(health.workerPid);
  const ageMs = health.lastSuccessAt === null ? null : Date.now() - health.lastSuccessAt;
  const diagnostics = { processStatus, ageSeconds: ageMs === null || ageMs < 0 ? null : Math.floor(ageMs / 1000), ...health };
  if (health.lastErrorCode || health.consecutiveFailures) {
    return { ...diagnostics, healthy: false, tickStatus: 'failed', reason: health.lastErrorCode ?? 'job_execution_failed' };
  }
  if (processStatus === 'stopped') {
    return { ...diagnostics, healthy: false, tickStatus: 'failed', reason: 'worker_process_stopped' };
  }
  if (health.safetyGate?.status === 'closed') {
    // A super-admin-configured off switch is a healthy idle container, not a
    // failure. Any other closed gate still needs operator attention.
    if (health.safetyGate.reason === 'worker_disabled') {
      return { ...diagnostics, healthy: true, tickStatus: 'idle', reason: 'worker_disabled' };
    }
    return { ...diagnostics, healthy: false, tickStatus: 'blocked', reason: 'safety_gate_closed' };
  }
  if (ageMs === null) {
    return { ...diagnostics, healthy: false, tickStatus: 'no_success', reason: 'no_successful_tick' };
  }
  if (ageMs < 0) {
    return { ...diagnostics, healthy: false, tickStatus: 'unknown', reason: 'health_file_unavailable', fileError: 'invalid' };
  }
  if (ageMs > 210000) {
    return { ...diagnostics, healthy: false, tickStatus: 'stale', reason: 'heartbeat_stale' };
  }
  if (processStatus === 'stopped') {
    return { ...diagnostics, healthy: false, tickStatus: 'fresh', reason: 'worker_process_stopped' };
  }
  return { ...diagnostics, healthy: true, tickStatus: 'fresh', reason: 'ok' };
}

const { healthFile } = loadAssistantWorkerConfig();
const result = healthStatus(await readAssistantWorkerHealth(healthFile));
if (result.healthy) {
  console.log(JSON.stringify(result));
} else {
  console.error(JSON.stringify(result));
  process.exitCode = 1;
}
