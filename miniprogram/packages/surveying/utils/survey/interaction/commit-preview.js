const { resolveConfirmationSnap } = require('../snap/snap-engine.js');
const { SESSION_STATES } = require('../core/session.js');
const { SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES, createSurveyDomainError } = require('../domain/errors.js');
const { canExtendLastWall, canRetractLastWallToStart, canShortenLastWall, findOverlappingWall, resolveLastWallReverseEdit } = require('../topology/wall-edit-queries.js');
const { canResolvePreviewStartClosure, resolvePreviewStartClosurePlan } = require('../topology/closure-candidates.js');
const { constrainStraightSnapPoint } = require('../snap/preview-alignment.js');
const { copyTrackedSession } = require('../core/session-copy.js');
const { findAnySharedWallClosureProjection, findOuterFaceClosureProjection, findPartitionClosureProjection, findRayWallIntersection } = require('./closure-projection.js');
const { getFirstNode, getNode } = require('../core/graph-query.js');
const { getMinimumDirectBoundaryCloseWallCount } = require('../topology/closure-queries.js');
const { projectionIntent } = require('./projection-intent.js');
const { resolveBoundaryAlignedMeasurementSide } = require('../topology/wall-alignment.js');
const { resolveSharedClosureEndInsetMm } = require('./measurement-preview.js');
const domainValidation = require('../domain/validation.js');
const vector2 = require('../geometry/vector2.js');
const wallDomain = require('../domain/wall.js');

const distanceMm = vector2.distanceMm;
const normalizeMeasurementExtension = wallDomain.normalizeMeasurementAdjustment;
const normalizeMeasurementInset = wallDomain.normalizeMeasurementAdjustment;
const pointFromLength = wallDomain.pointFromMeasuredLength;
const validateLength = domainValidation.validateLength;
function planCommitPreview(floor, lengthMm, inputSource) {
  const parsedLength = validateLength(lengthMm);
  const session = copyTrackedSession(floor);
  const anchor = getNode(floor, session.anchorNodeId);

  if (!anchor || !session.previewPoint || (session.state !== SESSION_STATES.AWAITING_LENGTH && session.state !== SESSION_STATES.WALL_PREVIEW)) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.WALL_PREVIEW_REQUIRED);
  }

  let endPoint = pointFromLength(
    anchor,
    session.previewPoint,
    parsedLength,
    session.previewMeasurementStartInsetMm,
    session.previewMeasurementEndInsetMm,
    session.previewMeasurementStartExtensionMm
  );
  const measuredEndPoint = endPoint;
  // Resolve an in-segment reverse drag against the operator's measured point
  // before rectangle/vertex/closure helpers can redirect it to a nearby wall.
  const reverseEdit = resolveLastWallReverseEdit(floor, session, anchor, measuredEndPoint);
  const shortenLastWall = canShortenLastWall(reverseEdit);
  const retractLastWall = canRetractLastWallToStart(reverseEdit, session);
  if (retractLastWall) {
    return { kind: 'retract-wall', floorId: floor.id, wallId: reverseEdit.lastWall.id };
  }
  const preservesOuterTWorkingLength = session.activeSpaceSharedWallMiddle &&
    session.activeSpaceSharedSnapLine === 'outer' &&
    (
      normalizeMeasurementInset(session.previewMeasurementStartInsetMm) > 0 ||
      normalizeMeasurementExtension(session.previewMeasurementStartExtensionMm) > 0
    );
  // Releasing an unchanged preview confirms the endpoint the operator saw.
  // The preview may have refined a rectangle snap onto a physical outer face;
  // running the earlier rectangle stage again would pull it back by a wall
  // thickness. Explicit manual/BLE measurements retain their length-snap rules.
  const confirmsVisiblePreview = ['preview', 'preview-continuation', 'closure-preview'].includes(inputSource) &&
    distanceMm(measuredEndPoint, session.previewPoint) <= 1;
  endPoint = confirmsVisiblePreview
    ? { xMm: session.previewPoint.xMm, yMm: session.previewPoint.yMm }
    : resolveConfirmationSnap(floor, session, anchor, measuredEndPoint,
      shortenLastWall, preservesOuterTWorkingLength).point;
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWallCountBeforeCommit = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  const canCloseWithSharedBoundary = activeWallCountBeforeCommit + 1 >=
    getMinimumDirectBoundaryCloseWallCount(floor, session);
  // Pre-clamp endPoint to any intersecting existing wall BEFORE running closure
  // projection search. This prevents an overshoot (e.g. user types a length
  // greater than the actual distance to the shared boundary) from pushing the
  // endpoint outside the close-tolerance window, which would cause
  // findAnySharedWallClosureProjection to miss the target and leave a dangling
  // node ("形成末节"). Store the ray hit so it can serve as a synthetic
  // shared-wall closure when no activeSpaceSharedWallId context exists.
  let earlyRayHit = null;
  if (!shortenLastWall && !preservesOuterTWorkingLength) {
    const candidate = findRayWallIntersection(floor, session, anchor, endPoint);
    if (candidate && distanceMm(anchor, endPoint) > candidate.distanceMm + 1) {
      earlyRayHit = candidate;
      endPoint = constrainStraightSnapPoint(session, anchor, candidate.point, endPoint);
    }
  }
  const outerFaceProjection = canCloseWithSharedBoundary && !shortenLastWall
    ? findOuterFaceClosureProjection(
      floor,
      session,
      endPoint,
      session.previewOuterFaceWallId || ''
    )
    : null;
  const sharedProjection = canCloseWithSharedBoundary && !shortenLastWall && !outerFaceProjection
    ? findAnySharedWallClosureProjection(floor, session, endPoint)
    : null;
  const partitionProjection = shortenLastWall
    ? null
    : findPartitionClosureProjection(floor, session, anchor, endPoint);
  let closureProjection = partitionProjection || sharedProjection;
  // If no closure was found via normal shared-wall search (no activeSpaceSharedWallId
  // context — e.g. drawing from empty space into an existing closed room), but the
  // endpoint was already clamped to a wall intersection, synthesize a shared-wall
  // closure projection from the stored ray hit.
  let rayFallbackProjection = null;
  if (!closureProjection && !outerFaceProjection && earlyRayHit) {
    const hitStart = getNode(floor, earlyRayHit.wall.startNodeId);
    const hitEnd = getNode(floor, earlyRayHit.wall.endNodeId);
    rayFallbackProjection = {
      wall: earlyRayHit.wall,
      start: hitStart,
      end: hitEnd,
      point: earlyRayHit.point,
      t: earlyRayHit.u,
      node: earlyRayHit.u <= 0.0001 ? hitStart : earlyRayHit.u >= 0.9999 ? hitEnd : null,
      snapLine: 'inner',
      distanceMm: 0
    };
    closureProjection = rayFallbackProjection;
  }
  const canCloseAtActiveStart = !!(
    session.mode === 'straight' &&
    activeStartNode &&
    activeWallCountBeforeCommit >= 3 &&
    canResolvePreviewStartClosure(
      floor,
      session,
      anchor,
      endPoint,
      activeStartNode,
      { allowRejectedCandidate: true }
    )
  );
  const isClosingCurrentSpace = activeStartNode &&
    (activeWallCountBeforeCommit >= 2 || !!closureProjection || !!outerFaceProjection) &&
    (closureProjection || outerFaceProjection || canCloseAtActiveStart);
  if (closureProjection) {
    // Straight mode may change at most one axis. Never copy an off-axis
    // topology endpoint onto the confirmed wall; confirmClosure adds a short
    // orthogonal bridge for the remaining thickness gap.
    const constrainedEndPoint = constrainStraightSnapPoint(
      session,
      anchor,
      closureProjection.point,
      endPoint
    );
    if (distanceMm(constrainedEndPoint, closureProjection.point) > 1) {
      closureProjection = Object.assign({}, closureProjection, {
        point: constrainedEndPoint,
        node: null,
        // Force getOrCreateSnapNode to keep the on-axis working point instead of
        // falling back through a stale endpoint parameter (t=0/1).
        t: 0.5,
        snapsToTopologyEndpoint: false
      });
    }
    endPoint = constrainedEndPoint;
  }
  const measurementStartInsetMm = normalizeMeasurementInset(
    session.previewMeasurementStartInsetMm
  );
  const measurementStartExtensionMm = normalizeMeasurementExtension(
    session.previewMeasurementStartExtensionMm
  );
  const measurementEndInsetMm = sharedProjection
    ? resolveSharedClosureEndInsetMm(
      floor,
      session,
      anchor,
      endPoint,
      sharedProjection.wall.id
    )
    : normalizeMeasurementInset(session.previewMeasurementEndInsetMm);
  const ignoredWallIds = isClosingCurrentSpace
    ? floor.walls.slice(0, session.activeSpaceStartWallIndex).map((wall) => wall.id)
    : [];
  // A small endpoint drift on a concave orthogonal traverse can make the
  // final leg cross the first wall before the closure balance moves the
  // intermediate vertices back onto a common axis. Permit only the exact
  // chain shape accepted by the same resolver used by confirmClosure; all
  // unrelated overlaps and diagonal crossings remain hard failures.
  const previewStartClosurePlan = !shortenLastWall &&
    session.mode === 'straight' &&
    activeStartNode &&
    activeWallCountBeforeCommit >= 3 &&
    canCloseAtActiveStart
    ? resolvePreviewStartClosurePlan(floor, session, anchor, endPoint, activeStartNode)
    : null;
  const canBalanceNearStartIntersection = !!(
    previewStartClosurePlan &&
    previewStartClosurePlan.type === 'orthogonal-adjustment'
  );
  if (
    !canBalanceNearStartIntersection &&
    !shortenLastWall &&
    findOverlappingWall(floor, anchor, endPoint, { ignoredWallIds })
  ) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.WALL_OVERLAP);
  }

  const measurementSide = session.previewMeasurementSide ||
    resolveBoundaryAlignedMeasurementSide(floor, session, anchor, endPoint);
  const extendLastWall = canExtendLastWall(
    floor,
    session,
    anchor,
    endPoint,
    measurementSide,
    isClosingCurrentSpace
  );
  const retainsPreviewMergeCandidate = !!(
    extendLastWall &&
    session.closeCandidateType === 'merge' &&
    session.closeCandidateNodeId &&
    session.previewPoint &&
    distanceMm(endPoint, session.previewPoint) <= 1
  );

  return {
    kind: 'commit-wall', floorId: floor.id, anchorNodeId: anchor.id,
    activeStartNodeId: activeStartNode ? activeStartNode.id : '',
    parsedLength, inputSource: inputSource || 'manual', endPoint,
    measurementStartInsetMm, measurementStartExtensionMm, measurementEndInsetMm,
    measurementSide, activeWallCountBeforeCommit, extendLastWall: !!extendLastWall, shortenLastWall,
    retainsPreviewMergeCandidate,
    closureProjection: projectionIntent(closureProjection), partitionProjection: projectionIntent(partitionProjection),
    sharedProjection: projectionIntent(sharedProjection), rayFallbackProjection: projectionIntent(rayFallbackProjection),
    outerFaceProjection: projectionIntent(outerFaceProjection)
  };
}

module.exports = {
  planCommitPreview
};
