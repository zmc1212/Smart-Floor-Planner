import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { leads, staffNotifications } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type StaffNotificationRecord = typeof staffNotifications.$inferSelect;
export type NewStaffNotification = typeof staffNotifications.$inferInsert;

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

  async list(recipientStaffId: bigint, onlyUnread = false): Promise<StaffNotificationWithLead[]> {
    const filters = [eq(staffNotifications.recipientStaffId, recipientStaffId)];
    if (onlyUnread) filters.push(eq(staffNotifications.status, 'unread'));
    const rows = await this.transaction.select().from(staffNotifications)
      .where(and(...filters))
      .orderBy(desc(staffNotifications.createdAt), desc(staffNotifications.id));
    const leadIds = Array.from(new Set(rows.map((row) => row.leadId).filter((id): id is bigint => id !== null)));
    const leadRows = leadIds.length
      ? await this.transaction.select({ id: leads.id, name: leads.name, communityName: leads.communityName, status: leads.status }).from(leads).where(inArray(leads.id, leadIds))
      : [];
    const leadMap = new Map(leadRows.map((lead) => [lead.id, lead]));
    return rows.map((row) => ({ ...row, lead: row.leadId ? leadMap.get(row.leadId) ?? null : null }));
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
