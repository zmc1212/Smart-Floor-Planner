import type { FloorPlanRecord } from '@/db/repositories';
import { EnterpriseRepository, LeadRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { formatDxfSheetDate, type DxfSheetMeta } from '@/lib/dxf-sheet';

function nonempty(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function sanitizeDxfFileStem(name: string) {
  return name
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || '户型';
}

/** Format lead area for the DXF project title (e.g. 120㎡). */
export function formatDxfProjectArea(area?: string | number | null) {
  if (area == null || area === '') return undefined;
  const numeric = typeof area === 'number' ? area : Number(String(area).trim());
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const label = Number.isInteger(numeric) ? String(numeric) : String(Math.round(numeric * 100) / 100);
  return `${label}㎡`;
}

/**
 * Project title: customer name + community + area (fallback to floor-plan name).
 */
export function formatDxfProjectName(input: {
  customerName?: string | null;
  communityName?: string | null;
  area?: string | number | null;
  fallbackPlanName?: string | null;
}) {
  const parts = [
    nonempty(input.customerName),
    nonempty(input.communityName),
    formatDxfProjectArea(input.area),
  ].filter((part): part is string => Boolean(part));
  if (parts.length) return parts.join(' ');
  return nonempty(input.fallbackPlanName);
}

/** Local export timestamp for DXF download names: YYYYMMDDHHmmss */
export function formatDxfExportTimestamp(value?: Date | string | null) {
  const parsed = value instanceof Date
    ? value
    : typeof value === 'string' && value.trim()
      ? new Date(value)
      : new Date();
  const date = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Download name: customer + community + area + time. */
export function formatDxfExportFileName(input: {
  customerName?: string | null;
  communityName?: string | null;
  area?: string | number | null;
  fallbackPlanName?: string | null;
  at?: Date | string | null;
}) {
  const project = formatDxfProjectName(input) || '户型';
  const stem = sanitizeDxfFileStem(`${project} ${formatDxfExportTimestamp(input.at)}`);
  return /\.dxf$/i.test(stem) ? stem : `${stem}.dxf`;
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
  options?: { exportedAt?: Date | string | null },
) {
  const lead = await new LeadRepository(transaction).findByFloorPlanId(plan.id);
  const enterpriseId = lead?.enterpriseId ?? plan.enterpriseId;
  const enterprise = enterpriseId
    ? await new EnterpriseRepository(transaction).findById(enterpriseId)
    : null;
  const projectName = formatDxfProjectName({
    customerName: lead?.name,
    communityName: lead?.communityName,
    area: lead?.area,
    fallbackPlanName: plan.name,
  });
  return {
    sheet: buildFormalSurveyDxfSheet({
      planName: projectName,
      enterpriseName: enterprise?.name,
      designerName: lead?.assignedUser?.displayName || lead?.assignedUser?.username,
      date: plan.completedAt,
    }),
    fileName: formatDxfExportFileName({
      customerName: lead?.name,
      communityName: lead?.communityName,
      area: lead?.area,
      fallbackPlanName: plan.name,
      at: options?.exportedAt ?? new Date(),
    }),
  };
}
