import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { readPublicXiaokConfig, type PublicXiaokConfig } from '../public-config';
import { fail, isPublicAssistantScope, type ActorContext } from '../contracts';

/** The public visitor flow still uses a concrete tenant for PostgreSQL RLS,
 * queue partitioning and composite foreign keys.  It is never exposed as the
 * visitor's enterprise context. */
export const PUBLIC_ASSISTANT_SCOPE = 'public' as const;

export type PublicAssistantScope = {
  enterpriseId: string;
  config: PublicXiaokConfig;
};

/** The runtime role can read this platform-owned mapping and prompt config
 * from either transaction scope. Probe before querying the optional table so
 * older development schemas do not abort the caller's transaction. */
export async function readPublicAssistantScope(tx: PostgresTransaction): Promise<PublicAssistantScope | null> {
  const relation = await one<{ ready: boolean }>(tx,
    sql`select to_regclass('app.assistant_public_agent_library') is not null as ready`);
  if (!relation?.ready) return null;

  const mapping = await one<{ enterprise_id: string }>(tx, sql`select l.enterprise_id::text
    from app.assistant_public_agent_library l
    join app.enterprises e on e.id=l.enterprise_id and e.status='active'
    where l.singleton=true limit 1`);
  if (!mapping) return null;
  const config = await readPublicXiaokConfig(tx);
  return { enterpriseId: String(mapping.enterprise_id), config };
}

export function publicActorEntry(scope: PublicAssistantScope, basis: Record<string, unknown> = {}) {
  return {
    ...basis,
    scope: PUBLIC_ASSISTANT_SCOPE,
    kind: 'public_consultation',
    publicConfigVersion: scope.config.version,
  } satisfies Record<string, unknown>;
}

export function publicActor(identity: { userId: string; contextVersion: number }, scope: PublicAssistantScope,
  basis: Record<string, unknown> = {}): ActorContext {
  return {
    enterpriseId: scope.enterpriseId,
    principal: { kind: 'user', userId: identity.userId },
    contextVersion: identity.contextVersion,
    capabilities: ['assistant.chat.self', 'assistant.chat.public'],
    entry: publicActorEntry(scope, basis),
  };
}

export function assertPrivateScope(actor: ActorContext) {
  if (isPublicAssistantScope(actor)) fail('assistant_capability_forbidden', 403);
}
