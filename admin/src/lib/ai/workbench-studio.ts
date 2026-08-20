export const WORKBENCH_THEME_STORAGE_KEY = 'sfp-ai-workbench-theme';

export type WorkbenchTheme = 'dark' | 'light';

export function readStoredWorkbenchTheme(value: string | null | undefined): WorkbenchTheme {
  return value === 'light' ? 'light' : 'dark';
}

/** Floor-plan control PNG always occupies the first reference slot on the workbench. */
export function workbenchMaxUserReferenceImages(maxReferenceImages: number) {
  return Math.max(0, Math.trunc(Number(maxReferenceImages) || 0) - 1);
}

/** Designer-only survey-graph control preview for a bound workbench conversation. */
export const WORKBENCH_FLOOR_PLAN_PREVIEW_VERSION = '2';

export function workbenchFloorPlanPreviewPath(workflowId: string) {
  const id = workflowId.trim();
  return id
    ? `/api/ai/workflows/${encodeURIComponent(id)}/floor-plan-preview?v=${WORKBENCH_FLOOR_PLAN_PREVIEW_VERSION}`
    : '';
}
