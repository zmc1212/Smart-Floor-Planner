import { eq } from 'drizzle-orm';
import {
  CommercialRepository,
  PlatformConfigRepository,
  PromotionRecordRepository,
  type EnterpriseOrderWithRelations,
} from '@/db/repositories';
import { enterprises, packages, promotionEnterpriseRecords } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { normalizePlatformPromotionConfig } from '@/lib/platform-promotion-config';

export async function syncCommissionForPostgresOrder(
  transaction: PostgresTransaction,
  order: EnterpriseOrderWithRelations,
  operatorId: bigint
) {
  const commercial = new CommercialRepository(transaction);
  const record = await new PromotionRecordRepository(transaction).findById(order.recordId);
  if (!record || record.ownershipStatus === 'conflict_pending' || !record.promoterId) return null;
  if (order.status === 'cancelled') return commercial.voidCommissionForOrder(order.id, operatorId);
  if (order.status !== 'paid') return null;

  const [packageRows, config, enterpriseRows] = await Promise.all([
    transaction.select().from(packages).where(eq(packages.name, order.packageName)).limit(1),
    new PlatformConfigRepository(transaction).findByKey('default'),
    record.enterpriseId
      ? transaction.select({ commission: enterprises.groundPromotionFixedCommission }).from(enterprises).where(eq(enterprises.id, record.enterpriseId)).limit(1)
      : Promise.resolve([]),
  ]);
  const packageCommission = Number(packageRows[0]?.promotionCommission ?? 0);
  const enterpriseCommission = Number(enterpriseRows[0]?.commission ?? 0);
  const platformConfig = normalizePlatformPromotionConfig(config?.promotionConfig);
  const commissionAmount = Math.max(
    packageCommission > 0 ? packageCommission : enterpriseCommission > 0 ? enterpriseCommission : platformConfig.defaultCommissionAmount,
    0
  );
  const now = new Date();
  await transaction.update(promotionEnterpriseRecords).set({
    businessStage: 'paid', pendingActionRole: 'none', nextFollowUpAt: null,
    measureDueAt: null, designDueAt: null, lastActivityAt: now, updatedAt: now,
  }).where(eq(promotionEnterpriseRecords.id, record.id));
  return commercial.upsertCommission({
    recordId: record.id, orderId: order.id, promoterId: record.promoterId,
    enterpriseId: record.enterpriseId, commissionType: 'fixed_per_paid_order',
    commissionAmount: commissionAmount.toFixed(2), status: 'pending_settlement', generatedAt: now,
  });
}
