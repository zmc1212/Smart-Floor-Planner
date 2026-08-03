import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { adminUsers, aiCreditAccounts, aiCreditLedgers } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiCreditAccountRecord = typeof aiCreditAccounts.$inferSelect;
export type AiCreditLedgerRecord = typeof aiCreditLedgers.$inferSelect;
export type AiCreditLedgerType = 'grant' | 'hold' | 'consume' | 'release' | 'adjust';

export class AiCreditRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async ensureAccount(enterpriseId: bigint) {
    await this.transaction
      .insert(aiCreditAccounts)
      .values({ enterpriseId, balance: BigInt(0), frozenBalance: BigInt(0), version: 0 })
      .onConflictDoNothing({ target: aiCreditAccounts.enterpriseId });
    return this.findAccount(enterpriseId);
  }

  async findAccount(enterpriseId: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiCreditAccounts)
      .where(eq(aiCreditAccounts.enterpriseId, enterpriseId))
      .limit(1);
    return rows[0] ?? null;
  }

  async claimLedger(input: {
    enterpriseId: bigint;
    generationId: bigint | null;
    operatorId: bigint | null;
    operationId: string;
    type: AiCreditLedgerType;
    amount: bigint;
    note?: string;
    metadata?: Record<string, unknown>;
  }) {
    const rows = await this.transaction
      .insert(aiCreditLedgers)
      .values({ ...input, status: 'pending' })
      .onConflictDoNothing({ target: aiCreditLedgers.operationId })
      .returning();
    if (rows[0]) return { ledger: rows[0], claimed: true };

    const existing = await this.findLedgerByOperationId(input.operationId);
    if (!existing) throw new Error('AI credit operation could not be claimed');
    return { ledger: existing, claimed: false };
  }

  async findLedgerByOperationId(operationId: string) {
    const rows = await this.transaction
      .select()
      .from(aiCreditLedgers)
      .where(eq(aiCreditLedgers.operationId, operationId))
      .limit(1);
    return rows[0] ?? null;
  }

  listWithOperators(enterpriseId: bigint, limit = 30) {
    return this.transaction
      .select({
        ledger: aiCreditLedgers,
        operatorDisplayName: adminUsers.displayName,
        operatorUsername: adminUsers.username,
      })
      .from(aiCreditLedgers)
      .leftJoin(adminUsers, eq(aiCreditLedgers.operatorId, adminUsers.id))
      .where(eq(aiCreditLedgers.enterpriseId, enterpriseId))
      .orderBy(desc(aiCreditLedgers.createdAt))
      .limit(limit);
  }

  async applyBalance(input: {
    enterpriseId: bigint;
    balanceDelta: bigint;
    frozenDelta: bigint;
    requireAvailableAtLeast?: bigint;
    requireBalanceAtLeast?: bigint;
    requireFrozenAtLeast?: bigint;
  }) {
    const conditions = [eq(aiCreditAccounts.enterpriseId, input.enterpriseId)];
    if (input.requireAvailableAtLeast !== undefined) {
      conditions.push(sql`${aiCreditAccounts.balance} - ${aiCreditAccounts.frozenBalance} >= ${input.requireAvailableAtLeast}`);
    }
    if (input.requireBalanceAtLeast !== undefined) {
      conditions.push(gte(aiCreditAccounts.balance, input.requireBalanceAtLeast));
    }
    if (input.requireFrozenAtLeast !== undefined) {
      conditions.push(gte(aiCreditAccounts.frozenBalance, input.requireFrozenAtLeast));
    }
    const rows = await this.transaction
      .update(aiCreditAccounts)
      .set({
        balance: sql`${aiCreditAccounts.balance} + ${input.balanceDelta}`,
        frozenBalance: sql`${aiCreditAccounts.frozenBalance} + ${input.frozenDelta}`,
        version: sql`${aiCreditAccounts.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return rows[0] ?? null;
  }

  async completeLedger(id: bigint, account: AiCreditAccountRecord) {
    const rows = await this.transaction
      .update(aiCreditLedgers)
      .set({
        status: 'completed',
        balanceAfter: account.balance,
        frozenAfter: account.frozenBalance,
        updatedAt: new Date(),
      })
      .where(eq(aiCreditLedgers.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async failLedger(id: bigint) {
    const rows = await this.transaction
      .update(aiCreditLedgers)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(aiCreditLedgers.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
