import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, type ActorContext, type Evidence } from '@/lib/assistant/contracts';
import { enterpriseKnowledgeEnabled } from '@/lib/assistant/knowledge-policy';
import { knowledgeContext } from '@/lib/assistant/knowledge/applicability-context';
import { BailianKnowledgeError } from '@/lib/assistant/knowledge/bailian-provider';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { resolveEvidence } from '@/lib/assistant/knowledge/sources';
import { isSuspended, type ReviewDelegation } from './delegation-state';
import { delegationActor, reviewDelegationOrigin } from './delegation-review-store';


type SourceRef = Pick<Evidence, 'ref' | 'hash'>;
type StandardCheck = {
  status: 'sources_found' | 'no_match' | 'disabled' | 'unavailable';
  epoch: number;
  contextHash?: string;
  requestId?: string | null;
  sources?: SourceRef[];
  error?: string;
};

async function settings(tx: PostgresTransaction, enterpriseId: string) {
  return one(tx, sql`select knowledge_epoch,agent_config from app.assistant_enterprise_settings
    where enterprise_id=${enterpriseId} for share`);
}

/** A source lookup records documentation only. The construction review owns
 * the decision about the work, and no private memory is sent to retrieval. */
export async function checkDelegationStandards(tx: PostgresTransaction, d: ReviewDelegation, conversation: Row, signal: AbortSignal): Promise<StandardCheck> {
  const config = await settings(tx, d.enterpriseId);
  const epoch = Number(config?.knowledge_epoch);
  if (!enterpriseKnowledgeEnabled(config?.agent_config)) return { status: 'disabled', epoch };
  const actor: ActorContext = { ...delegationActor(d), capabilities: ['assistant.chat.self'] };
  try {
    const query = [d.scope.roomName, d.scope.subject].join(' ');
    const result = await retrieveKnowledge(d.conversationId, actor, query, epoch, undefined, {
      kind: 'owner_delegation',
      authorize: async tx => await reviewDelegationOrigin(tx, d, conversation) ?? fail('delegation_origin_unavailable', 409),
    }, 'ranked',
      { mode: 'hybrid', topK: 3, signal }, tx);
    const sources = result.evidence.filter(source => source.professional?.applicability.status !== 'not_applicable')
      .map(({ ref, hash }) => ({ ref, hash }));
    return { status: sources.length ? 'sources_found' : 'no_match', epoch, sources,
      contextHash: fingerprint(result.diagnostic.context), requestId: result.diagnostic.managedIndex?.requestId ?? null };
  } catch (error) {
    if (!(error instanceof AssistantError) || error.status !== 503) throw error;
    return { status: 'unavailable', epoch, error: error instanceof BailianKnowledgeError ? error.providerCode : error.code,
      requestId: error instanceof BailianKnowledgeError ? error.requestId ?? null : null };
  }
}

export async function currentDelegationStandards(tx: PostgresTransaction, actor: ActorContext, conversation: Row, d: ReviewDelegation) {
  if (d.scope.kind !== 'rectification_review' || isSuspended(d.status)) return null;
  const row = await one(tx, sql`select receipt->'standardCheck' as standard_check,processed_at
    from app.native_workflow_delegation_events where enterprise_id=${d.enterpriseId} and delegation_id=${d.id}
      and receipt ? 'standardCheck' and event_id>=coalesce(${d.activationEventId}::bigint,0) order by event_id desc limit 1`);
  if (!row) return null;
  const checkedAt = row.processed_at;
  const check = row.standard_check as StandardCheck;
  const config = await settings(tx, d.enterpriseId);
  if (!enterpriseKnowledgeEnabled(config?.agent_config)) return { status: 'disabled', checkedAt, sources: [] };
  if (check.status === 'disabled' || check.epoch !== Number(config?.knowledge_epoch)
    || check.contextHash && check.contextHash !== fingerprint(await knowledgeContext(tx, actor, conversation))) {
    return { status: 'outdated', checkedAt, sources: [] };
  }
  const sources = [];
  for (const source of check.sources ?? []) {
    const row = await resolveEvidence(tx, actor, conversation, { ...source, text: '' });
    if (!row) return { status: 'outdated', checkedAt, sources: [] };
    sources.push(source.ref);
  }
  return { status: check.status, checkedAt, sources };
}
