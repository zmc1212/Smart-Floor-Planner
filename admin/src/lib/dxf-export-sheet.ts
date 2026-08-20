import type { FloorPlanRecord } from '@/db/repositories';
import { EnterpriseRepository, LeadRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { formatDxfSheetDate, type DxfSheetMeta } from '@/lib/dxf-sheet';

function nonempty(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function buildFormalSurveyDxfSheet(input: {
  planName?: string | null;
  enterpriseName?: string | null;
  designerName?: string | null;
  date?: Date | string | null;
}): DxfSheetMeta {
  return {
    planName: nonempty(input.planName),
    enterpriseName: nonempty(input.enterpriseName),
    designerName: nonempty(input.designerName),
    date: formatDxfSheetDate(input.date),
  };
}

export async function resolveFormalSurveyDxfSheet(
  transaction: PostgresTransaction,
  plan: Pick<FloorPlanRecord, 'id' | 'name' | 'enterpriseId' | 'completedAt'>,
) {
  const lead = await new LeadRepository(transaction).findByFloorPlanId(plan.id);
  const enterpriseId = lead?.enterpriseId ?? plan.enterpriseId;
  const enterprise = enterpriseId
    ? await new EnterpriseRepository(transaction).findById(enterpriseId)
    : null;
  return buildFormalSurveyDxfSheet({
    planName: plan.name,
    enterpriseName: enterprise?.name,
    designerName: lead?.assignedUser?.displayName || lead?.assignedUser?.username,
    date: plan.completedAt,
  });
}
