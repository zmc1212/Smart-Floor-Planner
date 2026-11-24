import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { assistantAcceptanceTarget } from '../../../scripts/assistant-acceptance-safety.mjs';
import { LOCAL_PGVECTOR } from '@/lib/assistant/knowledge/bailian-provider';

let environmentLoaded = false;
const EMBEDDING_KEYS = ['ASSISTANT_EMBEDDING_PROVIDER', 'ASSISTANT_EMBEDDING_URL', 'ASSISTANT_EMBEDDING_API_KEY',
  'ASSISTANT_EMBEDDING_MODEL', 'ASSISTANT_EMBEDDING_REVISION'] as const;

export function xiaokTestDatabase(connectionString = process.env.DATABASE_URL ?? '') {
  return assistantAcceptanceTarget(connectionString, process.env.XIAOK_ISOLATED_POSTGRES_PORT);
}

export function useLocalKnowledgeTestDatabase() {
  if (!environmentLoaded) {
    // These suites index and search real vectors through the local embedding
    // service. Take only that service configuration from the developer env
    // file; the contract gate keeps injecting DATABASE_URL and every other
    // variable stays untouched.
    try {
      const file = parseEnv(readFileSync('.env.local', 'utf8'));
      for (const key of EMBEDDING_KEYS) if (!process.env[key] && file[key]) process.env[key] = file[key];
    } catch { /* suites with an injected gateway need no file */ }
    environmentLoaded = true;
  }
  xiaokTestDatabase();
  process.env.ASSISTANT_KNOWLEDGE_PROVIDER = LOCAL_PGVECTOR;
}
