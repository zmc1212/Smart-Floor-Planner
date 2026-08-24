const endpoint = process.env.LEAD_CLAIM_WORKER_ENDPOINT?.trim()
  || 'http://admin:3005/api/internal/lead-claim-windows/run';
const secret = process.env.CRON_SECRET?.trim();

if (!secret) process.exit(1);

try {
  const response = await fetch(endpoint, {
    headers: { 'x-cron-secret': secret },
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json();
  const lastSucceededAt = payload?.data?.lastSucceededAt;
  const age = lastSucceededAt ? Date.now() - new Date(lastSucceededAt).getTime() : Number.POSITIVE_INFINITY;
  process.exit(response.ok && payload.success && age >= 0 && age <= 15_000 ? 0 : 1);
} catch {
  process.exit(1);
}
