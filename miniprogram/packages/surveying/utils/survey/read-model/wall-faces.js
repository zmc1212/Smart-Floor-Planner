const segment = require('../geometry/segment.js');
const vector2 = require('../geometry/vector2.js');
const wallDomain = require('../domain/wall.js');

function wallFrame(start, end) {
  if (!start || !end) return null;
  const dx = Number(end.xMm) - Number(start.xMm);
  const dy = Number(end.yMm) - Number(start.yMm);
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const direction = { x: dx / length, y: dy / length };
  return {
    direction,
    leftNormal: { x: direction.y, y: -direction.x },
    rightNormal: { x: -direction.y, y: direction.x },
    length
  };
}

function addScaled(point, vector, amount) {
  return vector2.addScaled(point, vector, amount);
}

function resolveBodyNormal(wall, start, end, centroid) {
  const frame = wallFrame(start, end);
  if (!frame) return null;
  if (wall && wall.bodyNormalSide === 'left') return frame.leftNormal;
  if (wall && wall.bodyNormalSide === 'right') return frame.rightNormal;
  if (centroid) {
    const midpoint = {
      xMm: (Number(start.xMm) + Number(end.xMm)) / 2,
      yMm: (Number(start.yMm) + Number(end.yMm)) / 2
    };
    const outward = { x: midpoint.xMm - centroid.xMm, y: midpoint.yMm - centroid.yMm };
    return (frame.leftNormal.x * outward.x + frame.leftNormal.y * outward.y) >=
      (frame.rightNormal.x * outward.x + frame.rightNormal.y * outward.y)
      ? frame.leftNormal
      : frame.rightNormal;
  }
  return wall && wall.measurementSide === 'right' ? frame.rightNormal : frame.leftNormal;
}

function projectWallFaces(wall, start, end, thicknessMm, centroid) {
  const frame = wallFrame(start, end);
  const normal = resolveBodyNormal(wall, start, end, centroid);
  if (!frame || !normal) return null;
  const thickness = Number(thicknessMm);
  const amount = Number.isFinite(thickness) ? thickness : 0;
  return {
    start,
    end,
    direction: frame.direction,
    normal,
    lengthMm: frame.length,
    outerStart: addScaled(start, normal, amount),
    outerEnd: addScaled(end, normal, amount)
  };
}

const measuredReadingMm = wallDomain.measuredReadingMm;

function projectWorkingFace(wall, start, end) {
  const frame = wallFrame(start, end);
  if (!frame) return null;
  return {
    start,
    end,
    direction: frame.direction,
    lengthMm: frame.length
  };
}

function intersectWorkingLines(previous, next) {
  if (!previous || !next) return null;
  return segment.intersectLines(previous.start, previous.end, next.start, next.end);
}

module.exports = {
  wallFrame,
  resolveBodyNormal,
  projectWallFaces,
  projectWorkingFace,
  intersectWorkingLines,
  measuredReadingMm
};
