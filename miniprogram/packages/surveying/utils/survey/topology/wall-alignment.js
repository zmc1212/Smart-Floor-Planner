const { DEFAULT_THICKNESS_MM } = require('../core/constants.js');
const { getWall, getNodeWallUseCount } = require('../core/graph-query.js');
const { findClosedSpaceForWall } = require('./closed-boundary.js');
const {
  buildBaseWallSegment,
  buildResolvedSegment,
  resolveClosedBoundaryInsetMm
} = require('../read-model/wall-geometry.js');

const vector2 = require('../geometry/vector2.js');
const distanceMm = vector2.distanceMm;
const dot = vector2.dot;
const { perpendicularDistanceToLineMm } = require('../geometry/segment.js');

const wallDomain = require('../domain/wall.js');
const normalForMeasurementSide = wallDomain.normalForMeasurementSide;

function resolveCollinearClosedOuterBodySide(floor, start, end, sourceSharedWallId) {
  if (!floor || !start || !end) return '';
  const midpoint = {
    xMm: (Number(start.xMm) + Number(end.xMm)) / 2,
    yMm: (Number(start.yMm) + Number(end.yMm)) / 2
  };
  const onFaceToleranceMm = 2;
  const sourceSpace = sourceSharedWallId ? findClosedSpaceForWall(floor, sourceSharedWallId) : null;
  let bestSide = '';
  let bestOuterDist = onFaceToleranceMm;

  (floor.walls || []).forEach((wall) => {
    const wallSpace = findClosedSpaceForWall(floor, wall.id);
    if (!wallSpace) return;
    if (sourceSpace && wallSpace.id === sourceSpace.id) return;
    const segment = buildBaseWallSegment(floor, wall);
    if (!segment) return;
    const topologyDist = Math.max(
      perpendicularDistanceToLineMm(start, segment.start, segment.end),
      perpendicularDistanceToLineMm(end, segment.start, segment.end)
    );
    const outerDist = Math.max(
      perpendicularDistanceToLineMm(start, segment.outerStart, segment.outerEnd),
      perpendicularDistanceToLineMm(end, segment.outerStart, segment.outerEnd)
    );
    const thicknessMm = Number(segment.thicknessMm) || DEFAULT_THICKNESS_MM;
    if (
      outerDist > bestOuterDist ||
      topologyDist < thicknessMm * 0.5 ||
      outerDist >= topologyDist - 1
    ) return;

    const towardCenter = {
      x: (segment.start.xMm + segment.end.xMm) / 2 - midpoint.xMm,
      y: (segment.start.yMm + segment.end.yMm) / 2 - midpoint.yMm
    };
    const leftNormal = normalForMeasurementSide(start, end, 'left');
    const rightNormal = normalForMeasurementSide(start, end, 'right');
    if (!leftNormal || !rightNormal) return;
    const leftScore = leftNormal.x * towardCenter.x + leftNormal.y * towardCenter.y;
    const rightScore = rightNormal.x * towardCenter.x + rightNormal.y * towardCenter.y;
    if (Math.max(Math.abs(leftScore), Math.abs(rightScore)) < 0.25) return;
    bestOuterDist = outerDist;
    bestSide = leftScore >= rightScore ? 'left' : 'right';
  });
  return bestSide;
}

function resolveStableAxisMeasurementSide(start, end) {
  const leftNormal = normalForMeasurementSide(start, end, 'left');
  const rightNormal = normalForMeasurementSide(start, end, 'right');
  if (!leftNormal || !rightNormal) return 'left';
  const dx = Math.abs(end.xMm - start.xMm);
  const dy = Math.abs(end.yMm - start.yMm);
  const preferredNormal = dy >= dx ? { x: 1, y: 0 } : { x: 0, y: 1 };
  return dot(leftNormal, preferredNormal) >= dot(rightNormal, preferredNormal) ? 'left' : 'right';
}

function resolveBoundaryAlignmentSourceWall(floor, session, start, end) {
  const sourceWall = getWall(floor, session.activeSpaceSharedWallId);
  if (!sourceWall || !start || !end || !start.id) return sourceWall;
  const previewLength = distanceMm(start, end);
  if (!previewLength) return sourceWall;
  const previewDirection = {
    x: (end.xMm - start.xMm) / previewLength,
    y: (end.yMm - start.yMm) / previewLength
  };
  let bestWall = sourceWall;
  const sourceSegment = buildResolvedSegment(floor, sourceWall);
  let bestScore = sourceSegment ? Math.abs(dot(previewDirection, sourceSegment.direction)) : -1;
  (floor.walls || []).forEach((wall) => {
    if (
      wall.id === sourceWall.id ||
      (wall.startNodeId !== start.id && wall.endNodeId !== start.id) ||
      !findClosedSpaceForWall(floor, wall.id)
    ) return;
    const segment = buildResolvedSegment(floor, wall);
    if (!segment) return;
    const score = Math.abs(dot(previewDirection, segment.direction));
    if (score > bestScore + 0.001) {
      bestScore = score;
      bestWall = wall;
    }
  });
  return bestWall;
}

function resolveOpenEndpointContinuationMeasurementSide(floor, session, sourceWall) {
  if (
    !floor || !session || !sourceWall ||
    findClosedSpaceForWall(floor, sourceWall.id) ||
    !session.activeSpaceStartNodeId ||
    getNodeWallUseCount(floor, session.activeSpaceStartNodeId) !== 1
  ) return '';
  const sourceSide = sourceWall.measurementSide === 'right' ? 'right' : 'left';
  if (sourceWall.endNodeId === session.activeSpaceStartNodeId) return sourceSide;
  if (sourceWall.startNodeId === session.activeSpaceStartNodeId) {
    return sourceSide === 'left' ? 'right' : 'left';
  }
  return '';
}

function resolveBoundaryAlignedMeasurementSide(floor, session, start, end) {
  if (!floor || !session || !start || !end) return session ? session.measurementSide : 'left';
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (activeWallCount !== 0 || !session.activeSpaceSharedWallId || !session.activeSpaceSharedSnapLine) {
    return session.measurementSide;
  }
  const sourceWall = resolveBoundaryAlignmentSourceWall(floor, session, start, end);
  const continuationSide = resolveOpenEndpointContinuationMeasurementSide(floor, session, sourceWall);
  if (continuationSide) return continuationSide;
  const sourceSegment = sourceWall ? buildResolvedSegment(floor, sourceWall) : null;
  if (!sourceSegment || !sourceSegment.normal) return session.measurementSide;
  const towardWallBody = sourceSegment.normal;
  const leftNormal = normalForMeasurementSide(start, end, 'left');
  const rightNormal = normalForMeasurementSide(start, end, 'right');
  if (!leftNormal || !rightNormal) return session.measurementSide;
  const leftScore = dot(leftNormal, towardWallBody);
  const rightScore = dot(rightNormal, towardWallBody);
  if (Math.max(Math.abs(leftScore), Math.abs(rightScore)) < 0.25) {
    return resolveStableAxisMeasurementSide(start, end);
  }
  return leftScore >= rightScore ? 'left' : 'right';
}

function resolveMeasurementEndInsetMm(floor, start, end, preferredWallId, excludedWallId) {
  if (!floor || !start || !end) return 0;
  return resolveClosedBoundaryInsetMm(floor, end, start, {
    excludedWallId: excludedWallId || '',
    preferredWallId: preferredWallId || ''
  });
}

module.exports = {
  resolveCollinearClosedOuterBodySide,
  resolveBoundaryAlignedMeasurementSide,
  resolveMeasurementEndInsetMm
};
