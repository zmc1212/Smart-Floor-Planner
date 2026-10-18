import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
try {
  const health = JSON.parse(await readFile(process.env.ASSISTANT_WORKER_HEALTH_FILE || path.join(tmpdir(), 'assistant-worker-health.json'), 'utf8'));
  if (Date.now() - health.lastSuccessAt > 210000) process.exitCode = 1;
} catch { process.exitCode = 1; }
