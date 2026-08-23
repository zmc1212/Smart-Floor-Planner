export const WORKBENCH_THEME_STORAGE_KEY = 'sfp-ai-workbench-theme';

export type WorkbenchTheme = 'dark' | 'light';

export function readStoredWorkbenchTheme(value: string | null | undefined): WorkbenchTheme {
  return value === 'light' ? 'light' : 'dark';
}

/** Floor-plan control PNG occupies the first reference slot when a formal plan is bound. */
export function workbenchMaxUserReferenceImages(maxReferenceImages: number, reserveControlSlot = true) {
  const cap = Math.max(0, Math.trunc(Number(maxReferenceImages) || 0));
  return reserveControlSlot ? Math.max(0, cap - 1) : cap;
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

export function resolveWorkbenchDefaultRemoteModel(
  generateProviders: Array<{ modelMappings?: Record<string, string | undefined> }> | undefined
) {
  return String(generateProviders?.[0]?.modelMappings?.['image.generate.standard'] || '').trim();
}

export function serializeWorkbenchProviderState(input: {
  actionEnabled: boolean;
  generateProviders: Array<{ modelMappings?: Record<string, string | undefined> }>;
  editProviders: unknown[];
}) {
  return {
    actionEnabled: input.actionEnabled,
    supportsGenerate: input.generateProviders.length > 0,
    supportsEdit: input.editProviders.length > 0,
    defaultRemoteModel: resolveWorkbenchDefaultRemoteModel(input.generateProviders),
  };
}

/** Provider mapping is the default display/preselect only; it never filters the list. */
export function pickDefaultCreationModel<T extends { id: string; isDefault?: boolean; remoteModel?: string }>(
  models: T[] | undefined,
  defaultRemoteModel?: string
): T | undefined {
  if (!models?.length) return undefined;
  const mapped = String(defaultRemoteModel || '').trim();
  if (mapped) {
    const match = models.find((item) => item.id && item.remoteModel === mapped);
    if (match) return match;
  }
  return models.find((item) => item.id && item.isDefault) || models.find((item) => Boolean(item.id)) || models[0];
}
