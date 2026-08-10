import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  adminUsers,
  leadAcquisitionCommissions,
  leads,
  staffNotifications,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type LeadAcquisitionCommissionRecord = typeof leadAcquisitionCommissions.$inferSelect;
export type NewLeadAcquisitionCommission = typeof leadAcquisitionCommissions.$inferInsert;
export type StaffNotificationRecord = typeof staffNotifications.$inferSelect;
export type NewStaffNotification = typeof staffNotifications.$inferInsert;

export interface AcquisitionCommissionWithRelations extends LeadAcquisitionCommissionRecord {
  lead: { id: bigint; name: string; phone: string; communityName: string | null; status: string } | null;
  measurer: { id: bigint; displayName: string; username: string; role: string } | null;
  designer: { id: bigint; displayName: string; username: string; role: string } | null;
}

export interface StaffNotificationWithLead extends StaffNotificationRecord {
  lead: { id: bigint; name: string; communityName: string | null; status: string } | null;
}

export class AcquisitionRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async findCommissionById(id: bigint) {
    const rows = await this.transaction.select().from(leadAcquisitionCommissions).where(eq(leadAcquisitionCommissions.id, id)).limit(1);
    return (await this.attachCommissions(rows))[0] ?? null;
  }

  async findCommissionByLeadId(leadId: bigint) {
    const rows = await this.transaction.select().from(leadAcquisitionCommissions).where(eq(leadAcquisitionCommissions.leadId, leadId)).limit(1);
    return (await this.attachCommissions(rows))[0] ?? null;
  }

  async createCommission(input: NewLeadAcquisitionCommission) {
    const rows = await this.transaction.insert(leadAcquisitionCommissions).values(input)
      .onConflictDoNothing({ target: leadAcquisitionCommissions.leadId }).returning();
    return rows[0] ? (await this.attachCommissions(rows))[0] : null;
  }

  async listCommissions(options: { enterpriseId?: bigint; measurerId?: bigint; status?: string } = {}) {
    const filters = [];
    if (options.enterpriseId) filters.push(eq(leadAcquisitionCommissions.enterpriseId, options.enterpriseId));
    if (options.measurerId) filters.push(eq(leadAcquisitionCommissions.measurerId, options.measurerId));
    if (options.status) filters.push(eq(leadAcquisitionCommissions.status, options.status));
    const rows = await this.transaction.select().from(leadAcquisitionCommissions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(leadAcquisitionCommissions.createdAt), desc(leadAcquisitionCommissions.id));
    return this.attachCommissions(rows);
  }

  async summary(options: { enterpriseId?: bigint; measurerId?: bigint; status?: string } = {}) {
    const rows = await this.listCommissions(options);
    return rows.reduce<Record<string, { count: number; amount: number }>>((result, item) => {
      const current = result[item.status] || { count: 0, amount: 0 };
      current.count += 1;
      current.amount += Number(item.commissionAmount || 0);
      result[item.status] = current;
      return result;
    }, {});
  }

  async settleCommission(id: bigint, settledBy: bigint) {
    const rows = await this.transaction.update(leadAcquisitionCommissions)
      .set({ status: 'paid', settledAt: new Date(), settledBy, updatedAt: new Date() })
      .where(and(eq(leadAcquisitionCommissions.id, id), eq(leadAcquisitionCommissions.status, 'pending_settlement')))
      .returning();
    return rows[0] ? (await this.attachCommissions(rows))[0] : null;
  }

  async createNotification(input: NewStaffNotification) {
    const rows = await this.transaction.insert(staffNotifications).values(input)
      .onConflictDoNothing({
        target: [staffNotifications.dedupeKey, staffNotifications.channel],
        // This must match the partial unique index predicate exactly.
        where: isNotNull(staffNotifications.dedupeKey),
      })
      .returning();
    return rows[0] ?? null;
  }

  async listNotifications(recipientStaffId: bigint, onlyUnread = false) {
    const filters = [eq(staffNotifications.recipientStaffId, recipientStaffId)];
    if (onlyUnread) filters.push(eq(staffNotifications.status, 'unread'));
    const rows = await this.transaction.select().from(staffNotifications)
      .where(and(...filters))
      .orderBy(desc(staffNotifications.createdAt), desc(staffNotifications.id));
    const leadIds = Array.from(new Set(rows.map((row) => row.leadId).filter((id): id is bigint => id !== null)));
    const leadRows = leadIds.length ? await this.transaction.select({ id: leads.id, name: leads.name, communityName: leads.communityName, status: leads.status }).from(leads).where(inArray(leads.id, leadIds)) : [];
    const leadMap = new Map(leadRows.map((lead) => [lead.id, lead]));
    return rows.map((row) => ({ ...row, lead: row.leadId ? leadMap.get(row.leadId) ?? null : null }));
  }

  async markNotificationsRead(ids: bigint[], recipientStaffId: bigint) {
    if (!ids.length) return 0;
    const rows = await this.transaction.update(staffNotifications)
      .set({ status: 'read', readAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(staffNotifications.id, ids), eq(staffNotifications.recipientStaffId, recipientStaffId), isNull(staffNotifications.readAt)))
      .returning({ id: staffNotifications.id });
    return rows.length;
  }

  async markNotificationSent(id: bigint, status: string, errorMessage?: string | null) {
    const rows = await this.transaction.update(staffNotifications)
      .set({ status, errorMessage: errorMessage || null, sentAt: status === 'sent' ? new Date() : null, updatedAt: new Date() })
      .where(eq(staffNotifications.id, id)).returning();
    return rows[0] ?? null;
  }

  private async attachCommissions(rows: LeadAcquisitionCommissionRecord[]): Promise<AcquisitionCommissionWithRelations[]> {
    if (!rows.length) return [];
    const leadIds = Array.from(new Set(rows.map((row) => row.leadId)));
    const staffIds = Array.from(new Set(rows.flatMap((row) => [row.measurerId, row.designerId])));
    const [leadRows, staffRows] = await Promise.all([
      this.transaction.select({ id: leads.id, name: leads.name, phone: leads.phone, communityName: leads.communityName, status: leads.status }).from(leads).where(inArray(leads.id, leadIds)),
      this.transaction.select({ id: adminUsers.id, displayName: adminUsers.displayName, username: adminUsers.username, role: adminUsers.role }).from(adminUsers).where(inArray(adminUsers.id, staffIds)),
    ]);
    const leadMap = new Map(leadRows.map((lead) => [lead.id, lead]));
    const staffMap = new Map(staffRows.map((staff) => [staff.id, staff]));
    return rows.map((row) => ({ ...row, lead: leadMap.get(row.leadId) ?? null, measurer: staffMap.get(row.measurerId) ?? null, designer: staffMap.get(row.designerId) ?? null }));
  }
}
