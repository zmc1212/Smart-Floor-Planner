import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '../src/db/transaction';
import { rows } from '../src/db/repositories/assistant-repository';
import { closePostgresPool } from '../src/lib/postgresql';
import { getPlatformLlmOverrideRuntime } from '../src/lib/platform-llm-config';
import { getAiProviderAdapter, listProviderRuntimes } from '../src/lib/ai/provider-registry';
import { embeddingGateway, EMBEDDING_PROFILE } from '../src/lib/assistant/infrastructure/embedding-gateway';

async function main() {
  loadEnvConfig(process.cwd());
  const database = await withPlatformTransaction(async tx => ({
    version: await rows(tx, sql`select current_setting('server_version') as version`),
    vector: await rows(tx, sql`select name,default_version,installed_version from pg_available_extensions where name='vector'`),
    chinese: await rows(tx, sql`select to_tsvector('simple','旧房改造服务包含水电改造') @@ plainto_tsquery('simple','水电') as substring_recalled`),
    rls: await rows(tx, sql`select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and (relname like 'assistant_%' or relname in ('domain_event_outbox','domain_event_deliveries')) and relkind='r'`),
  }));
  const override = await getPlatformLlmOverrideRuntime();
  const runtimes = override ? [override] : await listProviderRuntimes('chat', 'chat.general');
  const text: Record<string, unknown> = { configured: runtimes.length > 0, override: Boolean(override), streaming: false, usage: 'unavailable' };
  if (process.argv.includes('--text') && runtimes[0]) {
    try {
      const reply = await getAiProviderAdapter(runtimes[0].adapterType).chat(runtimes[0], { model: runtimes[0].modelMappings['chat.general']!,
        messages: [{ role: 'user', content: '仅回复：收到' }], maxTokens: 16 });
      text.smoke = reply.trim().length > 0 ? 'passed' : 'empty_response';
    } catch { text.smoke = 'failed'; }
  }
  const embedding: Record<string, unknown> = { configured: Boolean(process.env.ASSISTANT_EMBEDDING_URL && process.env.ASSISTANT_EMBEDDING_API_KEY), profile: EMBEDDING_PROFILE };
  if (process.argv.includes('--embedding')) {
    try {
      const result = await embeddingGateway().embed(['旧房水电改造包含哪些服务？'], 'query');
      embedding.smoke = 'passed'; embedding.dimensions = result.vectors[0].length; embedding.usage = result.usage;
    } catch { embedding.smoke = 'failed'; process.exitCode = 1; }
  }
  console.log(JSON.stringify({ database, text, embedding,
    deployment: { workerProfile: 'assistant', enabledByDefault: false }, backupVectorCompatibility: database.vector.length ? 'requires_restore_drill' : 'blocked_vector_extension_unavailable' }, null, 2));
}
main().catch(() => { console.error('assistant_dependency_check_failed'); process.exitCode = 1; }).finally(closePostgresPool);
