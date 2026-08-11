import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  adminUserCapabilityOverrides,
  enterpriseRoleCapabilities,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type CapabilityOverrideEffect = 'inherit' | 'allow' | 'deny';

export class ActionPermissionRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async getRoleDefaults(enterpriseId: bigint, capabilityKey: string) {
    const rows = await this.transaction
      .select()
      .from(enterpriseRoleCapabilities)
      .where(and(
        eq(enterpriseRoleCapabilities.enterpriseId, enterpriseId),
        eq(enterpriseRoleCapabilities.capabilityKey, capabilityKey)
      ));
    return new Map(rows.map((row) => [row.roleKey, row.allowed]));
  }

  async getUserOverrides(
    enterpriseId: bigint,
    capabilityKey: string,
    userIds?: bigint[]
  ) {
    const filters = [
      eq(adminUserCapabilityOverrides.enterpriseId, enterpriseId),
      eq(adminUserCapabilityOverrides.capabilityKey, capabilityKey),
    ];
    if (userIds?.length) {
      filters.push(inArray(adminUserCapabilityOverrides.adminUserId, userIds));
    }
    const rows = await this.transaction
      .select()
      .from(adminUserCapabilityOverrides)
      .where(and(...filters))
      .orderBy(asc(adminUserCapabilityOverrides.adminUserId));
    return new Map(rows.map((row) => [row.adminUserId, row.allowed]));
  }

  async resolve(
    enterpriseId: bigint,
    userId: bigint,
    role: string,
    capabilityKey: string
  ) {
    const [defaults, overrides] = await Promise.all([
      this.getRoleDefaults(enterpriseId, capabilityKey),
      this.getUserOverrides(enterpriseId, capabilityKey, [userId]),
    ]);
    return overrides.get(userId) ?? defaults.get(role) ?? false;
  }

  async replacePolicy(input: {
    enterpriseId: bigint;
    capabilityKey: string;
    updatedBy: bigint;
    roleDefaults: Record<string, boolean>;
    userOverrides: Array<{ userId: bigint; effect: CapabilityOverrideEffect }>;
  }) {
    const now = new Date();
    const roleRows = Object.entries(input.roleDefaults).map(([roleKey, allowed]) => ({
      enterpriseId: input.enterpriseId,
      roleKey,
      capabilityKey: input.capabilityKey,
      allowed,
      updatedBy: input.updatedBy,
      updatedAt: now,
    }));
    for (const row of roleRows) {
      await this.transaction
        .insert(enterpriseRoleCapabilities)
        .values(row)
        .onConflictDoUpdate({
          target: [
            enterpriseRoleCapabilities.enterpriseId,
            enterpriseRoleCapabilities.roleKey,
            enterpriseRoleCapabilities.capabilityKey,
          ],
          set: { allowed: row.allowed, updatedBy: row.updatedBy, updatedAt: now },
        });
    }

    await this.transaction
      .delete(adminUserCapabilityOverrides)
      .where(and(
        eq(adminUserCapabilityOverrides.enterpriseId, input.enterpriseId),
        eq(adminUserCapabilityOverrides.capabilityKey, input.capabilityKey)
      ));
    const overrideRows = input.userOverrides
      .filter((item) => item.effect !== 'inherit')
      .map((item) => ({
        enterpriseId: input.enterpriseId,
        adminUserId: item.userId,
        capabilityKey: input.capabilityKey,
        allowed: item.effect === 'allow',
        updatedBy: input.updatedBy,
        updatedAt: now,
      }));
    if (overrideRows.length) {
      await this.transaction.insert(adminUserCapabilityOverrides).values(overrideRows);
    }
  }

  deleteUserOverrides(userId: bigint) {
    return this.transaction
      .delete(adminUserCapabilityOverrides)
      .where(eq(adminUserCapabilityOverrides.adminUserId, userId));
  }
}
