import { fail, id } from '@/lib/assistant/contracts';

export type PilotReportScopeStatus = 'active' | 'empty';

export type PilotReportScope = {
  /** In-scope project ids in pilot-scope order, deduplicated. */
  projectIds: string[];
  status: PilotReportScopeStatus;
  /** The pilot project set is always the upper bound of this calculation. */
  pilotScopeApplied: boolean;
  /** True when the enterprise report filter was non-empty and narrowed the set. */
  reportFilterApplied: boolean;
};

function normalizeProjectIds(value: readonly string[]): string[] {
  if (!Array.isArray(value)) fail('pilot_report_scope_invalid', 422);
  return [...new Set(value.map(projectId => id(projectId)))];
}

/** Intersect the saved pilot project scope with the enterprise weekly report
 * `project_ids` filter.
 *
 * This is a pure calculation: it does not read the database, resolve project
 * ownership, generate or send reports. The pilot set is always the upper bound.
 * An empty enterprise filter means "no enterprise restriction", so every pilot
 * project is returned; a non-empty filter returns the intersection. No overlap,
 * or an empty pilot set, returns `empty` and never expands to the enterprise.
 * Output keeps the pilot-scope order and neither input array is modified. */
export function computePilotReportScope(input: {
  pilotProjectIds: readonly string[];
  reportProjectIds: readonly string[];
}): PilotReportScope {
  const pilot = normalizeProjectIds(input.pilotProjectIds);
  const report = normalizeProjectIds(input.reportProjectIds);
  const reportFilterApplied = report.length > 0;
  const allowed = new Set(report);
  const projectIds = reportFilterApplied ? pilot.filter(projectId => allowed.has(projectId)) : pilot;
  return {
    projectIds,
    status: projectIds.length ? 'active' : 'empty',
    pilotScopeApplied: true,
    reportFilterApplied,
  };
}

export type PilotReportDeliveryCheck = {
  scopeStatus: PilotReportScopeStatus;
  scopeVersion: number | null;
  reportProjectIds: string[];
  allowedProjectIds: string[];
  excludedProjectIds: string[];
  deliverable: boolean;
};

/** Check whether one immutable report facts snapshot may be delivered under the
 * current pilot scope. Every projects entry in the snapshot must be in scope;
 * an empty or unconfirmable snapshot is not deliverable. The snapshot itself is
 * never trimmed or rewritten, so out-of-scope deliveries can only be revoked. */
export function validatePilotReportDelivery(input: {
  pilotProjectIds: readonly string[];
  reportProjectIds: readonly string[];
  scopeVersion?: number | null;
}): PilotReportDeliveryCheck {
  const pilot = normalizeProjectIds(input.pilotProjectIds);
  const report = normalizeProjectIds(input.reportProjectIds);
  const allowed = new Set(pilot);
  const allowedProjectIds = report.filter(projectId => allowed.has(projectId));
  const excludedProjectIds = report.filter(projectId => !allowed.has(projectId));
  return {
    scopeStatus: pilot.length ? 'active' : 'empty',
    scopeVersion: input.scopeVersion ?? null,
    reportProjectIds: report,
    allowedProjectIds,
    excludedProjectIds,
    deliverable: pilot.length > 0 && report.length > 0 && excludedProjectIds.length === 0,
  };
}
