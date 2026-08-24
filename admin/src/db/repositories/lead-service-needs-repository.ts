import { and, asc, eq } from 'drizzle-orm';
import { leadServiceNeeds } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export const LEAD_SERVICE_NEED_KEYS = [
  'old_house_consultation',
  'materials_consultation',
  'partial_space_advice',
] as const;

export type LeadServiceNeedKey = (typeof LEAD_SERVICE_NEED_KEYS)[number];
export type LeadServiceNeedSource = 'customer' | 'designer';

export const LEAD_SERVICE_NEED_LABELS: Record<LeadServiceNeedKey, string> = {
  old_house_consultation: '旧房改造咨询',
  materials_consultation: '主材咨询',
  partial_space_advice: '局部空间建议',
};

export type LeadServiceNeedRecord = typeof leadServiceNeeds.$inferSelect;

export function isLeadServiceNeedKey(value: unknown): value is LeadServiceNeedKey {
  return typeof value === 'string'
    && (LEAD_SERVICE_NEED_KEYS as readonly string[]).includes(value);
}

export function normalizeLeadServiceNeedKeys(value: unknown): LeadServiceNeedKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isLeadServiceNeedKey))];
}

export class LeadServiceNeedsRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async listForLead(enterpriseId: bigint, leadId: bigint): Promise<LeadServiceNeedRecord[]> {
    return this.transaction
      .select()
      .from(leadServiceNeeds)
      .where(and(
        eq(leadServiceNeeds.enterpriseId, enterpriseId),
        eq(leadServiceNeeds.leadId, leadId),
      ))
      .orderBy(asc(leadServiceNeeds.id));
  }

  async replaceForLead(input: {
    enterpriseId: bigint;
    leadId: bigint;
    needKeys: LeadServiceNeedKey[];
    source: LeadServiceNeedSource;
    updatedByUserId?: bigint | null;
    updatedByStaffId?: bigint | null;
  }): Promise<LeadServiceNeedRecord[]> {
    const needKeys = normalizeLeadServiceNeedKeys(input.needKeys);
    await this.transaction
      .delete(leadServiceNeeds)
      .where(and(
        eq(leadServiceNeeds.enterpriseId, input.enterpriseId),
        eq(leadServiceNeeds.leadId, input.leadId),
      ));

    if (!needKeys.length) return [];

    return this.transaction
      .insert(leadServiceNeeds)
      .values(needKeys.map((needKey) => ({
        enterpriseId: input.enterpriseId,
        leadId: input.leadId,
        needKey,
        source: input.source,
        updatedByUserId: input.updatedByUserId ?? null,
        updatedByStaffId: input.updatedByStaffId ?? null,
      })))
      .returning();
  }
}
