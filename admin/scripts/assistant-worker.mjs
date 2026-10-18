import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

// Match `next dev` locally; explicitly supplied container environment still wins.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== 'production');

const endpoint = process.env.ASSISTANT_WORKER_ENDPOINT || 'http://localhost:3006/api/internal/assistant/jobs/run';
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error('CRON_SECRET is required');
const healthFile = process.env.ASSISTANT_WORKER_HEALTH_FILE || path.join(tmpdir(), 'assistant-worker-health.json');
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
while (!stopping) {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'x-cron-secret': secret }, signal: AbortSignal.timeout(180000) });
    if (!response.ok || !(await response.json()).success) throw new Error('worker_request_failed');
    await writeFile(healthFile, JSON.stringify({ lastSuccessAt: Date.now() }));
  } catch { console.error('[assistant-worker] request failed; persisted jobs recover by lease'); }
  if (!stopping) await delay(2000);
}
