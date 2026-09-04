const { buildWallRenderGeometry, resolveClosedBoundaryInsetMm } = require('../read-model/wall-geometry.js');
const { findClosedSpaceForWall } = require('../topology/closed-boundary.js');
const { resolveMeasurementEndInsetMm } = require('../topology/wall-alignment.js');
function resolvePreviewMeasurementStartInsetMm(floor, session, anchor, previewPoint) {
  if (!floor || !session || !anchor || !previewPoint || !session.activeSpaceSharedWallId) return 0;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (activeWallCount !== 0 || !findClosedSpaceForWall(floor, session.activeSpaceSharedWallId)) return 0;
  return resolveClosedBoundaryInsetMm(floor, anchor, previewPoint, {
    preferredWallId: session.activeSpaceSharedWallId
  });
}

function resolveOuterTContinuationStartAdjustment(floor, session, anchor, previewPoint) {
  if (
    !floor ||
    !session ||
    !anchor ||
    !previewPoint ||
    !session.activeSpaceSharedWallMiddle ||
    session.activeSpaceSharedSnapLine !== 'outer'
  ) {
    return { insetMm: 0, extensionMm: 0 };
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (activeWallCount === 0) return { insetMm: 0, extensionMm: 0 };

  const previousWall = (floor.walls || [])[floor.walls.length - 1];
  const previousGeometry = previousWall ? buildWallRenderGeometry(floor, previousWall) : null;
  if (!previousGeometry) return { insetMm: 0, extensionMm: 0 };

  const dx = previewPoint.xMm - anchor.xMm;
  const dy = previewPoint.yMm - anchor.yMm;
  const coordinateLength = Math.sqrt(dx * dx + dy * dy);
  if (coordinateLength <= 0) return { insetMm: 0, extensionMm: 0 };

  const workingStart = previousGeometry.end;

  const signedOffsetMm = Math.round(
    (workingStart.xMm - anchor.xMm) * dx / coordinateLength +
    (workingStart.yMm - anchor.yMm) * dy / coordinateLength
  );
  return signedOffsetMm >= 0
    ? { insetMm: signedOffsetMm, extensionMm: 0 }
    : { insetMm: 0, extensionMm: -signedOffsetMm };
}

function resolveSharedClosureEndInsetMm(floor, session, start, end, sharedWallId) {
  return resolveMeasurementEndInsetMm(floor, start, end, sharedWallId);
}

module.exports = {
  resolvePreviewMeasurementStartInsetMm,
  resolveOuterTContinuationStartAdjustment,
  resolveSharedClosureEndInsetMm
};
