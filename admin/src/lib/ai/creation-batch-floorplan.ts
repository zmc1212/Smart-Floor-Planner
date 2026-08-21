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

export type CreationBatchControlKind =
  | 'survey_snapshot'
  | 'room_crop'
  | 'survey_snapshot_fallback';

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
) {
  return roomData?.summary ? `${prompt}\n\n${roomData.summary}` : prompt;
}

export function resolveCreationBatchFloorPlanScope(input: {
  layoutData: unknown;
  prompt: string;
  targetScope?: unknown;
  roomId?: string;
}): CreationBatchFloorPlanScope {
  const target = resolveMiniAiFloorPlanTarget(
    input.layoutData,
    input.targetScope,
    input.roomId,
  );
  const roomData = buildCreationBatchRoomData(target);
  return {
    target,
    roomData,
    providerPrompt: composeCreationBatchPrompt(input.prompt, roomData),
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
