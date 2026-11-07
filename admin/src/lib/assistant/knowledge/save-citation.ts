import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, type ActorContext, type Evidence } from '../contracts';
import { previewPolicy, resolveEvidence } from './sources';

/** One persistence/authorization path for ordinary synthesis and native RAG.
 * Full current-source checks also run again when a saved citation is opened. */
export async function saveKnowledgeCitation(tx: PostgresTransaction, actor: ActorContext, conversation: Row,
  runId: string, messageId: string, evidence: Evidence, quote: string) {
  const row = await resolveEvidence(tx, actor, conversation, evidence);
  if (!row || !quote.trim() || quote.length > 600 || !evidence.text.includes(quote) || !String(row.text).includes(quote)) fail('invalid_model_citation', 502);
  const isDraft = actor.principal.kind === 'admin' && conversation.purpose === 'knowledge_preview'
    && previewPolicy(conversation).drafts.some(d => d.id === evidence.ref.version);
  const inserted = (await one(tx, sql`insert into app.assistant_message_citations(enterprise_id,conversation_id,message_id,run_id,source_kind,resource_type,resource_id,resource_version,
    document_id,document_version_id,chunk_id,source_hash,quote_snapshot,locator,is_draft)
    values(${actor.enterpriseId},${String(conversation.id)},${messageId},${runId},'knowledge','knowledge_chunk',${evidence.ref.id},${evidence.ref.version},
      ${String(row.document_id)},${evidence.ref.version},${evidence.ref.id},${evidence.hash},${quote},${JSON.stringify({ ...(row.locator as Row), synthesis: true })}::jsonb,${isDraft}) returning id`))!;
  return String(inserted.id);
}
