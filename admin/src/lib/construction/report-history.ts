import { fail, id } from '@/lib/assistant/contracts';

export type ReportHistoryFilters = { projectId?: string; month?: string; kind?: 'daily' | 'weekly' };

/** Month membership follows the saved period start in Shanghai, not delivery time. */
export function reportHistoryFilters(value: ReportHistoryFilters = {}) {
  const projectId = value.projectId === undefined ? undefined : id(value.projectId);
  if (value.kind !== undefined && !['daily', 'weekly'].includes(value.kind)) fail('invalid_construction', 422);
  if (value.month !== undefined && !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value.month)) fail('invalid_construction', 422);
  const start = value.month ? new Date(value.month + '-01T00:00:00+08:00') : undefined;
  const [year, month] = value.month ? value.month.split('-').map(Number) : [];
  const end = value.month ? new Date(Date.UTC(year, month, 1, -8)) : undefined;
  return { projectId, kind: value.kind, start, end };
}
