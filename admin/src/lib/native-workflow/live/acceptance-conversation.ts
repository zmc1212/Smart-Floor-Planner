/** Acceptance-only ownership for the temporary cross-conversation rows.
 *
 * The B5.1 acceptance needs a second open customer conversation so the
 * delivery adapter must resolve the real conversation instead of blindly
 * using the requested one. Those rows are temporary: they are created in one
 * transaction that refuses occupied ids, and removed by a cleanup that only
 * deletes rows still carrying this exact acceptance marker. Both helpers take
 * a minimal query client so the script can pass a `pg.PoolClient` and a unit
 * test can pass a fake transactional client.
 */
import { WorkflowOperationError } from '../errors';

export const ACCEPTANCE_MARKER = 'b5-1-user-loop';
export const ACCEPTANCE_TITLE_PREFIX = '[B5.1]';

export type AcceptanceRow = Record<string, unknown>;

export interface AcceptanceQueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: AcceptanceRow[] }>;
}

export interface CreateAcceptanceConversationInput {
  readonly enterpriseId: string;
  readonly conversationId: string;
  readonly participantId: string;
  readonly customerUserId: string;
  readonly leadId: string;
  readonly title?: string;
}

export interface CreatedAcceptanceConversation {
  readonly conversationId: string;
  readonly participantId: string;
}

export interface CleanupAcceptanceConversationInput {
  readonly enterpriseId: string;
  readonly conversationId: string;
  readonly participantId: string;
}

export interface CleanupAcceptanceConversationResult {
  readonly conversations: number;
  readonly participants: number;
  readonly links: number;
  readonly skipped: number;
}

function occupied(
  code: 'acceptance_conversation_occupied' | 'acceptance_participant_occupied' | 'acceptance_participant_exists',
  row: AcceptanceRow,
): WorkflowOperationError {
  return new WorkflowOperationError(code, 409, `${code}: the fixed acceptance id is not free`, { row });
}

async function rollback(client: AcceptanceQueryClient): Promise<void> {
  await client.query('rollback').catch(() => undefined);
}

/**
 * Create the temporary cross conversation and its owner participant.
 *
 * Existing ids are never reused: an occupied conversation or participant id
 * aborts the transaction before any write, and a participant is never
 * reactivated. If the participant insert fails the conversation insert is
 * rolled back, leaving zero residue for that run id.
 */
export async function createAcceptanceConversation(
  client: AcceptanceQueryClient,
  input: CreateAcceptanceConversationInput,
): Promise<CreatedAcceptanceConversation> {
  await client.query('begin');
  try {
    const conversation = await client.query(
      'select id, enterprise_id, title from app.assistant_conversations where id=$1::bigint',
      [input.conversationId],
    );
    if (conversation.rows[0]) throw occupied('acceptance_conversation_occupied', conversation.rows[0]);

    const participant = await client.query(
      'select id, enterprise_id, conversation_id, status from app.assistant_participants where id=$1::bigint',
      [input.participantId],
    );
    if (participant.rows[0]) throw occupied('acceptance_participant_occupied', participant.rows[0]);

    const active = await client.query(
      `select id, conversation_id from app.assistant_participants
        where enterprise_id=$1::bigint and conversation_id=$2::bigint
          and principal_kind='user' and user_id=$3::bigint and status='active'`,
      [input.enterpriseId, input.conversationId, input.customerUserId],
    );
    if (active.rows[0]) throw occupied('acceptance_participant_exists', active.rows[0]);

    await client.query(
      `insert into app.assistant_conversations
        (id,enterprise_id,purpose,status,mode,title,entry_snapshot,policy_version,context_revision,last_seq)
       overriding system value
       values($1::bigint,$2::bigint,'customer_consultation','open','ai',$3,$4::jsonb,1,1,0)`,
      [
        input.conversationId,
        input.enterpriseId,
        input.title ?? `${ACCEPTANCE_TITLE_PREFIX} 跨会话验证`,
        JSON.stringify({ kind: 'lead', id: input.leadId, acceptance: ACCEPTANCE_MARKER }),
      ],
    );
    await client.query(
      `insert into app.assistant_participants
        (id,enterprise_id,conversation_id,principal_kind,user_id,admin_id,participant_role,grant_basis,status)
       overriding system value
       values($1::bigint,$2::bigint,$3::bigint,'user',$4::bigint,null,'owner',$5::jsonb,'active')`,
      [
        input.participantId,
        input.enterpriseId,
        input.conversationId,
        input.customerUserId,
        JSON.stringify({ kind: 'self', contextVersion: 1, acceptance: ACCEPTANCE_MARKER }),
      ],
    );
    await client.query('commit');
    return { conversationId: input.conversationId, participantId: input.participantId };
  } catch (error) {
    await rollback(client);
    throw error;
  }
}

/**
 * Delete only rows that still match both the fixed ids and the acceptance
 * marker. A row whose marker was replaced by another owner is left untouched
 * and reported as `skipped`.
 */
export async function cleanupAcceptanceConversation(
  client: AcceptanceQueryClient,
  input: CleanupAcceptanceConversationInput,
): Promise<CleanupAcceptanceConversationResult> {
  await client.query('begin');
  try {
    let skipped = 0;

    const participant = await client.query(
      `select id, conversation_id, grant_basis->>'acceptance' as acceptance
         from app.assistant_participants where enterprise_id=$1::bigint and id=$2::bigint`,
      [input.enterpriseId, input.participantId],
    );
    let participants = 0;
    const participantRow = participant.rows[0];
    if (participantRow) {
      if (
        String(participantRow.conversation_id) === input.conversationId
        && participantRow.acceptance === ACCEPTANCE_MARKER
      ) {
        const deleted = await client.query(
          `delete from app.assistant_participants
            where enterprise_id=$1::bigint and id=$2::bigint and conversation_id=$3::bigint
              and grant_basis->>'acceptance'=$4
            returning id`,
          [input.enterpriseId, input.participantId, input.conversationId, ACCEPTANCE_MARKER],
        );
        participants = deleted.rows.length;
        if (participants === 0) skipped += 1;
      } else {
        skipped += 1;
      }
    }

    const links = await client.query(
      `delete from app.construction_links
        where enterprise_id=$1::bigint and conversation_id=$2::bigint
        returning project_id`,
      [input.enterpriseId, input.conversationId],
    );

    const conversation = await client.query(
      `select id, title, entry_snapshot->>'acceptance' as acceptance
         from app.assistant_conversations where enterprise_id=$1::bigint and id=$2::bigint`,
      [input.enterpriseId, input.conversationId],
    );
    let conversations = 0;
    const conversationRow = conversation.rows[0];
    if (conversationRow) {
      if (conversationRow.acceptance === ACCEPTANCE_MARKER) {
        const deleted = await client.query(
          `delete from app.assistant_conversations
            where enterprise_id=$1::bigint and id=$2::bigint and entry_snapshot->>'acceptance'=$3
            returning id`,
          [input.enterpriseId, input.conversationId, ACCEPTANCE_MARKER],
        );
        conversations = deleted.rows.length;
        if (conversations === 0) skipped += 1;
      } else {
        skipped += 1;
      }
    }

    await client.query('commit');
    return { conversations, participants, links: links.rows.length, skipped };
  } catch (error) {
    await rollback(client);
    throw error;
  }
}
