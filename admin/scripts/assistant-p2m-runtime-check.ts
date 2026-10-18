/** Read-only development health/configuration check; credentials never leave this process. */
import { loadEnvConfig } from '@next/env';
import { getPlatformLlmRuntimeConfig } from '@/lib/platform-llm-config';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
loadEnvConfig(process.cwd(), true);
async function main() {
  const database = new URL(resolvePostgresRuntimeConfig().connectionString);
  if (!['localhost','127.0.0.1'].includes(database.hostname) || database.port !== '5432' || database.pathname !== '/smart_floor_planner') throw Error('Development database required');
  const config = await getPlatformLlmRuntimeConfig();
  if (!process.env.CRON_SECRET) throw Error('Worker credential missing');
  const response = await fetch('http://localhost:3006/api/internal/assistant/jobs/run', {
    headers: { 'x-cron-secret': process.env.CRON_SECRET }, signal: AbortSignal.timeout(60000),
  });
  const health = await response.json();
  if (!response.ok || !health.success) throw Error('Development worker health unavailable');
  console.log(JSON.stringify({ httpStatus: response.status, provider: config.providerKey, configuredModel: config.model,
    assistantModel: process.env.ASSISTANT_TEXT_MODEL, disableThinking: process.env.ASSISTANT_TEXT_DISABLE_THINKING === '1', worker: health.data?.worker }));
}
main().catch(() => { console.error('Development runtime verification failed'); process.exitCode = 1; }).finally(closePostgresPool);
