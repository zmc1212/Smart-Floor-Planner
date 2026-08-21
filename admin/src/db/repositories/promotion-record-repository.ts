import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  adminUsers,
  enterprises,
  promotionEnterpriseRecords,
  workflowNotificationLogs,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewPromotionRecord = typeof promotionEnterpriseRecords.$inferInsert;
export type PromotionRecord = typeof promotionEnterpriseRecords.$inferSelect;
export type PromotionRecordUpdate = Partial<
  Omit<NewPromotionRecord, 'id' | 'createdAt' | 'updatedAt'>
>;
export type PromotionTimelineEntry = Record<string, unknown> & {
  content: string;
  operator: string;
  createdAt: Date | string;
};

export interface PromotionStaffSummary {
  id: bigint;
  displayName: string;
  username: string;
  role: string;
}

export interface PromotionRecordWithRelations extends PromotionRecord {
  enterprise: { id: bigint; name: string } | null;
  promoter: PromotionStaffSummary | null;
  measureAssignee: PromotionStaffSummary | null;
  designAssignee: PromotionStaffSummary | null;
  claimRequester: PromotionStaffSummary | null;
  claimReviewer: PromotionStaffSummary | null;
  conflictReviewer: PromotionStaffSummary | null;
}

export interface PromotionActor {
  id: bigint;
  role: string;
}

export interface PromotionListOptions {
  actor?: PromotionActor;
  businessStage?: string;
  ownershipStatus?: string;
  poolStatuses?: string[];
  pendingActionRole?: string;
  promoterId?: bigint;
  search?: string;
  dueBefore?: Date;
  page?: number;
  limit?: number;
}

export interface PromotionDuplicateInput {
  creditCode?: string | null;
  enterpriseName: string;
  phone: string;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

export class PromotionRecordRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private normalizeInput<T extends NewPromotionRecord | PromotionRecordUpdate>(
    input: T
  ): T {
    return {
      ...input,
      ...(input.creditCode !== undefined
        ? { creditCode: input.creditCode?.trim().toUpperCase() || null }
        : {}),
      ...(input.enterpriseName !== undefined
        ? { enterpriseName: input.enterpriseName.trim() }
        : {}),
      ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
    } as T;
  }

  private actorFilter(actor?: PromotionActor): SQL | undefined {
    if (!actor) return undefined;
    if (actor.role === 'salesperson') {
      return or(
        eq(promotionEnterpriseRecords.promoterId, actor.id),
        and(
          eq(promotionEnterpriseRecords.claimRequestedBy, actor.id),
          eq(promotionEnterpriseRecords.claimStatus, 'pending')
        )
      );
    }
    if (actor.role === 'measurer') {
      return eq(promotionEnterpriseRecords.measureAssignedTo, actor.id);
    }
    if (actor.role === 'designer') {
      return eq(promotionEnterpriseRecords.designAssignedTo, actor.id);
    }
    return undefined;
  }

  private buildFilters(options: PromotionListOptions): SQL | undefined {
    const filters: SQL[] = [];
    const actorFilter = this.actorFilter(options.actor);
    if (actorFilter) filters.push(actorFilter);
    if (options.businessStage) {
      filters.push(eq(promotionEnterpriseRecords.businessStage, options.businessStage));
    }
    if (options.ownershipStatus) {
      filters.push(eq(promotionEnterpriseRecords.ownershipStatus, options.ownershipStatus));
    }
    if (options.poolStatuses?.length) {
      filters.push(inArray(promotionEnterpriseRecords.poolStatus, options.poolStatuses));
    }
    if (options.pendingActionRole) {
      filters.push(
        eq(promotionEnterpriseRecords.pendingActionRole, options.pendingActionRole)
      );
    }
    if (options.promoterId) {
      filters.push(eq(promotionEnterpriseRecords.promoterId, options.promoterId));
    }
    if (options.dueBefore) {
      filters.push(lte(promotionEnterpriseRecords.nextFollowUpAt, options.dueBefore));
    }
    const search = options.search?.trim();
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(
        or(
          ilike(promotionEnterpriseRecords.enterpriseName, pattern),
          ilike(promotionEnterpriseRecords.contactPerson, pattern),
          ilike(promotionEnterpriseRecords.phone, pattern),
          ilike(promotionEnterpriseRecords.creditCode, pattern)
        )!
      );
    }
    return filters.length > 0 ? and(...filters) : undefined;
  }

  private async attachRelations(
    rows: PromotionRecord[]
  ): Promise<PromotionRecordWithRelations[]> {
    if (rows.length === 0) return [];

    const staffIds = Array.from(
      new Set(
        rows.flatMap((row) =>
          [
            row.promoterId,
            row.measureAssignedTo,
            row.designAssignedTo,
            row.claimRequestedBy,
            row.claimReviewedBy,
            row.conflictReviewedBy,
          ].filter((value): value is bigint => value !== null)
        )
      )
    );
    const enterpriseIds = Array.from(
      new Set(
        rows
          .map((row) => row.enterpriseId)
          .filter((value): value is bigint => value !== null)
      )
    );
    const [staffRows, enterpriseRows] = await Promise.all([
      staffIds.length > 0
        ? this.transaction
            .select({
              id: adminUsers.id,
              displayName: adminUsers.displayName,
              username: adminUsers.username,
              role: adminUsers.role,
            })
            .from(adminUsers)
            .where(inArray(adminUsers.id, staffIds))
        : Promise.resolve([]),
      enterpriseIds.length > 0
        ? this.transaction
            .select({ id: enterprises.id, name: enterprises.name })
            .from(enterprises)
            .where(inArray(enterprises.id, enterpriseIds))
        : Promise.resolve([]),
    ]);
    const staffMap = new Map(staffRows.map((staff) => [staff.id, staff]));
    const enterpriseMap = new Map(
      enterpriseRows.map((enterprise) => [enterprise.id, enterprise])
    );

    const staff = (id: bigint | null) => (id ? staffMap.get(id) ?? null : null);
    return rows.map((row) => ({
      ...row,
      enterprise: row.enterpriseId
        ? enterpriseMap.get(row.enterpriseId) ?? null
        : null,
      promoter: staff(row.promoterId),
      measureAssignee: staff(row.measureAssignedTo),
      designAssignee: staff(row.designAssignedTo),
      claimRequester: staff(row.claimRequestedBy),
      claimReviewer: staff(row.claimReviewedBy),
      conflictReviewer: staff(row.conflictReviewedBy),
    }));
  }

  async list(options: PromotionListOptions = {}) {
    const where = this.buildFilters(options);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
    const [rows, totals] = await Promise.all([
      this.transaction
        .select()
        .from(promotionEnterpriseRecords)
        .where(where)
        .orderBy(
          desc(promotionEnterpriseRecords.createdAt),
          desc(promotionEnterpriseRecords.id)
        )
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction
        .select({ value: count() })
        .from(promotionEnterpriseRecords)
        .where(where),
    ]);
    return {
      rows: await this.attachRelations(rows),
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async findById(id: bigint, actor?: PromotionActor) {
    const actorFilter = this.actorFilter(actor);
    const rows = await this.transaction
      .select()
      .from(promotionEnterpriseRecords)
      .where(
        actorFilter
          ? and(eq(promotionEnterpriseRecords.id, id), actorFilter)
          : eq(promotionEnterpriseRecords.id, id)
      )
      .limit(1);
    return rows[0] ? (await this.attachRelations(rows))[0] ?? null : null;
  }

  async findDuplicates(input: PromotionDuplicateInput) {
    const duplicateFilters: SQL[] = [
      and(
        eq(promotionEnterpriseRecords.enterpriseName, input.enterpriseName.trim()),
        eq(promotionEnterpriseRecords.phone, input.phone.trim())
      )!,
    ];
    const creditCode = input.creditCode?.trim().toUpperCase();
    if (creditCode) {
      duplicateFilters.push(eq(promotionEnterpriseRecords.creditCode, creditCode));
    }
    const rows = await this.transaction
      .select()
      .from(promotionEnterpriseRecords)
      .where(or(...duplicateFilters))
      .orderBy(asc(promotionEnterpriseRecords.createdAt), asc(promotionEnterpriseRecords.id));
    return this.attachRelations(rows);
  }

  async create(input: NewPromotionRecord) {
    const rows = await this.transaction
      .insert(promotionEnterpriseRecords)
      .values(this.normalizeInput(input))
      .returning();
    return (await this.attachRelations(rows))[0];
  }

  async update(
    id: bigint,
    input: PromotionRecordUpdate,
    timelineEntries: PromotionTimelineEntry[] = []
  ) {
    const values: Record<string, unknown> = {
      ...this.normalizeInput(input),
      updatedAt: new Date(),
    };
    if (timelineEntries.length > 0) {
      values.followUpRecords = sql`${promotionEnterpriseRecords.followUpRecords} || ${JSON.stringify(
        timelineEntries
      )}::jsonb`;
    }
    const rows = await this.transaction
      .update(promotionEnterpriseRecords)
      .set(values)
      .where(eq(promotionEnterpriseRecords.id, id))
      .returning();
    return rows[0] ? (await this.attachRelations(rows))[0] ?? null : null;
  }

  async updateWhere(
    id: bigint,
    conditions: SQL[],
    input: PromotionRecordUpdate,
    timelineEntries: PromotionTimelineEntry[] = []
  ) {
    const values: Record<string, unknown> = {
      ...this.normalizeInput(input),
      updatedAt: new Date(),
    };
    if (timelineEntries.length > 0) {
      values.followUpRecords = sql`${promotionEnterpriseRecords.followUpRecords} || ${JSON.stringify(
        timelineEntries
      )}::jsonb`;
    }
    const rows = await this.transaction
      .update(promotionEnterpriseRecords)
      .set(values)
      .where(and(eq(promotionEnterpriseRecords.id, id), ...conditions))
      .returning();
    return rows[0] ? (await this.attachRelations(rows))[0] ?? null : null;
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(promotionEnterpriseRecords)
      .where(eq(promotionEnterpriseRecords.id, id))
      .returning();
    return rows[0] ?? null;
  }
}

export type NewWorkflowNotificationLog =
  typeof workflowNotificationLogs.$inferInsert;
export type WorkflowNotificationLogRecord =
  typeof workflowNotificationLogs.$inferSelect;

export interface WorkflowNotificationListOptions {
  status?: string;
  recipientStaffId?: bigint;
  channel?: string;
  onlyUnalerted?: boolean;
  page?: number;
  limit?: number;
}

export interface WorkflowNotificationWithRelations
  extends WorkflowNotificationLogRecord {
  record: Pick<
    PromotionRecord,
    'id' | 'enterpriseName' | 'contactPerson' | 'businessStage' | 'ownershipStatus'
  > | null;
  recipientStaff: (Pick<
    PromotionStaffSummary,
    'id' | 'displayName' | 'username' | 'role'
  > & { phone?: string | null }) | null;
}

export class WorkflowNotificationRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private buildFilters(options: WorkflowNotificationListOptions) {
    const filters: SQL[] = [];
    if (options.status) filters.push(eq(workflowNotificationLogs.status, options.status));
    if (options.recipientStaffId) {
      filters.push(eq(workflowNotificationLogs.recipientStaffId, options.recipientStaffId));
    }
    if (options.channel) filters.push(eq(workflowNotificationLogs.channel, options.channel));
    if (options.onlyUnalerted) {
      filters.push(eq(workflowNotificationLogs.isAlerted, false));
    }
    return filters.length > 0 ? and(...filters) : undefined;
  }

  private async attachRelations(rows: WorkflowNotificationLogRecord[]) {
    if (rows.length === 0) return [];
    const recordIds = Array.from(new Set(rows.map((row) => row.recordId)));
    const staffIds = Array.from(
      new Set(
        rows
          .map((row) => row.recipientStaffId)
          .filter((value): value is bigint => value !== null)
      )
    );
    const [recordRows, staffRows] = await Promise.all([
      this.transaction
        .select({
          id: promotionEnterpriseRecords.id,
          enterpriseName: promotionEnterpriseRecords.enterpriseName,
          contactPerson: promotionEnterpriseRecords.contactPerson,
          businessStage: promotionEnterpriseRecords.businessStage,
          ownershipStatus: promotionEnterpriseRecords.ownershipStatus,
        })
        .from(promotionEnterpriseRecords)
        .where(inArray(promotionEnterpriseRecords.id, recordIds)),
      staffIds.length > 0
        ? this.transaction
            .select({
              id: adminUsers.id,
              displayName: adminUsers.displayName,
              username: adminUsers.username,
              phone: adminUsers.phone,
              role: adminUsers.role,
            })
            .from(adminUsers)
            .where(inArray(adminUsers.id, staffIds))
        : Promise.resolve([]),
    ]);
    const recordMap = new Map(recordRows.map((record) => [record.id, record]));
    const staffMap = new Map(staffRows.map((staff) => [staff.id, staff]));
    return rows.map((row) => ({
      ...row,
      record: recordMap.get(row.recordId) ?? null,
      recipientStaff: row.recipientStaffId
        ? staffMap.get(row.recipientStaffId) ?? null
        : null,
    }));
  }

  async create(input: NewWorkflowNotificationLog) {
    const rows = await this.transaction
      .insert(workflowNotificationLogs)
      .values(input)
      .onConflictDoNothing()
      .returning();
    return rows[0] ?? null;
  }

  async list(options: WorkflowNotificationListOptions = {}) {
    const where = this.buildFilters(options);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const [rows, totals, statusRows] = await Promise.all([
      this.transaction
        .select()
        .from(workflowNotificationLogs)
        .where(where)
        .orderBy(desc(workflowNotificationLogs.createdAt), desc(workflowNotificationLogs.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction
        .select({ value: count() })
        .from(workflowNotificationLogs)
        .where(where),
      this.transaction
        .select({ status: workflowNotificationLogs.status, value: count() })
        .from(workflowNotificationLogs)
        .groupBy(workflowNotificationLogs.status),
    ]);
    return {
      rows: await this.attachRelations(rows),
      total: Number(totals[0]?.value ?? 0),
      statusCounts: Object.fromEntries(
        statusRows.map((row) => [row.status, Number(row.value)])
      ),
    };
  }

  async markAlerted(ids: bigint[], recipientStaffId: bigint) {
    if (ids.length === 0) return 0;
    const rows = await this.transaction
      .update(workflowNotificationLogs)
      .set({ isAlerted: true, updatedAt: new Date() })
      .where(
        and(
          inArray(workflowNotificationLogs.id, ids),
          eq(workflowNotificationLogs.recipientStaffId, recipientStaffId)
        )
      )
      .returning({ id: workflowNotificationLogs.id });
    return rows.length;
  }
}
