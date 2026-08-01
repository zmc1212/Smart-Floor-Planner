import {
  and,
  count,
  desc,
  eq,
  type SQL,
} from 'drizzle-orm';
import {
  adminUsers,
  enterprises,
  floorPlans,
  measurements,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewMeasurement = typeof measurements.$inferInsert;
export type MeasurementRecord = typeof measurements.$inferSelect;

export interface MeasurementWithRelations extends MeasurementRecord {
  operator: {
    id: bigint;
    displayName: string;
    username: string;
    role: string;
  } | null;
  enterprise: { id: bigint; name: string } | null;
  floorPlan: { id: bigint; name: string; status: string } | null;
}

export interface MeasurementListOptions {
  type?: string;
  operatorId?: bigint;
  floorPlanId?: bigint;
  deviceId?: string;
  page?: number;
  limit?: number;
}

export class MeasurementRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private buildFilters(options: MeasurementListOptions) {
    const filters: SQL[] = [];
    if (options.type && options.type !== 'all') {
      filters.push(eq(measurements.type, options.type));
    }
    if (options.operatorId) {
      filters.push(eq(measurements.operatorId, options.operatorId));
    }
    if (options.floorPlanId) {
      filters.push(eq(measurements.floorPlanId, options.floorPlanId));
    }
    if (options.deviceId) {
      filters.push(eq(measurements.deviceId, options.deviceId));
    }
    return filters.length > 0 ? and(...filters) : undefined;
  }

  private selectWithRelations() {
    return this.transaction
      .select({
        measurement: measurements,
        operator: {
          id: adminUsers.id,
          displayName: adminUsers.displayName,
          username: adminUsers.username,
          role: adminUsers.role,
        },
        enterprise: { id: enterprises.id, name: enterprises.name },
        floorPlan: {
          id: floorPlans.id,
          name: floorPlans.name,
          status: floorPlans.status,
        },
      })
      .from(measurements)
      .leftJoin(adminUsers, eq(measurements.operatorId, adminUsers.id))
      .leftJoin(enterprises, eq(measurements.enterpriseId, enterprises.id))
      .leftJoin(floorPlans, eq(measurements.floorPlanId, floorPlans.id));
  }

  async list(options: MeasurementListOptions = {}) {
    const where = this.buildFilters(options);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 50), 100);
    const [rows, totals] = await Promise.all([
      this.selectWithRelations()
        .where(where)
        .orderBy(desc(measurements.measuredAt), desc(measurements.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction
        .select({ value: count() })
        .from(measurements)
        .where(where),
    ]);
    return {
      rows: rows.map((row) => ({
        ...row.measurement,
        operator: row.operator,
        enterprise: row.enterprise,
        floorPlan: row.floorPlan,
      })) as MeasurementWithRelations[],
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async count(options: MeasurementListOptions = {}) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(measurements)
      .where(this.buildFilters(options));
    return Number(rows[0]?.value ?? 0);
  }

  async findById(id: bigint) {
    const rows = await this.selectWithRelations()
      .where(eq(measurements.id, id))
      .limit(1);
    if (!rows[0]) return null;
    return {
      ...rows[0].measurement,
      operator: rows[0].operator,
      enterprise: rows[0].enterprise,
      floorPlan: rows[0].floorPlan,
    } as MeasurementWithRelations;
  }

  async create(input: NewMeasurement) {
    const rows = await this.transaction
      .insert(measurements)
      .values(input)
      .returning();
    return this.findById(rows[0].id);
  }
}
