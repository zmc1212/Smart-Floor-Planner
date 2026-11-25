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

/** Read the platform-owned mapping and public prompt config in one platform
 * transaction. A missing mapping fails closed, which keeps a misconfigured
 * deployment on the existing scan-code path. */
export async function readPublicAssistantScope(tx: PostgresTransaction): Promise<PublicAssistantScope | null> {
  try {
    const mapping = await one<{ enterprise_id: string }>(tx, sql`select l.enterprise_id::text
      from app.assistant_public_agent_library l
      join app.enterprises e on e.id=l.enterprise_id and e.status='active'
      where l.singleton=true limit 1`);
    if (!mapping) return null;
    const config = await readPublicXiaokConfig(tx);
    return { enterpriseId: String(mapping.enterprise_id), config };
  } catch (error) {
    // Older development databases may not have the optional public mapping
    // migration yet. Do not turn that into a public tenant or a broad query.
    if ((error as { code?: string })?.code === '42P01') return null;
    throw error;
  }
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
