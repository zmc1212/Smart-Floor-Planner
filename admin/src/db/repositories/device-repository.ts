import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  adminUsers,
  devices,
  deviceUserBindings,
  enterprises,
} from '@/db/schema';
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
  assignedUsers: Array<{
    id: bigint;
    displayName: string;
    username: string;
  }>;
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

  private async attachAssignedUsers(records: DeviceWithRelations[]) {
    if (records.length === 0) return records;
    const deviceIds = records.map((record) => record.id);
    const bindings = await this.transaction
      .select({
        deviceId: deviceUserBindings.deviceId,
        user: {
          id: adminUsers.id,
          displayName: adminUsers.displayName,
          username: adminUsers.username,
        },
      })
      .from(deviceUserBindings)
      .innerJoin(
        adminUsers,
        eq(deviceUserBindings.adminUserId, adminUsers.id)
      )
      .where(inArray(deviceUserBindings.deviceId, deviceIds));
    const assignedUsersByDevice = new Map<
      bigint,
      Array<{ id: bigint; displayName: string; username: string }>
    >();
    for (const binding of bindings) {
      const assignedUsers = assignedUsersByDevice.get(binding.deviceId) ?? [];
      assignedUsers.push(binding.user);
      assignedUsersByDevice.set(binding.deviceId, assignedUsers);
    }
    return records.map((record) => {
      const assignedUsers = assignedUsersByDevice.get(record.id) ?? [];
      return {
        ...record,
        assignedUsers,
        // Keep the legacy singular relation available to older API consumers.
        assignedUser: assignedUsers[0] ?? record.assignedUser,
      };
    });
  }

  async list(options: { status?: string; assignedUserId?: bigint } = {}) {
    const where = and(
      options.status ? eq(devices.status, options.status) : undefined
    );
    const rows = await this.selectWithRelations()
      .where(where)
      .orderBy(desc(devices.createdAt), desc(devices.id));
    const records = await this.attachAssignedUsers(this.normalize(rows));
    return options.assignedUserId
      ? records.filter((record) =>
          record.assignedUsers.some(
            (assignedUser) => assignedUser.id === options.assignedUserId
          )
        )
      : records;
  }

  async findById(id: bigint) {
    const rows = await this.selectWithRelations()
      .where(eq(devices.id, id))
      .limit(1);
    if (!rows[0]) return null;
    return (await this.attachAssignedUsers(this.normalize(rows)))[0];
  }

  async findLatestAssignedToUser(assignedUserId: bigint) {
    const rows = await this.selectWithRelations()
      .where(eq(devices.status, 'assigned'))
      .orderBy(desc(devices.updatedAt), desc(devices.id));
    const records = await this.attachAssignedUsers(this.normalize(rows));
    return (
      records.find((record) =>
        record.assignedUsers.some(
          (assignedUser) => assignedUser.id === assignedUserId
        )
      ) ?? null
    );
  }

  async create(
    input: NewDevice,
    assignedUserIds: bigint[] = input.assignedUserId
      ? [input.assignedUserId]
      : []
  ) {
    const rows = await this.transaction.insert(devices).values(input).returning();
    return this.replaceAssignedUsers(
      rows[0].id,
      assignedUserIds,
      input.enterpriseId ?? null
    );
  }

  async update(
    id: bigint,
    input: DeviceUpdate,
    assignedUserIds?: bigint[]
  ) {
    const rows = await this.transaction
      .update(devices)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(devices.id, id))
      .returning({ id: devices.id });
    if (!rows[0]) return null;
    return assignedUserIds
      ? this.replaceAssignedUsers(
          rows[0].id,
          assignedUserIds,
          input.enterpriseId ?? null
        )
      : this.findById(rows[0].id);
  }

  async replaceAssignedUsers(
    deviceId: bigint,
    assignedUserIds: bigint[],
    enterpriseId: bigint | null
  ) {
    await this.transaction
      .delete(deviceUserBindings)
      .where(eq(deviceUserBindings.deviceId, deviceId));
    if (assignedUserIds.length > 0) {
      await this.transaction.insert(deviceUserBindings).values(
        assignedUserIds.map((adminUserId) => ({
          deviceId,
          adminUserId,
          enterpriseId,
        }))
      );
    }
    return this.findById(deviceId);
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(devices)
      .where(eq(devices.id, id))
      .returning({ id: devices.id });
    return rows[0] ?? null;
  }
}
