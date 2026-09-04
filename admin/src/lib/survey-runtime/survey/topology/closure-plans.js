const { getActiveFloor } = require('../core/draft.js');
const { getNode, getWall, getLastWall } = require('../core/graph-query.js');
const { SESSION_STATES, ensureSessionSpaceTracking } = require('../core/session.js');
const { CLOSE_TOLERANCE_MM, MIN_WALL_LENGTH_MM } = require('../core/constants.js');
const { SURVEY_DOMAIN_ERROR_CODES: CODES, createSurveyDomainError } = require('../domain/errors.js');
const { projectPointToSegment } = require('../geometry/segment.js');
const { distanceMm } = require('../geometry/vector2.js');
const {
  findMergeClosurePlan, resolveStraightClosurePlan,
  wallKeepsStrictAxis, getMinimumActiveCloseWallCount
} = require('./closure-queries.js');

const pointValue = node => ({ id: node.id, xMm: node.xMm, yMm: node.yMm });

// Pure intents contain values/identifiers only. They neither allocate runtime IDs
// nor read the clock, normalize the caller's session, or simulate graph writes.
function planClosureBridge(floor, wall, targetNode) {
  if (!wall || !targetNode) return { kind: 'noop' };
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  if (!start || !end || end.id === targetNode.id) return { kind: 'noop' };
  const keepAxis = wall.mode !== 'diagonal' && wallKeepsStrictAxis(start, end);
  if (!keepAxis || wallKeepsStrictAxis(start, targetNode)) {
    return { kind: 'snap', wallId: wall.id, targetNodeId: targetNode.id };
  }
  if (!wallKeepsStrictAxis(end, targetNode) || distanceMm(end, targetNode) <= 0.001) {
    throw createSurveyDomainError(CODES.CLOSURE_OUT_OF_TOLERANCE, { toleranceMm: CLOSE_TOLERANCE_MM });
  }
  return { kind: 'bridge', wallId: wall.id, fromNodeId: end.id, targetNodeId: targetNode.id };
}

function planMergeClosure(floor, session) {
  const anchor = getNode(floor, session.anchorNodeId);
  const candidate = findMergeClosurePlan(floor, session, anchor);
  if (!anchor || !candidate || !candidate.targetNode || candidate.points.length < 2) {
    throw createSurveyDomainError(CODES.UNSAFE_CLOSURE);
  }
  return {
    type: 'merge', anchorNodeId: anchor.id, targetNodeId: candidate.targetNode.id,
    points: candidate.points.map(pointValue)
  };
}

function planPartitionClosure(floor, session) {
  const source = (floor.spaces || []).find(space => (
    space && space.id === session.partitionSourceSpaceId && space.closed
  ));
  const wall = getLastWall(floor);
  const start = getNode(floor, session.activeSpaceStartNodeId);
  const end = wall && getNode(floor, wall.endNodeId);
  if (!source || !start || !end || !wall) {
    throw createSurveyDomainError(CODES.PARTITION_SPLIT_UNSAFE);
  }
  return {
    type: 'partition', sourceSpaceId: source.id, partitionWallId: wall.id,
    closedBefore: (floor.spaces || []).filter(space => space && space.closed).length,
    splits: [
      { wallId: session.activeSpaceSharedWallId, nodeIds: [start.id] },
      { wallId: session.closeCandidateSharedWallId, nodeIds: [end.id] }
    ]
  };
}

function planDirectClosure(floor, session) {
  const wall = getLastWall(floor);
  const oldEndNode = getNode(floor, wall.endNodeId);
  let target = getNode(floor, session.closeCandidateNodeId);
  let insertTarget = false;
  let projectedTarget = false;
  if (!target && session.closeCandidatePoint && session.closeCandidateSharedWallId) {
    const sharedWall = getWall(floor, session.closeCandidateSharedWallId);
    const start = sharedWall ? getNode(floor, sharedWall.startNodeId) : null;
    const end = sharedWall ? getNode(floor, sharedWall.endNodeId) : null;
    const projection = projectPointToSegment(session.closeCandidatePoint, start, end);
    if (projection) {
      projectedTarget = true;
      target = projection.t <= 0.0001 ? start : projection.t >= 0.9999 ? end
        : floor.nodes.find(node => distanceMm(node, projection.point) <= 1);
      if (!target) {
        insertTarget = true;
        target = { xMm: Math.round(projection.point.xMm), yMm: Math.round(projection.point.yMm) };
      }
    }
  }
  if (!oldEndNode || !target) {
    throw createSurveyDomainError(CODES.CLOSURE_OUT_OF_TOLERANCE, { toleranceMm: CLOSE_TOLERANCE_MM });
  }
  const adjustment = resolveStraightClosurePlan(floor, session, wall, target);
  if (!adjustment || (distanceMm(oldEndNode, target) > CLOSE_TOLERANCE_MM &&
      adjustment.type !== 'orthogonal-adjustment')) {
    throw createSurveyDomainError(CODES.CLOSURE_OUT_OF_TOLERANCE, { toleranceMm: CLOSE_TOLERANCE_MM });
  }
  return {
    type: 'direct', oldEndNodeId: oldEndNode.id, target: pointValue(target), insertTarget, projectedTarget,
    adjustment: adjustment.type === 'orthogonal-adjustment'
      ? {
        type: adjustment.type,
        entries: adjustment.entries.map(entry => ({
          wallId: entry.wall.id, fromNodeId: entry.fromNode.id, toNodeId: entry.toNode.id,
          axis: entry.axis, adjustedSignedLengthMm: entry.adjustedSignedLengthMm
        }))
      }
      : { type: adjustment.type }
  };
}

function planConfirmClosure(draft) {
  const floor = getActiveFloor(draft, { requireFloorList: true });
  // The legacy normalization is retained, but only on an isolated session value.
  const session = ensureSessionSpaceTracking({ ...floor, session: JSON.parse(JSON.stringify(floor.session || {})) });
  const base = { kind: 'confirm-closure', floorId: floor.id };
  if (session.previewPoint && session.previewLengthMm >= MIN_WALL_LENGTH_MM &&
      (session.closeCandidateNodeId || session.closeCandidatePoint) &&
      (session.state === SESSION_STATES.WALL_PREVIEW || session.state === SESSION_STATES.AWAITING_LENGTH)) {
    return { ...base, type: 'preview', lengthMm: session.previewLengthMm };
  }
  if (session.state === SESSION_STATES.MERGE_CLOSING) {
    return { ...base, ...planMergeClosure(floor, session) };
  }
  if (session.state === SESSION_STATES.CLOSING && session.closeCandidateType === 'partition') {
    return { ...base, ...planPartitionClosure(floor, session) };
  }
  const count = Math.max(0, floor.walls.length - (session.activeSpaceStartWallIndex || 0));
  if (session.state !== SESSION_STATES.CLOSING ||
      (!session.closeCandidateNodeId && !session.closeCandidatePoint) ||
      count < getMinimumActiveCloseWallCount(floor, session)) return { ...base, type: 'noop' };
  return { ...base, ...planDirectClosure(floor, session) };
}

module.exports = { planConfirmClosure, planClosureBridge, planMergeClosure, planPartitionClosure };
