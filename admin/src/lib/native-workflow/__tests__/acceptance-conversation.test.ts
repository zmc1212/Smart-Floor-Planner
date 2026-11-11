import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import {
  ACCEPTANCE_MARKER,
  cleanupAcceptanceConversation,
  createAcceptanceConversation,
  type AcceptanceQueryClient,
  type AcceptanceRow,
} from '../live/acceptance-conversation';

interface FakeState {
  conversations: Map<string, AcceptanceRow>;
  participants: Map<string, AcceptanceRow>;
  links: AcceptanceRow[];
}

function freshState(): FakeState {
  return { conversations: new Map(), participants: new Map(), links: [] };
}

function snapshotOf(state: FakeState): FakeState {
  return {
    conversations: new Map([...state.conversations].map(([key, row]) => [key, structuredClone(row)])),
    participants: new Map([...state.participants].map(([key, row]) => [key, structuredClone(row)])),
    links: structuredClone(state.links),
  };
}

/** Transactional fake: records SQL, keeps rows in memory, restores on rollback. */
class FakeClient implements AcceptanceQueryClient {
  state: FakeState = freshState();
  readonly queries: string[] = [];
  failWhen: ((sql: string) => boolean) | null = null;
  private snapshot: FakeState | null = null;

  async query(text: string, values: unknown[] = []): Promise<{ rows: AcceptanceRow[] }> {
    const sql = text.replace(/\s+/gu, ' ').trim();
    this.queries.push(sql);

    if (sql === 'begin') {
      this.snapshot = snapshotOf(this.state);
      return { rows: [] };
    }
    if (sql === 'commit') {
      this.snapshot = null;
      return { rows: [] };
    }
    if (sql === 'rollback') {
      if (this.snapshot) this.state = this.snapshot;
      this.snapshot = null;
      return { rows: [] };
    }
    if (this.failWhen?.(sql)) throw new Error('simulated participant insert failure');

    const args = values.map((value) => String(value));
    if (sql.startsWith('select id, enterprise_id, title from app.assistant_conversations')) {
      const row = this.state.conversations.get(args[0]!);
      return { rows: row ? [structuredClone(row)] : [] };
    }
    if (sql.startsWith('select id, enterprise_id, conversation_id, status from app.assistant_participants')) {
      const row = this.state.participants.get(args[0]!);
      return { rows: row ? [structuredClone(row)] : [] };
    }
    if (sql.startsWith('select id, conversation_id from app.assistant_participants')) {
      const [enterpriseId, conversationId, userId] = args;
      const row = [...this.state.participants.values()].find((candidate) => (
        String(candidate.enterprise_id) === enterpriseId
        && String(candidate.conversation_id) === conversationId
        && String(candidate.user_id) === userId
        && candidate.status === 'active'
      ));
      return { rows: row ? [{ id: row.id, conversation_id: row.conversation_id }] : [] };
    }
    if (sql.startsWith("select id, conversation_id, grant_basis->>'acceptance' as acceptance")) {
      const [enterpriseId, id] = args;
      const row = this.state.participants.get(id!);
      if (!row || String(row.enterprise_id) !== enterpriseId) return { rows: [] };
      return {
        rows: [{
          id: row.id,
          conversation_id: row.conversation_id,
          acceptance: (row.grant_basis as AcceptanceRow | undefined)?.acceptance,
        }],
      };
    }
    if (sql.startsWith("select id, title, entry_snapshot->>'acceptance' as acceptance")) {
      const [enterpriseId, id] = args;
      const row = this.state.conversations.get(id!);
      if (!row || String(row.enterprise_id) !== enterpriseId) return { rows: [] };
      return {
        rows: [{
          id: row.id,
          title: row.title,
          acceptance: (row.entry_snapshot as AcceptanceRow | undefined)?.acceptance,
        }],
      };
    }
    if (sql.startsWith('insert into app.assistant_conversations')) {
      const [id, enterpriseId, title, entrySnapshot] = args;
      this.state.conversations.set(id!, {
        id,
        enterprise_id: enterpriseId,
        title,
        entry_snapshot: JSON.parse(entrySnapshot!),
      });
      return { rows: [] };
    }
    if (sql.startsWith('insert into app.assistant_participants')) {
      const [id, enterpriseId, conversationId, userId, grantBasis] = args;
      this.state.participants.set(id!, {
        id,
        enterprise_id: enterpriseId,
        conversation_id: conversationId,
        user_id: userId,
        participant_role: 'owner',
        grant_basis: JSON.parse(grantBasis!),
        status: 'active',
      });
      return { rows: [] };
    }
    if (sql.startsWith('delete from app.assistant_participants')) {
      const [enterpriseId, id, conversationId, marker] = args;
      const row = this.state.participants.get(id!);
      const acceptance = (row?.grant_basis as AcceptanceRow | undefined)?.acceptance;
      if (
        !row
        || String(row.enterprise_id) !== enterpriseId
        || String(row.conversation_id) !== conversationId
        || acceptance !== marker
      ) {
        return { rows: [] };
      }
      this.state.participants.delete(id!);
      return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith('delete from app.construction_links')) {
      const [enterpriseId, conversationId] = args;
      const removed = this.state.links.filter((row) => (
        String(row.enterprise_id) === enterpriseId && String(row.conversation_id) === conversationId
      ));
      this.state.links = this.state.links.filter((row) => !removed.includes(row));
      return { rows: removed.map((row) => ({ project_id: row.project_id })) };
    }
    if (sql.startsWith('delete from app.assistant_conversations')) {
      const [enterpriseId, id, marker] = args;
      const row = this.state.conversations.get(id!);
      const acceptance = (row?.entry_snapshot as AcceptanceRow | undefined)?.acceptance;
      if (!row || String(row.enterprise_id) !== enterpriseId || acceptance !== marker) return { rows: [] };
      this.state.conversations.delete(id!);
      return { rows: [{ id: row.id }] };
    }
    throw new Error(`fake client cannot execute: ${sql}`);
  }
}

const INPUT = {
  enterpriseId: '1454',
  conversationId: '1454800001',
  participantId: '1454800002',
  customerUserId: '1454000002',
  leadId: '1454000003',
};

function writeSql(queries: readonly string[]): string[] {
  return queries.filter((sql) => /^(insert|update|delete)/u.test(sql));
}

test('an occupied participant id aborts before writing and is never reactivated', async () => {
  const client = new FakeClient();
  client.state.participants.set(INPUT.participantId, {
    id: INPUT.participantId,
    enterprise_id: '1454',
    conversation_id: '1454888888',
    user_id: INPUT.customerUserId,
    participant_role: 'owner',
    grant_basis: { kind: 'self', acceptance: 'another-acceptance' },
    status: 'revoked',
  });

  await assert.rejects(
    createAcceptanceConversation(client, INPUT),
    (error: unknown) => {
      assert.ok(error instanceof WorkflowOperationError);
      assert.equal(error.code, 'acceptance_participant_occupied');
      assert.equal(error.status, 409);
      const row = (error.details as { row?: AcceptanceRow }).row;
      assert.equal(row?.conversation_id, '1454888888');
      assert.equal(row?.status, 'revoked');
      return true;
    },
  );

  assert.equal(client.state.conversations.size, 0, 'no conversation may be written');
  assert.deepEqual(writeSql(client.queries), [], 'no insert/update/delete may be issued');
  const existing = client.state.participants.get(INPUT.participantId);
  assert.equal(existing?.status, 'revoked');
  assert.equal(existing?.conversation_id, '1454888888');
  assert.ok(client.queries.includes('rollback'));
});

test('a participant insert failure rolls the conversation insert back to zero residue', async () => {
  const client = new FakeClient();
  client.failWhen = (sql) => sql.startsWith('insert into app.assistant_participants');

  await assert.rejects(createAcceptanceConversation(client, INPUT), /simulated participant insert failure/u);

  assert.equal(client.state.conversations.size, 0);
  assert.equal(client.state.participants.size, 0);
  assert.ok(client.queries.includes('rollback'));
  assert.deepEqual(
    client.queries.filter((sql) => sql === 'commit'),
    [],
    'a failed transaction must not commit',
  );
});

test('the normal path commits both rows and cleanup deletes only marker rows', async () => {
  const client = new FakeClient();
  const created = await createAcceptanceConversation(client, INPUT);
  assert.deepEqual(created, { conversationId: INPUT.conversationId, participantId: INPUT.participantId });
  assert.ok(client.queries.includes('commit'));

  const conversation = client.state.conversations.get(INPUT.conversationId);
  assert.ok(conversation);
  assert.ok(String(conversation.title).startsWith('[B5.1]'));
  assert.deepEqual(conversation.entry_snapshot, {
    kind: 'lead',
    id: INPUT.leadId,
    acceptance: ACCEPTANCE_MARKER,
  });
  const participant = client.state.participants.get(INPUT.participantId);
  assert.ok(participant);
  assert.equal(participant.status, 'active');
  assert.equal(participant.participant_role, 'owner');
  assert.deepEqual(participant.grant_basis, {
    kind: 'self',
    contextVersion: 1,
    acceptance: ACCEPTANCE_MARKER,
  });

  client.state.links.push({
    enterprise_id: '1454',
    project_id: '1454000004',
    conversation_id: INPUT.conversationId,
  });
  client.state.conversations.set('1454877777', {
    id: '1454877777',
    enterprise_id: '1454',
    title: '[B4] 别人的会话',
    entry_snapshot: { kind: 'lead', id: '1454877778' },
  });
  client.state.participants.set('1454877778', {
    id: '1454877778',
    enterprise_id: '1454',
    conversation_id: '1454877777',
    user_id: INPUT.customerUserId,
    participant_role: 'owner',
    grant_basis: { kind: 'self' },
    status: 'active',
  });

  const cleaned = await cleanupAcceptanceConversation(client, {
    enterpriseId: INPUT.enterpriseId,
    conversationId: INPUT.conversationId,
    participantId: INPUT.participantId,
  });
  assert.deepEqual(cleaned, { conversations: 1, participants: 1, links: 1, skipped: 0 });
  assert.equal(client.state.conversations.has(INPUT.conversationId), false);
  assert.equal(client.state.participants.has(INPUT.participantId), false);
  assert.equal(client.state.links.length, 0);
  assert.equal(client.state.conversations.has('1454877777'), true);
  assert.equal(client.state.participants.get('1454877778')?.status, 'active');
});

test('cleanup reports skipped instead of deleting a row whose marker changed', async () => {
  const client = new FakeClient();
  await createAcceptanceConversation(client, INPUT);
  client.state.participants.set(INPUT.participantId, {
    ...client.state.participants.get(INPUT.participantId),
    grant_basis: { kind: 'self', acceptance: 'other-owner' },
  });

  const cleaned = await cleanupAcceptanceConversation(client, {
    enterpriseId: INPUT.enterpriseId,
    conversationId: INPUT.conversationId,
    participantId: INPUT.participantId,
  });
  assert.equal(cleaned.participants, 0);
  assert.equal(cleaned.skipped, 1);
  assert.equal(cleaned.conversations, 1);
  assert.equal(client.state.participants.has(INPUT.participantId), true);
});
