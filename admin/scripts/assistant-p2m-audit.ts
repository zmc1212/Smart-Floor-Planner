/** Read-only configuration audit. Never prints credentials or customer content. */
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { getPlatformLlmConfig } from '@/lib/platform-llm-config';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
async function main() {
  const config = await getPlatformLlmConfig();
  const providers = await withPlatformTransaction(tx => rows(tx, sql`select id::text,key,adapter_type,enabled,capabilities,model_mappings,
    (coalesce(api_key_encrypted,'')<>'') as has_credential from app.ai_provider_configs order by id`));
  console.log(JSON.stringify({ scope: 'read-only; configured capability is not a live probe',
    chat: { enabled: config.enabled, providerKey: config.providerKey, model: process.env.ASSISTANT_TEXT_MODEL || config.model,
      available: config.available, disableThinking: process.env.ASSISTANT_TEXT_DISABLE_THINKING === '1' }, providers }, null, 2));
}
main().catch(() => { console.error('P2M configuration audit failed; inspect connectivity/schema without logging credentials'); process.exitCode = 1; })
  .finally(closePostgresPool);
