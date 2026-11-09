import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { leads, staffNotifications } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type StaffNotificationRecord = typeof staffNotifications.$inferSelect;
export type NewStaffNotification = typeof staffNotifications.$inferInsert;

export interface StaffNotificationListOptions {
  onlyUnread?: boolean;
  types?: string[];
  limit?: number;
}

export interface StaffNotificationWithLead extends StaffNotificationRecord {
  lead: { id: bigint; name: string; communityName: string | null; status: string } | null;
}

export class StaffNotificationRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async create(input: NewStaffNotification) {
    const rows = await this.transaction.insert(staffNotifications).values(input)
      .onConflictDoNothing({
        target: [staffNotifications.dedupeKey, staffNotifications.channel],
        where: isNotNull(staffNotifications.dedupeKey),
      })
      .returning();
    return rows[0] ?? null;
  }

  async list(
    recipientStaffId: bigint,
    options: StaffNotificationListOptions = {}
  ): Promise<StaffNotificationWithLead[]> {
    const filters = [eq(staffNotifications.recipientStaffId, recipientStaffId)];
    if (options.onlyUnread) filters.push(eq(staffNotifications.status, 'unread'));
    if (options.types?.length) {
      filters.push(inArray(staffNotifications.notificationType, options.types));
    }
    const limit = Math.min(Math.max(1, options.limit ?? 100), 200);
    const rows = await this.transaction.select().from(staffNotifications)
      .where(and(...filters))
      .orderBy(desc(staffNotifications.createdAt), desc(staffNotifications.id))
      .limit(limit);
    const leadIds = Array.from(new Set(rows.map((row) => row.leadId).filter((id): id is bigint => id !== null)));
    const leadRows = leadIds.length
      ? await this.transaction.select({ id: leads.id, name: leads.name, communityName: leads.communityName, status: leads.status }).from(leads).where(inArray(leads.id, leadIds))
      : [];
    const leadMap = new Map(leadRows.map((lead) => [lead.id, lead]));
    return rows.map((row) => ({ ...row, lead: row.leadId ? leadMap.get(row.leadId) ?? null : null }));
  }

  async countUnread(recipientStaffId: bigint) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(staffNotifications)
      .where(
        and(
          eq(staffNotifications.recipientStaffId, recipientStaffId),
          eq(staffNotifications.status, 'unread')
        )
      );
    return Number(rows[0]?.value ?? 0);
  }

  async markRead(ids: bigint[], recipientStaffId: bigint) {
    if (!ids.length) return 0;
    const rows = await this.transaction.update(staffNotifications)
      .set({ status: 'read', readAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(staffNotifications.id, ids), eq(staffNotifications.recipientStaffId, recipientStaffId), isNull(staffNotifications.readAt)))
      .returning({ id: staffNotifications.id });
    return rows.length;
  }

  async markSent(id: bigint, status: string, errorMessage?: string | null) {
    const rows = await this.transaction.update(staffNotifications)
      .set({ status, errorMessage: errorMessage || null, sentAt: status === 'sent' ? new Date() : null, updatedAt: new Date() })
      .where(eq(staffNotifications.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
