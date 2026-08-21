export const WORKBENCH_THEME_STORAGE_KEY = 'sfp-ai-workbench-theme';

export type WorkbenchTheme = 'dark' | 'light';

export function readStoredWorkbenchTheme(value: string | null | undefined): WorkbenchTheme {
  return value === 'light' ? 'light' : 'dark';
}

/** Floor-plan control PNG always occupies the first reference slot on the workbench. */
export function workbenchMaxUserReferenceImages(maxReferenceImages: number) {
  return Math.max(0, Math.trunc(Number(maxReferenceImages) || 0) - 1);
}

/** Designer-only survey-canvas snapshot preview for a bound workbench conversation. */
export const WORKBENCH_FLOOR_PLAN_PREVIEW_VERSION = '3';
export const WORKBENCH_WHOLE_FLOOR_SCOPE_KEY = 'whole_floor_plan';

export function workbenchFloorPlanPreviewPath(workflowId: string, roomId?: string) {
  const id = workflowId.trim();
  if (!id) return '';
  const params = new URLSearchParams({ v: WORKBENCH_FLOOR_PLAN_PREVIEW_VERSION });
  const trimmedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
  if (trimmedRoomId) params.set('roomId', trimmedRoomId);
  return `/api/ai/workflows/${encodeURIComponent(id)}/floor-plan-preview?${params.toString()}`;
}

/** Composer reference-slot URL: whole-plan snapshot, or the same room crop the batch will upload. */
export function workbenchComposerControlPreviewUrl(workflowId: string, scopeSelection: string) {
  const selection = scopeSelection.trim();
  const roomId = selection && selection !== WORKBENCH_WHOLE_FLOOR_SCOPE_KEY ? selection : '';
  return workbenchFloorPlanPreviewPath(workflowId, roomId);
}
