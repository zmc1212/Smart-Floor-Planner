const { CLOSE_TOLERANCE_MM } = require('../core/constants.js');
const { getNode } = require('../core/graph-query.js');
const { SESSION_STATES } = require('../core/session.js');
const {
  findMergeClosureCandidate,
  resolveStraightClosurePlan
} = require('./closure-queries.js');

const { distanceMm } = require('../geometry/vector2.js');

function copyPoint(point) {
  return point ? { xMm: point.xMm, yMm: point.yMm } : null;
}

function emptyCandidatePatch(partitionSourceSpaceId) {
  return {
    closeCandidateNodeId: '',
    closeCandidatePoint: null,
    closeCandidateType: '',
    closeCandidateSharedWallId: '',
    partitionSourceSpaceId: partitionSourceSpaceId || ''
  };
}

function resolvePreviewStartClosurePlan(floor, session, anchor, previewPoint, targetNode, options) {
  if (!floor || !session || !anchor || !previewPoint || !targetNode) return null;
  if (session.mode !== 'straight') return { type: 'snap' };
  const virtualFloor = JSON.parse(JSON.stringify(floor));
  const virtualSession = Object.assign({}, session);
  const virtualEndNode = {
    id: '__preview-close-end__',
    xMm: Math.round(previewPoint.xMm),
    yMm: Math.round(previewPoint.yMm)
  };
  virtualFloor.nodes.push(virtualEndNode);
  const virtualWall = {
    id: '__preview-close-wall__',
    startNodeId: anchor.id,
    endNodeId: virtualEndNode.id,
    mode: 'straight',
    lengthMm: distanceMm(anchor, virtualEndNode),
    thicknessMm: session.thicknessMm
  };
  virtualFloor.walls.push(virtualWall);
  virtualSession.anchorNodeId = virtualEndNode.id;
  const virtualTarget = getNode(virtualFloor, targetNode.id);
  return resolveStraightClosurePlan(
    virtualFloor,
    virtualSession,
    virtualWall,
    virtualTarget,
    options
  );
}

function canResolvePreviewStartClosure(floor, session, anchor, previewPoint, targetNode, options) {
  const plan = resolvePreviewStartClosurePlan(
    floor,
    session,
    anchor,
    previewPoint,
    targetNode,
    options
  );
  return !!(
    plan &&
    (
      (
        distanceMm(previewPoint, targetNode) <= CLOSE_TOLERANCE_MM &&
        (
          plan.type !== 'orthogonal-adjustment-rejected' ||
          (options && options.allowRejectedCandidate)
        )
      ) ||
      plan.type === 'orthogonal-adjustment'
    )
  );
}

function planPreviewClosureCandidate(floor, session, context) {
  const input = context || {};
  const partitionProjection = input.partitionProjection || null;
  const patch = emptyCandidatePatch(
    partitionProjection && partitionProjection.sourceSpace
      ? partitionProjection.sourceSpace.id
      : ''
  );
  const activeStartNode = input.activeStartNode || null;
  const activeWallCount = Math.max(0, Number(input.activeWallCount) || 0);

  if (
    activeStartNode &&
    activeWallCount + 1 >= Number(input.directCloseWallCount || 0)
  ) {
    const outerFaceProjection = input.outerFaceProjection || null;
    const sharedProjection = input.sharedProjection || null;
    if (outerFaceProjection) {
      const mergeCandidate = outerFaceProjection.topologyNode;
      if (mergeCandidate && !input.reversePreviewEdit) {
        patch.closeCandidateNodeId = mergeCandidate.id;
        patch.closeCandidateType = 'merge';
      } else {
        patch.closeCandidateType = 'shared-wall';
      }
      patch.closeCandidatePoint = copyPoint(outerFaceProjection.point);
      patch.closeCandidateSharedWallId = outerFaceProjection.wall.id;
    } else if (sharedProjection) {
      patch.closeCandidatePoint = copyPoint(sharedProjection.point);
      patch.closeCandidateType = 'shared-wall';
      patch.closeCandidateSharedWallId = sharedProjection.wall.id;
    } else if (input.reverseSharedWallClose) {
      patch.closeCandidatePoint = copyPoint(input.previewPoint);
      patch.closeCandidateType = 'shared-wall';
      patch.closeCandidateSharedWallId = session.activeSpaceSharedWallId;
    } else if (
      activeWallCount + 1 >= Number(input.inferredMergeWallCount || 0) &&
      canResolvePreviewStartClosure(
        floor,
        session,
        input.anchor,
        input.previewPoint,
        activeStartNode,
        { allowRejectedCandidate: true }
      )
    ) {
      patch.closeCandidateNodeId = activeStartNode.id;
      patch.closeCandidateType = 'start';
    } else if (activeWallCount + 1 >= Number(input.inferredMergeWallCount || 0)) {
      const mergeCandidate = findMergeClosureCandidate(floor, session, input.previewPoint);
      if (mergeCandidate) {
        patch.closeCandidateNodeId = mergeCandidate.id;
        patch.closeCandidateType = mergeCandidate.id === activeStartNode.id && activeWallCount >= 3
          ? 'start'
          : 'merge';
      }
    }
  }

  if (partitionProjection) {
    patch.closeCandidatePoint = copyPoint(partitionProjection.point);
    patch.closeCandidateType = 'partition';
    patch.closeCandidateSharedWallId = partitionProjection.wall.id;
  }

  return { kind: 'preview-closure-candidate', sessionPatch: patch };
}

function planCommittedClosureCandidate(floor, session, context) {
  const input = context || {};
  const patch = emptyCandidatePatch(session.partitionSourceSpaceId);
  const activeWallCount = Math.max(0, Number(input.activeWallCount) || 0);
  const endNode = input.endNode || null;
  const activeStartNode = input.activeStartNode || null;

  if (input.partitionProjection && activeWallCount === 1) {
    patch.state = SESSION_STATES.CLOSING;
    patch.closeCandidateNodeId = endNode.id;
    patch.closeCandidatePoint = copyPoint(input.partitionProjection.point);
    patch.closeCandidateType = 'partition';
    patch.closeCandidateSharedWallId = input.partitionProjection.wall.id;
    patch.partitionSourceSpaceId = input.partitionProjection.sourceSpace.id;
  } else if (input.sharedProjection && activeWallCount >= 1) {
    patch.state = SESSION_STATES.CLOSING;
    patch.closeCandidateNodeId = endNode.id;
    patch.closeCandidatePoint = copyPoint(input.sharedProjection.point);
    patch.closeCandidateType = 'shared-wall';
    patch.closeCandidateSharedWallId = input.sharedProjection.wall.id;
    if (!session.activeSpaceSharedWallId) {
      patch.activeSpaceSharedWallId = input.sharedProjection.wall.id;
    }
  } else if (input.rayFallbackProjection && activeWallCount >= 1) {
    patch.state = SESSION_STATES.CLOSING;
    patch.closeCandidateNodeId = endNode.id;
    patch.closeCandidatePoint = copyPoint(input.rayFallbackProjection.point);
    patch.closeCandidateType = 'shared-wall';
    patch.closeCandidateSharedWallId = input.rayFallbackProjection.wall.id;
    if (!session.activeSpaceSharedWallId) {
      patch.activeSpaceSharedWallId = input.rayFallbackProjection.wall.id;
    }
  } else if (input.outerFaceProjection && activeWallCount >= 1) {
    const mergeCandidate = input.outerFaceProjection.topologyNode;
    patch.state = mergeCandidate ? SESSION_STATES.MERGE_CLOSING : SESSION_STATES.CLOSING;
    patch.closeCandidateNodeId = mergeCandidate ? mergeCandidate.id : endNode.id;
    patch.closeCandidateType = mergeCandidate ? 'merge' : 'shared-wall';
    if (!mergeCandidate) {
      patch.closeCandidatePoint = copyPoint(input.outerFaceProjection.point);
      patch.closeCandidateSharedWallId = input.outerFaceProjection.wall.id;
    }
  } else if (input.directStartClosurePlan) {
    patch.state = SESSION_STATES.CLOSING;
    patch.closeCandidateNodeId = activeStartNode.id;
    patch.closeCandidateType = 'start';
  } else {
    const mergeCandidate = activeWallCount >= Number(input.minimumMergeWallCount || 0)
      ? findMergeClosureCandidate(floor, session, endNode)
      : null;
    if (mergeCandidate) {
      patch.state = SESSION_STATES.MERGE_CLOSING;
      patch.closeCandidateNodeId = mergeCandidate.id;
      patch.closeCandidateType = 'merge';
    } else {
      patch.state = SESSION_STATES.WALL_COMMITTED;
    }
  }

  return { kind: 'committed-closure-candidate', sessionPatch: patch };
}

module.exports = {
  resolvePreviewStartClosurePlan,
  canResolvePreviewStartClosure,
  planPreviewClosureCandidate,
  planCommittedClosureCandidate
};
