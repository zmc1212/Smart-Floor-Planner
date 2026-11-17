import { assistantAcceptanceTarget } from '../../../scripts/assistant-acceptance-safety.mjs';
import { LOCAL_PGVECTOR } from '@/lib/assistant/knowledge/bailian-provider';

export function xiaokTestDatabase(connectionString = process.env.DATABASE_URL ?? '') {
  return assistantAcceptanceTarget(connectionString, process.env.XIAOK_ISOLATED_POSTGRES_PORT);
}

export function useLocalKnowledgeTestDatabase() {
  xiaokTestDatabase();
  process.env.ASSISTANT_KNOWLEDGE_PROVIDER = LOCAL_PGVECTOR;
}
