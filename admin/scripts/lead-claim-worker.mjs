const endpoint = process.env.LEAD_CLAIM_WORKER_ENDPOINT?.trim()
  || 'http://admin:3005/api/internal/lead-claim-windows/run';
const secret = process.env.CRON_SECRET?.trim();
const intervalMs = 2_000;

if (!secret) {
  throw new Error('CRON_SECRET is required for the lead claim worker');
}

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

while (!stopping) {
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const message = await response.text();
      console.error(`[lead-claim-worker] ${response.status} ${message.slice(0, 500)}`);
    }
  } catch (error) {
    console.error('[lead-claim-worker] scan failed', error);
  }
  const remaining = Math.max(0, intervalMs - (Date.now() - startedAt));
  if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
}
