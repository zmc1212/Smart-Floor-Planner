const { transitionSessionState } = require('../session/state-machine.js');
const { resolvePreviewSnap } = require('../snap/snap-engine.js');
const { CLOSE_TOLERANCE_MM } = require('../core/constants.js');
const { SESSION_STATES } = require('../core/session.js');
const { constrainStraightSnapPoint } = require('../snap/preview-alignment.js');
const { copyTrackedSession } = require('../core/session-copy.js');
const { findAnySharedWallClosureProjection, findOuterFaceClosureProjection, findPartitionClosureProjection, findRayWallIntersection } = require('./closure-projection.js');
const { getFirstNode, getNode } = require('../core/graph-query.js');
const { getMinimumClosureSuggestionWallCount, getMinimumDirectBoundaryCloseWallCount, isHorizontalSegment } = require('../topology/closure-queries.js');
const { planPreviewClosureCandidate } = require('../topology/closure-candidates.js');
const { resolveBoundaryAlignedMeasurementSide } = require('../topology/wall-alignment.js');
const { resolveLastWallReverseEdit } = require('../topology/wall-edit-queries.js');
const { resolveOuterTContinuationStartAdjustment, resolvePreviewMeasurementStartInsetMm, resolveSharedClosureEndInsetMm } = require('./measurement-preview.js');
const vector2 = require('../geometry/vector2.js');
const wallDomain = require('../domain/wall.js');

const angleDeg = vector2.angleDeg;
const calculateMeasuredPreviewLength = wallDomain.measuredPreviewLengthMm;
const distanceMm = vector2.distanceMm;
function planPreview(floor, rawPoint) {
  const session = copyTrackedSession(floor);
  const anchor = getNode(floor, session.anchorNodeId);
  if (!anchor) return { kind: 'place-preview-anchor', point: { xMm: Math.round(rawPoint.xMm), yMm: Math.round(rawPoint.yMm) } };
  const alignment = resolvePreviewSnap(floor, session, anchor, rawPoint);
  let previewPoint = alignment.point;
  const rayIntersection = findRayWallIntersection(floor, session, anchor, previewPoint);
  let rawOuterFaceProjection = findOuterFaceClosureProjection(floor, session, rawPoint);
  if (rayIntersection) {
    const distToAnchor = distanceMm(anchor, previewPoint);
    if (distToAnchor > rayIntersection.distanceMm) {
      previewPoint = constrainStraightSnapPoint(
        session,
        anchor,
        rayIntersection.point,
        previewPoint
      );
    }
  }
  if (rayIntersection && rawOuterFaceProjection) {
    const rawProjDist = distanceMm(anchor, rawOuterFaceProjection.point);
    if (rawProjDist > rayIntersection.distanceMm + CLOSE_TOLERANCE_MM) {
      rawOuterFaceProjection = null;
    }
  }
  if (!rawOuterFaceProjection && rayIntersection && rayIntersection.snapLine === 'outer') {
    const distToAnchor = distanceMm(anchor, previewPoint);
    if (distToAnchor >= rayIntersection.distanceMm - CLOSE_TOLERANCE_MM) {
      rawOuterFaceProjection = findOuterFaceClosureProjection(floor, session, rayIntersection.point, rayIntersection.wall.id);
    }
  }

  if (rawOuterFaceProjection && session.mode === 'straight') {
    const outerDx = Math.abs(rawOuterFaceProjection.end.xMm - rawOuterFaceProjection.start.xMm);
    const outerDy = Math.abs(rawOuterFaceProjection.end.yMm - rawOuterFaceProjection.start.yMm);
    const faceAlignedPoint = outerDx >= outerDy
      ? { xMm: previewPoint.xMm, yMm: rawOuterFaceProjection.point.yMm }
      : { xMm: rawOuterFaceProjection.point.xMm, yMm: previewPoint.yMm };
    // Keep the physical outer face as the eventual contact/closure target, but
    // preserve an along-face endpoint snap only while the result remains on the
    // current straight axis. Never copy an off-axis wall-thickness offset onto
    // the orange preview; confirmClosure bridges that remaining gap instead.
    previewPoint = constrainStraightSnapPoint(
      session,
      anchor,
      faceAlignedPoint,
      previewPoint
    );
  } else if (rayIntersection) {
    const distToAnchor = distanceMm(anchor, previewPoint);
    if (distToAnchor > rayIntersection.distanceMm) {
      previewPoint = constrainStraightSnapPoint(
        session,
        anchor,
        rayIntersection.point,
        previewPoint
      );
    }
  }
  session.previewOuterFaceWallId = rawOuterFaceProjection ? rawOuterFaceProjection.wall.id : '';
  const partitionProjection = findPartitionClosureProjection(
    floor,
    session,
    anchor,
    previewPoint
  );
  if (partitionProjection) {
    previewPoint = constrainStraightSnapPoint(
      session,
      anchor,
      partitionProjection.point,
      previewPoint
    );
  }
  let previewMeasurementStartInsetMm = resolvePreviewMeasurementStartInsetMm(
    floor,
    session,
    anchor,
    previewPoint
  );
  const continuationStartAdjustment = resolveOuterTContinuationStartAdjustment(
    floor,
    session,
    anchor,
    previewPoint
  );
  if (continuationStartAdjustment.insetMm || continuationStartAdjustment.extensionMm) {
    previewMeasurementStartInsetMm = continuationStartAdjustment.insetMm;
  }
  let previewMeasurementStartExtensionMm = continuationStartAdjustment.extensionMm;
  let previewMeasurementEndInsetMm = 0;
  let previewLengthMm = calculateMeasuredPreviewLength(
    anchor,
    previewPoint,
    previewMeasurementStartInsetMm,
    previewMeasurementEndInsetMm,
    previewMeasurementStartExtensionMm
  );
  const inferredMeasurementSide = resolveBoundaryAlignedMeasurementSide(
    floor,
    session,
    anchor,
    previewPoint
  );
  const activeWallCount = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  const lastWall = activeWallCount > 0 ? (floor.walls || [])[floor.walls.length - 1] : null;
  if (
    session.measurementSideUserSet &&
    lastWall &&
    (lastWall.bodyNormalSide === 'left' || lastWall.bodyNormalSide === 'right')
  ) {
    session.previewBodyNormalSide = lastWall.bodyNormalSide;
  }
  let previewMeasurementSide = inferredMeasurementSide;
  if (
    session.measurementSideUserSet &&
    (session.previewMeasurementSide === 'left' || session.previewMeasurementSide === 'right')
  ) {
    previewMeasurementSide = session.previewMeasurementSide;
  } else if (
    session.measurementSideUserSet &&
    (session.measurementSide === 'left' || session.measurementSide === 'right')
  ) {
    previewMeasurementSide = session.measurementSide;
  } else if (activeWallCount === 0 && session.activeSpaceSharedWallId) {
    session.measurementSide = previewMeasurementSide;
  }

  transitionSessionState(session, 'PREVIEW_STARTED', SESSION_STATES.WALL_PREVIEW);
  session.previewPoint = previewPoint;
  session.previewLengthMm = previewLengthMm;
  session.previewAngleDeg = angleDeg(anchor, previewPoint);
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = previewMeasurementSide;
  session.previewMeasurementStartInsetMm = previewMeasurementStartInsetMm;
  session.previewMeasurementStartExtensionMm = previewMeasurementStartExtensionMm;
  session.previewMeasurementEndInsetMm = previewMeasurementEndInsetMm;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.partitionSourceSpaceId = partitionProjection ? partitionProjection.sourceSpace.id : '';
  session.alignmentSnapGuide = alignment.guide;

  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const directCloseWallCount = getMinimumDirectBoundaryCloseWallCount(floor, session);
  const inferredMergeWallCount = getMinimumClosureSuggestionWallCount(floor, session);
  let outerFaceProjection = null;
  let sharedProjection = null;
  let reversePreviewEdit = null;
  let reverseSharedWallClose = false;
  if (activeStartNode && activeWallCount + 1 >= directCloseWallCount) {
    // A final drag can land on the visible outer face of a perpendicular
    // closed wall. That is not the same topology point as the wall centre:
    // forcing it onto the centre line turns the visible vertical orange edge
    // into a diagonal/shared closure and later adds a wall thickness outward.
    outerFaceProjection = rawOuterFaceProjection || findOuterFaceClosureProjection(floor, session, previewPoint);
    sharedProjection = outerFaceProjection
      ? null
      : findAnySharedWallClosureProjection(floor, session, previewPoint);
    if (outerFaceProjection) {
      reversePreviewEdit = resolveLastWallReverseEdit(floor, session, anchor, previewPoint);
    } else if (sharedProjection) {
      if (
        session.mode === 'straight' &&
        sharedProjection.node &&
        (
          sharedProjection.snapsToTopologyEndpoint ||
          distanceMm(previewPoint, sharedProjection.point) <= CLOSE_TOLERANCE_MM
        )
      ) {
        // Keep the orange preview on-axis. Copying an off-axis topology corner
        // here turns a straight wall into a diagonal; confirmClosure bridges
        // the remaining thickness gap after the orthogonal wall is committed.
        previewPoint = constrainStraightSnapPoint(
          session,
          anchor,
          sharedProjection.point,
          previewPoint
        );
        previewMeasurementStartInsetMm = resolvePreviewMeasurementStartInsetMm(
          floor,
          session,
          anchor,
          previewPoint
        );
        const snappedStartAdjustment = resolveOuterTContinuationStartAdjustment(
          floor,
          session,
          anchor,
          previewPoint
        );
        if (snappedStartAdjustment.insetMm || snappedStartAdjustment.extensionMm) {
          previewMeasurementStartInsetMm = snappedStartAdjustment.insetMm;
          previewMeasurementStartExtensionMm = snappedStartAdjustment.extensionMm;
        }
        if (!session.measurementSideUserSet) {
          previewMeasurementSide = resolveBoundaryAlignedMeasurementSide(
            floor,
            session,
            anchor,
            previewPoint
          );
          session.previewMeasurementSide = previewMeasurementSide;
        }
        session.previewPoint = previewPoint;
        session.previewLengthMm = previewLengthMm;
        session.previewAngleDeg = angleDeg(anchor, previewPoint);
        if (!session.alignmentSnapGuide && distanceMm(previewPoint, rawPoint) > 0) {
          session.alignmentSnapGuide = {
            type: 'rectangle-third-wall',
            direction: isHorizontalSegment(anchor, previewPoint) ? 'vertical' : 'horizontal',
            referencePoint: { xMm: sharedProjection.node.xMm, yMm: sharedProjection.node.yMm },
            snappedPoint: { xMm: previewPoint.xMm, yMm: previewPoint.yMm }
          };
        }
      }
      previewMeasurementEndInsetMm = resolveSharedClosureEndInsetMm(
        floor,
        session,
        anchor,
        previewPoint,
        sharedProjection.wall.id
      );
    } else {
      reverseSharedWallClose = !!(session.activeSpaceSharedWallId &&
        resolveLastWallReverseEdit(floor, session, anchor, previewPoint));
    }
  }
  Object.assign(session, planPreviewClosureCandidate(floor, session, {
    anchor, previewPoint, activeStartNode, activeWallCount,
    directCloseWallCount, inferredMergeWallCount, outerFaceProjection,
    sharedProjection, reversePreviewEdit, reverseSharedWallClose, partitionProjection
  }).sessionPatch);

  session.previewMeasurementStartInsetMm = previewMeasurementStartInsetMm;
  session.previewMeasurementStartExtensionMm = previewMeasurementStartExtensionMm;
  session.previewMeasurementEndInsetMm = previewMeasurementEndInsetMm;
  session.previewLengthMm = calculateMeasuredPreviewLength(
    anchor,
    previewPoint,
    previewMeasurementStartInsetMm,
    previewMeasurementEndInsetMm,
    previewMeasurementStartExtensionMm
  );

  return { kind: 'preview', session };
}

module.exports = {
  planPreview
};
