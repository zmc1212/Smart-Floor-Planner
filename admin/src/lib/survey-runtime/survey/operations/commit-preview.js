const { CLOSE_TOLERANCE_MM } = require('../core/constants.js');
const { addNode, getOrCreateSnapNode, syncFloorSpaces } = require('./wall-mutation-helpers.js');
const { applyClosureCandidatePlan } = require('./closure-candidate.js');
const { applyExistingWallMeasurement, recordCommittedWallMeasurement } = require('./measurement.js');
const { applyWallBodyInsetToIncidentWalls } = require('./preview-insets.js');
const { cloneDraft, getActiveFloor: findActiveFloor, touchDraft } = require('../core/draft.js');
const { deleteWall } = require('./wall-deletion.js');
const { ensureSessionSpaceTracking } = require('../core/session.js');
const { getLastWall, getNode, getWall } = require('../core/graph-query.js');
const { getMinimumClosureSuggestionWallCount, resolveStraightClosurePlan } = require('../topology/closure-queries.js');
const { hasBleLockedBearing } = require('../interaction/direction-lock.js');
const { materializeLockedPreview } = require('./preview.js');
const { nextId, nowIso } = require('../core/runtime-id.js');
const { planCommitPreview } = require('../interaction/commit-preview.js');
const { planCommittedClosureCandidate } = require('../topology/closure-candidates.js');
const { resolveProjectionIntent } = require('./projection-intent.js');
const { splitWallAtNodes } = require('./wall-split.js');
const domainValidation = require('../domain/validation.js');
const vector2 = require('../geometry/vector2.js');

const validateLength = domainValidation.validateLength;
const angleDeg = vector2.angleDeg;
const distanceMm = vector2.distanceMm;
const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
function applyCommitPreviewPlan(next, plan) {
  const floor = getActiveFloor(next);
  if (!plan || plan.floorId !== floor.id) throw new TypeError('Invalid preview commit plan');
  if (plan.kind === 'retract-wall') return deleteWall(next, plan.wallId);
  if (plan.kind !== 'commit-wall') throw new TypeError('Invalid preview commit kind');
  const session = ensureSessionSpaceTracking(floor);
  const anchor = getNode(floor, plan.anchorNodeId);
  const activeStartNode = getNode(floor, plan.activeStartNodeId);
  const { parsedLength, inputSource, endPoint, measurementStartInsetMm, measurementStartExtensionMm,
    measurementEndInsetMm, measurementSide, activeWallCountBeforeCommit, extendLastWall, shortenLastWall,
    retainsPreviewMergeCandidate } = plan;
  const closureProjection = resolveProjectionIntent(floor, plan.closureProjection);
  const partitionProjection = resolveProjectionIntent(floor, plan.partitionProjection);
  const sharedProjection = resolveProjectionIntent(floor, plan.sharedProjection);
  const rayFallbackProjection = resolveProjectionIntent(floor, plan.rayFallbackProjection);
  const outerFaceProjection = resolveProjectionIntent(floor, plan.outerFaceProjection);
  if (activeWallCountBeforeCommit === 0 && session.activeSpaceSharedWallId) session.measurementSide = measurementSide;
  let endNode;
  let wall;
  if (extendLastWall || shortenLastWall) {
    wall = getLastWall(floor);
    endNode = anchor;
    applyExistingWallMeasurement(
      floor,
      wall,
      anchor,
      endPoint,
      parsedLength,
      inputSource,
      extendLastWall ? 'extend' : 'shorten'
    );
  } else {
    if (activeWallCountBeforeCommit === 0 && session.activeSpaceSharedWallId && session.activeSpaceSharedWallMiddle) {
      const splitSource = getWall(floor, session.activeSpaceSharedWallId);
      const splitClosedSpace = !!(splitSource && (floor.spaces || []).some((space) => (
        space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(splitSource.id) !== -1
      )));
      const splitResult = splitWallAtNodes(floor, session.activeSpaceSharedWallId, [anchor.id]);
      const snappedSegments = splitResult.segmentIds
        .map((wallId) => getWall(floor, wallId))
        .filter((seg) => seg && (
          seg.startNodeId === anchor.id || seg.endNodeId === anchor.id
        ));
      const snappedWall = snappedSegments[0];
      if (snappedWall) {
        session.activeSpaceSharedWallId = snappedWall.id;
        session.activeSpaceSharedStartT = snappedWall.startNodeId === anchor.id ? 0 : 1;
      }
      session.activeSpaceStartWallIndex = floor.walls.length;
      if (splitClosedSpace) {
        syncFloorSpaces(floor);
        session.fullValidationAfterClosedSplit = true;
      }
    }
    endNode = closureProjection ? getOrCreateSnapNode(floor, closureProjection) : addNode(floor, endPoint);
    wall = {
      id: nextId('wall'),
      startNodeId: anchor.id,
      endNodeId: endNode.id,
      mode: session.mode,
      lengthMm: Math.max(
        0,
        distanceMm(anchor, endNode) - measurementStartInsetMm + measurementStartExtensionMm - measurementEndInsetMm
      ),
      angleDeg: angleDeg(anchor, endNode),
      thicknessMm: session.thicknessMm,
      measurementSide,
      // Preserve the exterior-start case immediately. Shared-boundary first
      // walls also lock the inferred body side so toggling the measuring edge
      // can move the redline without flipping occupancy.
      bodyNormalSide: session.previewBodyNormalSide ||
        (session.activeSpaceSharedSnapLine === 'outer' ? measurementSide : ''),
      measurementStartInsetMm,
      measurementStartExtensionMm,
      measurementEndInsetMm,
      inputSource: inputSource || 'manual',
      angleSource: session.previewAngleSource || '',
      angleInteriorDeg: session.previewInteriorAngleDeg,
      status: 'confirmed',
      measuredAt: nowIso()
    };
    recordCommittedWallMeasurement(wall, parsedLength, inputSource);
    floor.walls.push(wall);
    applyWallBodyInsetToIncidentWalls(floor, wall, wall.startNodeId);
    applyWallBodyInsetToIncidentWalls(floor, wall, wall.endNodeId);
  }
  session.anchorNodeId = endNode.id;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.previewOuterFaceWallId = '';
  delete session.bleLockedBearingDeg;
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;

  const activeWallCount = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  const resolvedDirectStartClosurePlan = activeStartNode && activeWallCount >= 3
    ? resolveStraightClosurePlan(
      floor,
      session,
      wall,
      activeStartNode,
      { allowRejectedCandidate: true }
    )
    : null;
  const directStartClosurePlan = resolvedDirectStartClosurePlan && (
    distanceMm(endNode, activeStartNode) <= CLOSE_TOLERANCE_MM ||
    resolvedDirectStartClosurePlan.type === 'orthogonal-adjustment'
  )
    ? resolvedDirectStartClosurePlan
    : null;
  applyClosureCandidatePlan(session, planCommittedClosureCandidate(floor, session, {
    activeWallCount, endNode, activeStartNode, partitionProjection, sharedProjection,
    rayFallbackProjection, outerFaceProjection, directStartClosurePlan,
    mergeCandidateWallCount: activeWallCount + (retainsPreviewMergeCandidate ? 1 : 0),
    minimumMergeWallCount: getMinimumClosureSuggestionWallCount(floor, session)
  }), 'WALL_COMMITTED');

  return touchDraft(next);
}

function commitPreviewLength(draft, lengthMm, inputSource) {
  // Validate before direction materialization to preserve legacy error priority.
  validateLength(lengthMm);
  let sourceDraft = draft;
  const preFloor = getActiveFloor(sourceDraft);
  const preSession = preFloor && preFloor.session;
  if (preSession && hasBleLockedBearing(preSession) && !preSession.previewPoint) {
    sourceDraft = materializeLockedPreview(sourceDraft);
  }
  const next = cloneDraft(sourceDraft);
  const floor = getActiveFloor(next);
  ensureSessionSpaceTracking(floor);
  return applyCommitPreviewPlan(next, planCommitPreview(floor, lengthMm, inputSource));
}

module.exports = {
  applyCommitPreviewPlan,
  commitPreviewLength
};
