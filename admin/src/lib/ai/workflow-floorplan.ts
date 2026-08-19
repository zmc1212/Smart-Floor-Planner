import {
  adaptSurveyGraphToRooms,
  getActiveSurveyFloor,
  parseFormalSurveyLayout,
  type SurveyFloor,
  type SurveyNode,
  type SurveyWall,
} from '@/lib/survey-graph';
import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';

type WorkflowFloorPlanCandidate = {
  status?: unknown;
  layoutData?: unknown;
};

export type WorkflowFloorPlanEligibilityReasonCode =
  | 'survey_incomplete'
  | 'invalid_formal_graph'
  | 'no_closed_space'
  | 'missing_usable_wall';

export type WorkflowFloorPlanEligibility = {
  eligible: boolean;
  reasonCode?: WorkflowFloorPlanEligibilityReasonCode;
  reasonLabel?: string;
  errorMessage?: string;
};

function closedWallIds(floor: SurveyFloor) {
  return new Set(
    (floor.spaces || [])
      .filter((space) => space.closed)
      .flatMap((space) => space.wallIds || [])
  );
}

export function getWorkflowFloorPlanEligibility(
  plan: WorkflowFloorPlanCandidate
): WorkflowFloorPlanEligibility {
  if (plan.status !== 'completed') {
    return {
      eligible: false,
      reasonCode: 'survey_incomplete',
      reasonLabel: '量房未完成',
      errorMessage: '只能选择已完成的正式户型',
    };
  }

  const layout = parseFormalSurveyLayout(plan.layoutData);
  if (!layout) {
    return {
      eligible: false,
      reasonCode: 'invalid_formal_graph',
      reasonLabel: '正式墙图无效',
      errorMessage: '所选户型不是 version 4 正式量房墙图',
    };
  }

  const floor = getActiveSurveyFloor(layout);
  const rooms = adaptSurveyGraphToRooms(layout);
  const wallIds = floor ? closedWallIds(floor) : new Set<string>();
  if (!floor || !rooms.length || !wallIds.size) {
    return {
      eligible: false,
      reasonCode: 'no_closed_space',
      reasonLabel: '还没有闭合空间',
      errorMessage: '所选正式户型没有可用于 AI 设计的闭合空间',
    };
  }

  const hasClosedWall = (floor.walls || []).some((wall) => wallIds.has(wall.id));
  return hasClosedWall
    ? { eligible: true }
    : {
        eligible: false,
        reasonCode: 'missing_usable_wall',
        reasonLabel: '缺少可用墙体',
        errorMessage: '所选正式户型缺少可用墙体',
      };
}

export function getWorkflowFloorPlanEligibilityError(plan: WorkflowFloorPlanCandidate) {
  return getWorkflowFloorPlanEligibility(plan).errorMessage;
}

export function isEligibleWorkflowFloorPlan(plan: WorkflowFloorPlanCandidate) {
  return !getWorkflowFloorPlanEligibilityError(plan);
}

export function assertEligibleWorkflowFloorPlan(plan: WorkflowFloorPlanCandidate) {
  const error = getWorkflowFloorPlanEligibilityError(plan);
  if (error) {
    throw Object.assign(new Error(error), {
      status: 400,
      code: 'INVALID_WORKFLOW_FLOOR_PLAN',
    });
  }
}

function wallLengthMm(wall: SurveyWall, nodes: Map<string, SurveyNode>) {
  if (Number.isFinite(Number(wall.lengthMm)) && Number(wall.lengthMm) > 0) {
    return Math.round(Number(wall.lengthMm));
  }
  const start = nodes.get(wall.startNodeId);
  const end = nodes.get(wall.endNodeId);
  return start && end ? Math.round(Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm)) : 0;
}

export function buildWorkflowFloorPlanContext(layoutData: unknown) {
  const layout = parseFormalSurveyLayout(layoutData);
  const floor = layout ? getActiveSurveyFloor(layout) : null;
  if (!floor) throw new Error('正式户型缺少可用楼层');

  const rooms = adaptSurveyGraphToRooms(layout);
  if (!rooms.length) throw new Error('正式户型缺少闭合空间');

  const wallIds = closedWallIds(floor);
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
  const walls = (floor.walls || []).filter((wall) => wallIds.has(wall.id));
  const openings = (floor.openings || []).filter((opening) => wallIds.has(opening.wallId));
  const roomSummary = rooms.map((room) => {
    const doors = room.openings.filter((opening) => opening.type === 'DOOR').length;
    const windows = room.openings.filter((opening) => opening.type === 'WINDOW').length;
    return `${room.name}: approximately ${(room.width / 10).toFixed(2)}m by ${(room.height / 10).toFixed(2)}m, ceiling ${(room.height3D / 10).toFixed(2)}m, ${doors} doors, ${windows} windows`;
  }).join('; ');
  const wallSchedule = walls.slice(0, 80).map((wall) => {
    const start = nodes.get(wall.startNodeId);
    const end = nodes.get(wall.endNodeId);
    const coordinates = start && end
      ? `(${Math.round(start.xMm)},${Math.round(start.yMm)}) to (${Math.round(end.xMm)},${Math.round(end.yMm)})`
      : `${wall.startNodeId} to ${wall.endNodeId}`;
    return `${wall.id} ${coordinates}, ${wallLengthMm(wall, nodes)}mm long, ${Math.round(Number(wall.thicknessMm || 120))}mm thick`;
  }).join('; ');
  const openingSchedule = openings.slice(0, 80).map((opening) => {
    const sill = opening.type === 'window' ? `, sill ${Math.round(Number(opening.sillHeightMm || 0))}mm` : '';
    return `${opening.type} on ${opening.wallId}, center offset ${Math.round(Number(opening.centerOffsetMm || 0))}mm, ${Math.round(Number(opening.widthMm || 0))}x${Math.round(Number(opening.heightMm || 0))}mm${sill}`;
  }).join('; ');

  return [
    `Formal measured floor-plan constraints (read-only; coordinates and dimensions are millimetres): ${rooms.length} closed rooms. ${roomSummary}.`,
    `Wall topology (${walls.length} walls): ${wallSchedule}.`,
    openings.length ? `Opening schedule (${openings.length} openings): ${openingSchedule}.` : 'Opening schedule: no measured openings.',
    'Use the supplied control image as the authoritative plan. Preserve the exact outer boundary, wall topology, room adjacency, door and window positions, and circulation. Do not invent, remove, or move structural elements.',
  ].join(' ');
}

export function usesFloorPlanControlImage(stageKey?: string | null) {
  return ['direction', 'base_render', 'perspective_upgrade', 'conversation'].includes(String(stageKey || ''));
}

export function resolveWorkflowImageMode(
  stageKey: AiWorkflowStageKey,
  configuredMode: unknown
): 'generation' | 'edit' {
  if (stageKey === 'direction' || stageKey === 'conversation') return 'edit';
  return configuredMode === 'generation' ? 'generation' : 'edit';
}
