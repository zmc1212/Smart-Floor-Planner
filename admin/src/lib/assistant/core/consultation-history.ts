import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { privateReportReply } from '@/lib/construction/report-reference';
import { fail, id, safeText, type ActorContext, type MessageContent } from '../contracts';
import { authorizeKnowledgeManager } from '../knowledge/manager';
import { projectMessage } from '../knowledge/sources';

const receptionStates = ['ai', 'waiting', 'active', 'ended', 'cancelled'] as const;
export type ConsultationReception = typeof receptionStates[number];
export type ConsultationRecord = {
  id: string;
  title: string;
  customerName: string;
  customerId: string;
  reception: ConsultationReception;
  status: 'open' | 'archived' | 'closed';
  updatedAt: string;
};
export type ConsultationPage = { items: ConsultationRecord[]; nextCursor: { at: string; id: string } | null };
export type ConsultationDetail = {
  record: ConsultationRecord;
  messages: { id: string; authorKind: string; text: string; createdAt: string }[];
  nextCursor: string | null;
};

const pageSize = 20;
const timestamp = z.string().datetime().refine(value => !value.startsWith('0000'));
const filters = z.object({
  customer: z.string().trim().max(80).default(''),
  reception: z.enum(receptionStates).optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  beforeAt: timestamp.optional(),
  beforeId: z.string().optional(),
});

const reception = sql`coalesce(c.entry_snapshot->'handoff'->>'state', 'ai')`;
const projection = sql`c.id,c.title,c.status,p.user_id,u.nickname,${reception} as reception,
  to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as activity_at`;

function enterpriseConsultations(enterpriseId: string, adminId: string, conversationId: string | null = null) {
  return sql`from app.assistant_conversations c join app.assistant_participants p
    on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
    and p.principal_kind='user' and p.participant_role='owner' and p.status='active'
    join app.assistant_consultation_profiles(${adminId}::bigint,${enterpriseId}::bigint,${conversationId}::bigint) u on u.user_id=p.user_id
    where c.enterprise_id=${enterpriseId} and c.purpose='customer_consultation'
      and c.entry_snapshot->>'scope' is distinct from 'public'
      and c.entry_snapshot->>'kind' is distinct from 'public_consultation'
      and c.entry_snapshot->>'retentionRedacted' is distinct from 'true'`;
}

function consultationRecord(row: Row): ConsultationRecord {
  return {
    id: String(row.id), title: String(row.title || '装修咨询'),
    customerName: typeof row.nickname === 'string' ? row.nickname.trim() : '', customerId: String(row.user_id),
    reception: row.reception as ConsultationReception, status: row.status as ConsultationRecord['status'],
    updatedAt: String(row.activity_at),
  };
}

export class ConsultationHistory {
  constructor(readonly enterpriseId: string, readonly adminId: string) {}

  list(query: URLSearchParams): Promise<ConsultationPage> {
    const parsed = filters.safeParse(Object.fromEntries(query));
    if (!parsed.success) fail('invalid_message', 422);
    const { customer, reception: state, from, to, beforeAt, beforeId } = parsed.data;
    if (Boolean(beforeAt) !== Boolean(beforeId) || from && to && Date.parse(from) >= Date.parse(to)) fail('invalid_message', 422);
    const cursorId = beforeId === undefined ? undefined : id(beforeId);
    return withTenantTransaction(this.enterpriseId, async tx => {
      await authorizeKnowledgeManager(tx, this.enterpriseId, this.adminId);
      const result = await rows(tx, sql`select ${projection} ${enterpriseConsultations(this.enterpriseId, this.adminId)}
        ${customer ? sql`and (p.user_id::text=${customer} or strpos(lower(coalesce(u.nickname,'')),lower(${customer}))>0)` : sql``}
        ${state ? sql`and ${reception}=${state}` : sql``}
        ${from ? sql`and c.updated_at>=${from}::timestamptz` : sql``}
        ${to ? sql`and c.updated_at<${to}::timestamptz` : sql``}
        ${beforeAt && cursorId ? sql`and (c.updated_at,c.id)<(${beforeAt}::timestamptz,${cursorId}::bigint)` : sql``}
        order by c.updated_at desc,c.id desc limit ${pageSize + 1}`);
      const items = result.slice(0, pageSize).map(consultationRecord);
      const last = items.at(-1);
      return { items, nextCursor: last && result.length > pageSize ? { at: last.updatedAt, id: last.id } : null };
    });
  }

  detail(conversationId: string, beforeSeq: string | null): Promise<ConsultationDetail> {
    id(conversationId);
    const cursor = beforeSeq === null ? null : id(beforeSeq);
    return withTenantTransaction(this.enterpriseId, async tx => {
      await authorizeKnowledgeManager(tx, this.enterpriseId, this.adminId);
      const conversation = await one(tx, sql`select ${projection},c.purpose,c.enterprise_id,c.entry_snapshot,u.context_version
        ${enterpriseConsultations(this.enterpriseId, this.adminId, conversationId)} and c.id=${conversationId}
        for share of c,p`);
      if (!conversation) fail('assistant_resource_not_found', 404);

      // Apply the original customer's source visibility without granting any of their actions or assets to the manager.
      const sourceReader: ActorContext = {
        enterpriseId: this.enterpriseId, principal: { kind: 'user', userId: String(conversation.user_id) },
        contextVersion: Number(conversation.context_version), capabilities: [], entry: conversation.entry_snapshot as Row,
      };
      const result = await rows(tx, sql`select id,seq,author_kind,user_id,run_id,content,answer_kind,created_at,purpose,reply_to_message_id
        from app.assistant_messages where enterprise_id=${this.enterpriseId} and conversation_id=${conversationId}
        and not ${privateReportReply} and purpose is distinct from 'construction.report.facts'
        ${cursor ? sql`and seq<${cursor}` : sql``} order by seq desc limit ${pageSize + 1}`);
      const page = result.slice(0, pageSize);
      const messages = [];
      for (const message of [...page].reverse()) {
        const projected = await projectMessage(tx, sourceReader, conversation, message);
        const text = message.purpose === 'media.upload' && projected.mediaAvailable !== undefined
          ? projected.mediaAvailable ? '客户发送了图片' : '图片已撤回或不可查看'
          : safeText(projected.content as MessageContent);
        messages.push({ id: projected.id, authorKind: String(projected.authorKind), text, createdAt: new Date(String(projected.createdAt)).toISOString() });
      }
      await tx.execute(sql`insert into app.assistant_consultation_reads(enterprise_id,conversation_id,actor_id,before_seq)
        values(${this.enterpriseId},${conversationId},${this.adminId},${cursor})`);
      return { record: consultationRecord(conversation), messages, nextCursor: result.length > pageSize ? String(page.at(-1)!.seq) : null };
    });
  }
}
