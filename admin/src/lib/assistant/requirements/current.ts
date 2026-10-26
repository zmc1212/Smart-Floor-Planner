import { sql } from 'drizzle-orm';
import type { AssistantRepository, Row } from '@/db/repositories/assistant-repository';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fingerprint } from '../contracts';

type CurrentProposalContext = {
  sourceSeq: string;
  sourceHash: string | null;
  epoch: number;
  latestId: string | null;
  latestVersion: number | null;
  mode: string;
  status: string;
};

/** The chat entry and requirements page must project the same pending state. */
export function requirementProposalIsCurrent(pending: Row | undefined, context: CurrentProposalContext): boolean {
  return pending?.status === 'pending' && pending.sourceHash === context.sourceHash
    && pending.sourceSeq === context.sourceSeq && pending.epoch === context.epoch
    && pending.baseSummaryId === context.latestId && pending.baseVersion === context.latestVersion
    && context.mode === 'ai' && context.status === 'open';
}

export async function currentRequirementProposalPending(repo: AssistantRepository, conversation: Row, settings: Row | undefined): Promise<boolean> {
  const entry = conversation.entry_snapshot as Row;
  const pending = entry?.requirementProposal as Row | undefined;
  if (entry?.agentReviewCandidate !== true || entry.requirementReviewMode !== true
    || entry.requirementWorkflow !== 'langgraph' || !pending || pending.status !== 'pending'
    || !settings || conversation.mode !== 'ai' || conversation.status !== 'open') return false;
  const enterpriseId = String(conversation.enterprise_id), conversationId = String(conversation.id);
  const messages = await rows(repo.tx, sql`select id,seq,content from app.assistant_messages
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and author_kind='user' order by seq limit 201`);
  if (messages.length > 200) return false;
  const latest = await one(repo.tx, sql`select id,version from app.assistant_requirement_summaries
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId} order by id desc limit 1`);
  return requirementProposalIsCurrent(pending, {
    sourceSeq: String(messages.at(-1)?.seq || '0'), sourceHash: fingerprint(messages),
    epoch: Number(settings.knowledge_epoch), latestId: latest ? String(latest.id) : null,
    latestVersion: latest ? Number(latest.version) : null,
    mode: String(conversation.mode), status: String(conversation.status),
  });
}
