import {
  renderMiniAiFloorPlanControlPng,
  resolveMiniAiFloorPlanTarget,
  type MiniAiFloorPlanTarget,
} from '@/lib/ai/mini-ai-floorplan';
import {
  resolveFloorPlanControlPng,
  type FloorPlanPreviewSource,
} from '@/lib/floor-plan-preview';
import { FLOOR_PLAN_SNAPSHOT_SIZE } from '@/lib/survey-floor-plan-snapshot';
import {
  composeFloorPlanConstrainedPrompt,
  type FloorPlanConstraintPromptInput,
} from '@/lib/ai/floor-plan-constraint-prompt';

export type CreationBatchControlKind =
  | 'survey_snapshot'
  | 'room_crop'
  | 'survey_snapshot_fallback';

export type CreationBatchRenderMode = 'whole_floor_plan' | 'single_room_photo' | 'soft_furnishing';

const SINGLE_ROOM_FULL_SPACE_BOUNDARY = `SINGLE-ROOM FULL-SPACE REDESIGN BOUNDARY

Use the supplied site photo as the authority for the existing room envelope and output camera. Preserve the camera position, viewing direction, perspective, lens height, field of view, crop, walls, columns, doors, windows, openings, and their relative geometry.

You may redesign every visible interior design layer inside that fixed envelope: wall, ceiling, and floor finishes; colors and materials; built-in and fixed cabinetry; lighting design and fixtures; movable furniture; curtains, rugs, artwork, plants, and decorative objects. Produce one coherent, fully redesigned room rather than a partial furniture swap.

Do not add, remove, move, resize, or reshape structural elements or openings. Any non-site reference image supplies style, material, color, furniture, and decoration only; it must not replace the site photo camera or architecture.`;

const SOFT_FURNISHING_ONLY_BOUNDARY = `SINGLE-ROOM SOFT-FURNISHING-ONLY BOUNDARY

Use the supplied site photo as the authority for both the existing room and output camera. Preserve exactly the camera position, viewing direction, perspective, lens height, field of view, crop, walls, columns, ceiling, floor, doors, windows, openings, stairs, fixed cabinetry, built-ins, sanitary fixtures, kitchen fixtures, architectural lighting, and all visible hard-finish materials, colors, patterns, and construction details.

Only replace, rearrange, add, or remove movable soft-furnishing layers: freestanding furniture, loose lamps, curtains, rugs, bedding, cushions, artwork, mirrors, plants, and decorative objects. Keep the result plausible without construction work.

Do not repaint, reclad, demolish, rebuild, or redesign any architecture, hard finish, fixed installation, or built-in element. Any non-site reference image supplies soft-furnishing style only; it must not replace the site photo camera, architecture, or hard finishes.`;

export function composePhotoFirstCreationBatchPrompt(input: {
  renderMode: CreationBatchRenderMode;
  prompt: string;
}) {
  const userPrompt = input.prompt.trim();
  const boundary = input.renderMode === 'soft_furnishing'
    ? SOFT_FURNISHING_ONLY_BOUNDARY
    : input.renderMode === 'single_room_photo'
      ? SINGLE_ROOM_FULL_SPACE_BOUNDARY
      : '';
  if (!boundary) return userPrompt;
  return [
    boundary,
    userPrompt ? `USER OR TEMPLATE DESIGN REQUEST\n${userPrompt}` : '',
    `FINAL ENFORCEMENT
The mode boundary above is mandatory and overrides any conflicting user or template instruction. Preserve uncertain existing conditions instead of inventing construction changes. Return a photorealistic interior image with no text, labels, split-screen comparison, mood board, or collage.`,
  ].filter(Boolean).join('\n\n');
}

export function shouldAttachCreationBatchFloorPlanControl(input: {
  renderMode?: CreationBatchRenderMode;
  hasFloorPlan: boolean;
}) {
  if (!input.hasFloorPlan) return false;
  return input.renderMode === 'whole_floor_plan';
}

export function requiresCreationBatchSitePhoto(input: {
  renderMode?: CreationBatchRenderMode;
  sitePhotoAssetIds?: readonly unknown[] | null;
  hasSitePhoto?: boolean;
}) {
  const photoFirst = input.renderMode === 'single_room_photo'
    || input.renderMode === 'soft_furnishing';
  if (!photoFirst) return false;
  if (input.sitePhotoAssetIds !== undefined && input.sitePhotoAssetIds !== null) {
    return input.sitePhotoAssetIds.length === 0;
  }
  return !input.hasSitePhoto;
}

export type CreationBatchRoomData = {
  summary: string;
  targetScope: MiniAiFloorPlanTarget['targetScope'];
  targetLabel: string;
  roomCount: number;
  roomId?: string;
  controlKind?: CreationBatchControlKind;
};

export type CreationBatchFloorPlanScope = {
  target: MiniAiFloorPlanTarget;
  roomData: CreationBatchRoomData;
  providerPrompt: string;
};

export function resolveCreationBatchTargetContext(input: {
  layoutData: unknown;
  targetScope?: unknown;
  roomId?: string;
}) {
  const target = resolveMiniAiFloorPlanTarget(
    input.layoutData,
    input.targetScope,
    input.roomId,
  );
  return {
    target,
    roomData: buildCreationBatchRoomData(target),
  };
}

type ControlRenderers = {
  renderRoomCrop?: typeof renderMiniAiFloorPlanControlPng;
  resolveWholePlan?: typeof resolveFloorPlanControlPng;
};

export function buildCreationBatchRoomData(
  target: MiniAiFloorPlanTarget,
  controlKind?: CreationBatchControlKind,
): CreationBatchRoomData {
  return {
    summary: target.summary,
    targetScope: target.targetScope,
    targetLabel: target.targetLabel,
    roomCount: target.roomCount,
    ...(target.roomId ? { roomId: target.roomId } : {}),
    ...(controlKind ? { controlKind } : {}),
  };
}

export function composeCreationBatchPrompt(
  prompt: string,
  roomData?: Pick<CreationBatchRoomData, 'summary'>,
  constraintPrompt?: string,
  referenceRoles?: Pick<FloorPlanConstraintPromptInput, 'hasStyleReference' | 'hasSitePhoto'>,
) {
  return constraintPrompt
    ? composeFloorPlanConstrainedPrompt({
      constraintPrompt,
      measuredContext: roomData?.summary,
      userPrompt: prompt,
      ...referenceRoles,
    })
    : roomData?.summary ? `${prompt}\n\n${roomData.summary}` : prompt;
}

export function resolveCreationBatchFloorPlanScope(input: {
  layoutData: unknown;
  prompt: string;
  constraintPrompt?: string;
  hasStyleReference?: boolean;
  hasSitePhoto?: boolean;
  targetScope?: unknown;
  roomId?: string;
}): CreationBatchFloorPlanScope {
  const { target, roomData } = resolveCreationBatchTargetContext(input);
  return {
    target,
    roomData,
    providerPrompt: composeCreationBatchPrompt(
      input.prompt,
      roomData,
      input.constraintPrompt,
      {
        hasStyleReference: input.hasStyleReference,
        hasSitePhoto: input.hasSitePhoto,
      },
    ),
  };
}

export async function resolveCreationBatchControlPng(
  plan: FloorPlanPreviewSource,
  target: MiniAiFloorPlanTarget,
  renderers: ControlRenderers = {},
): Promise<{ buffer: Buffer; controlKind: CreationBatchControlKind }> {
  const resolveWholePlan = renderers.resolveWholePlan || resolveFloorPlanControlPng;
  const renderRoomCrop = renderers.renderRoomCrop || renderMiniAiFloorPlanControlPng;
  if (target.targetScope === 'single_room' && target.roomId) {
    try {
      const buffer = await renderRoomCrop(
        plan.layoutData,
        FLOOR_PLAN_SNAPSHOT_SIZE,
        target.roomId,
      );
      return { buffer, controlKind: 'room_crop' };
    } catch (error) {
      console.error(
        '[creation-batch-floorplan] single-room control crop failed; using whole-plan snapshot',
        error,
      );
      return {
        buffer: await resolveWholePlan(plan),
        controlKind: 'survey_snapshot_fallback',
      };
    }
  }
  return {
    buffer: await resolveWholePlan(plan),
    controlKind: 'survey_snapshot',
  };
}
