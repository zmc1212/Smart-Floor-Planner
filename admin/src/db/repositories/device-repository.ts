import { and, desc, eq } from 'drizzle-orm';
import { adminUsers, devices, enterprises } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewDevice = typeof devices.$inferInsert;
export type DeviceRecord = typeof devices.$inferSelect;
export type DeviceUpdate = Partial<
  Omit<NewDevice, 'id' | 'createdAt' | 'updatedAt'>
>;

export interface DeviceWithRelations extends DeviceRecord {
  enterprise: { id: bigint; name: string } | null;
  assignedUser: {
    id: bigint;
    displayName: string;
    username: string;
  } | null;
}

export class DeviceRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private selectWithRelations() {
    return this.transaction
      .select({
        device: devices,
        enterprise: { id: enterprises.id, name: enterprises.name },
        assignedUser: {
          id: adminUsers.id,
          displayName: adminUsers.displayName,
          username: adminUsers.username,
        },
      })
      .from(devices)
      .leftJoin(enterprises, eq(devices.enterpriseId, enterprises.id))
      .leftJoin(adminUsers, eq(devices.assignedUserId, adminUsers.id));
  }

  private normalize(
    rows: Array<{
      device: DeviceRecord;
      enterprise: { id: bigint; name: string } | null;
      assignedUser: {
        id: bigint;
        displayName: string;
        username: string;
      } | null;
    }>
  ) {
    return rows.map((row) => ({
      ...row.device,
      enterprise: row.enterprise,
      assignedUser: row.assignedUser,
    })) as DeviceWithRelations[];
  }

  async list(options: { status?: string; assignedUserId?: bigint } = {}) {
    const where = and(
      options.status ? eq(devices.status, options.status) : undefined,
      options.assignedUserId
        ? eq(devices.assignedUserId, options.assignedUserId)
        : undefined
    );
    const rows = await this.selectWithRelations()
      .where(where)
      .orderBy(desc(devices.createdAt), desc(devices.id));
    return this.normalize(rows);
  }

  async findById(id: bigint) {
    const rows = await this.selectWithRelations()
      .where(eq(devices.id, id))
      .limit(1);
    return rows[0] ? this.normalize(rows)[0] : null;
  }

  async findLatestAssignedToUser(assignedUserId: bigint) {
    const rows = await this.selectWithRelations()
      .where(
        and(
          eq(devices.assignedUserId, assignedUserId),
          eq(devices.status, 'assigned')
        )
      )
      .orderBy(desc(devices.updatedAt), desc(devices.id))
      .limit(1);
    return rows[0] ? this.normalize(rows)[0] : null;
  }

  async create(input: NewDevice) {
    const rows = await this.transaction.insert(devices).values(input).returning();
    return this.findById(rows[0].id);
  }

  async update(id: bigint, input: DeviceUpdate) {
    const rows = await this.transaction
      .update(devices)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(devices.id, id))
      .returning({ id: devices.id });
    return rows[0] ? this.findById(rows[0].id) : null;
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(devices)
      .where(eq(devices.id, id))
      .returning({ id: devices.id });
    return rows[0] ?? null;
  }
}
