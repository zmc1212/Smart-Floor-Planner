const { MIN_WALL_LENGTH_MM, WALL_EXTENSION_DIRECTION_TOLERANCE_DEG, WALL_OVERLAP_TOLERANCE_MM } = require('../core/constants.js');
const { getNode } = require('../core/graph-query.js');
const { hasClosureInteriorIntersection } = require('./closure-queries.js');
const segmentGeometry = require('../geometry/segment.js');
const vector2 = require('../geometry/vector2.js');

const normalizeSignedAngle = vector2.normalizeSignedAngleDeg;
const pointLineDistanceMm = vector2.pointLineDistanceMm;
const angleDeg = vector2.angleDeg;
const dot = vector2.dot;
const distanceMm = vector2.distanceMm;
function segmentOverlapLengthMm(start, end, otherStart, otherEnd) {
  return segmentGeometry.overlapLengthMm(
    start,
    end,
    otherStart,
    otherEnd,
    WALL_OVERLAP_TOLERANCE_MM
  );
}

function findOverlappingWall(floor, start, end, options) {
  const currentLength = distanceMm(start, end);
  if (!floor || !floor.walls || currentLength < MIN_WALL_LENGTH_MM) return null;
  const ignoredWallIds = (options && options.ignoredWallIds) || [];

  return floor.walls.find((wall) => {
    if (ignoredWallIds.indexOf(wall.id) !== -1) return false;
    const wallStart = getNode(floor, wall.startNodeId);
    const wallEnd = getNode(floor, wall.endNodeId);
    if (!wallStart || !wallEnd) return false;

    if (hasClosureInteriorIntersection(start, end, wallStart, wallEnd)) {
      return wall;
    }

    const overlapLength = segmentOverlapLengthMm(start, end, wallStart, wallEnd);
    const wallLength = distanceMm(wallStart, wallEnd);
    const meaningfulOverlap = Math.min(currentLength, wallLength) * 0.25;
    return overlapLength > Math.max(WALL_OVERLAP_TOLERANCE_MM, meaningfulOverlap);
  }) || null;
}

function resolveLastWallReverseEdit(floor, session, anchor, endPoint) {
  if (!anchor || !endPoint) return null;

  const lastWallIndex = floor.walls.length - 1;
  const lastWall = floor.walls[lastWallIndex];
  if (!lastWall || lastWallIndex < session.activeSpaceStartWallIndex || lastWall.endNodeId !== anchor.id) {
    return null;
  }
  if (lastWall.status !== 'confirmed' || lastWall.mode !== session.mode ||
      Number(lastWall.thicknessMm) !== Number(session.thicknessMm) ||
      floor.openings.some((opening) => opening.wallId === lastWall.id)) {
    return null;
  }
  if (floor.spaces.some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(lastWall.id) !== -1
  ))) {
    return null;
  }

  const anchorReferenceCount = floor.walls.reduce((count, wall) => (
    count + (wall.startNodeId === anchor.id ? 1 : 0) + (wall.endNodeId === anchor.id ? 1 : 0)
  ), 0);
  if (anchorReferenceCount !== 1) return null;

  const lastStart = getNode(floor, lastWall.startNodeId);
  const currentLength = lastStart ? distanceMm(lastStart, anchor) : 0;
  if (!lastStart || currentLength < MIN_WALL_LENGTH_MM) return null;

  const direction = {
    x: (anchor.xMm - lastStart.xMm) / currentLength,
    y: (anchor.yMm - lastStart.yMm) / currentLength
  };
  const shortenedLength = dot({
    x: endPoint.xMm - lastStart.xMm,
    y: endPoint.yMm - lastStart.yMm
  }, direction);
  const previousAngle = angleDeg(lastStart, anchor);
  const reverseAngle = angleDeg(anchor, endPoint);
  if (
    pointLineDistanceMm(endPoint, lastStart, direction) > WALL_OVERLAP_TOLERANCE_MM ||
    Math.abs(Math.abs(normalizeSignedAngle(reverseAngle - previousAngle)) - 180) >
      WALL_EXTENSION_DIRECTION_TOLERANCE_DEG
  ) {
    return null;
  }

  return { lastWall, lastWallIndex, lastStart, currentLength, shortenedLength };
}

function canShortenLastWall(reverseEdit) {
  return !!(
    reverseEdit &&
    reverseEdit.shortenedLength >= MIN_WALL_LENGTH_MM &&
    reverseEdit.shortenedLength < reverseEdit.currentLength - 1
  );
}

function canRetractLastWallToStart(reverseEdit, session) {
  return !!(
    reverseEdit &&
    reverseEdit.lastWallIndex > session.activeSpaceStartWallIndex &&
    Math.abs(reverseEdit.shortenedLength) <= WALL_OVERLAP_TOLERANCE_MM
  );
}

function canExtendLastWall(floor, session, anchor, endPoint, measurementSide, isClosingCurrentSpace) {
  if (isClosingCurrentSpace || !anchor || !endPoint) return false;
  const lastWallIndex = floor.walls.length - 1;
  const lastWall = floor.walls[lastWallIndex];
  if (!lastWall || lastWallIndex < session.activeSpaceStartWallIndex || lastWall.endNodeId !== anchor.id) {
    return false;
  }
  if (lastWall.status !== 'confirmed' || lastWall.mode !== session.mode ||
      Number(lastWall.thicknessMm) !== Number(session.thicknessMm)) {
    return false;
  }
  if (floor.spaces.some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(lastWall.id) !== -1
  ))) {
    return false;
  }
  const anchorReferenceCount = floor.walls.reduce((count, wall) => (
    count + (wall.startNodeId === anchor.id ? 1 : 0) + (wall.endNodeId === anchor.id ? 1 : 0)
  ), 0);
  if (anchorReferenceCount !== 1) return false;
  const lastStart = getNode(floor, lastWall.startNodeId);
  if (!lastStart) return false;
  const previousAngle = angleDeg(lastStart, anchor);
  const extensionAngle = angleDeg(anchor, endPoint);
  return Math.abs(normalizeSignedAngle(extensionAngle - previousAngle)) <= WALL_EXTENSION_DIRECTION_TOLERANCE_DEG;
}

module.exports = {
  canExtendLastWall,
  segmentOverlapLengthMm,
  findOverlappingWall,
  resolveLastWallReverseEdit,
  canShortenLastWall,
  canRetractLastWallToStart
};
