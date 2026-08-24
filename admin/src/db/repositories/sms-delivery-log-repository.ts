import { and, desc, eq, sql } from 'drizzle-orm';
import { adminUsers, enterprises, leads, smsDeliveryLogs } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type SmsDeliveryLogRecord = typeof smsDeliveryLogs.$inferSelect;
export type NewSmsDeliveryLog = typeof smsDeliveryLogs.$inferInsert;

export class SmsDeliveryLogRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async create(input: NewSmsDeliveryLog) {
    const rows = await this.transaction
      .insert(smsDeliveryLogs)
      .values(input)
      .onConflictDoNothing({
        target: smsDeliveryLogs.dedupeKey,
        where: sql`${smsDeliveryLogs.dedupeKey} is not null`,
      })
      .returning();
    return rows[0] ?? null;
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select({
        log: smsDeliveryLogs,
        enterpriseName: enterprises.name,
        leadName: leads.name,
        recipientName: adminUsers.displayName,
        recipientUsername: adminUsers.username,
      })
      .from(smsDeliveryLogs)
      .leftJoin(enterprises, eq(smsDeliveryLogs.enterpriseId, enterprises.id))
      .leftJoin(leads, eq(smsDeliveryLogs.leadId, leads.id))
      .leftJoin(adminUsers, eq(smsDeliveryLogs.recipientStaffId, adminUsers.id))
      .where(eq(smsDeliveryLogs.id, id))
      .limit(1);
    const row = rows[0];
    return row ? { ...row.log, enterpriseName: row.enterpriseName, leadName: row.leadName, recipientName: row.recipientName, recipientUsername: row.recipientUsername } : null;
  }

  async markResult(
    id: bigint,
    result: {
      status: string;
      providerMessageId?: string | null;
      providerRequestId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      incrementAttempt?: boolean;
    }
  ) {
    const rows = await this.transaction
      .update(smsDeliveryLogs)
      .set({
        status: result.status,
        providerMessageId: result.providerMessageId ?? null,
        providerRequestId: result.providerRequestId ?? null,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        attemptCount: result.incrementAttempt ? sql`${smsDeliveryLogs.attemptCount} + 1` : undefined,
        sentAt: result.status === 'sent' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(smsDeliveryLogs.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async prepareRetry(id: bigint) {
    const rows = await this.transaction
      .update(smsDeliveryLogs)
      .set({
        status: 'pending',
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(smsDeliveryLogs.id, id), eq(smsDeliveryLogs.status, 'failed')))
      .returning();
    return rows[0] ?? null;
  }

  async list(input: { enterpriseId?: bigint | null; status?: string; page: number; limit: number }) {
    const filters = [];
    if (input.enterpriseId) filters.push(eq(smsDeliveryLogs.enterpriseId, input.enterpriseId));
    if (input.status) filters.push(eq(smsDeliveryLogs.status, input.status));
    const where = filters.length ? and(...filters) : undefined;
    const [rows, countRows] = await Promise.all([
      this.transaction
        .select({
          log: smsDeliveryLogs,
          enterpriseName: enterprises.name,
          leadName: leads.name,
          recipientName: adminUsers.displayName,
          recipientUsername: adminUsers.username,
        })
        .from(smsDeliveryLogs)
        .leftJoin(enterprises, eq(smsDeliveryLogs.enterpriseId, enterprises.id))
        .leftJoin(leads, eq(smsDeliveryLogs.leadId, leads.id))
        .leftJoin(adminUsers, eq(smsDeliveryLogs.recipientStaffId, adminUsers.id))
        .where(where)
        .orderBy(desc(smsDeliveryLogs.createdAt), desc(smsDeliveryLogs.id))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      this.transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(smsDeliveryLogs)
        .where(where),
    ]);
    return {
      rows: rows.map((row) => ({ ...row.log, enterpriseName: row.enterpriseName, leadName: row.leadName, recipientName: row.recipientName, recipientUsername: row.recipientUsername })),
      total: countRows[0]?.count || 0,
    };
  }
}
