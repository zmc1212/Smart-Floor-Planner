function normalizeInset(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

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
  return {
    xMm: Number(point.xMm) + vector.x * amount,
    yMm: Number(point.yMm) + vector.y * amount
  };
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

function measuredReadingMm(topologyLengthMm, wall) {
  const topology = Number(topologyLengthMm);
  if (!Number.isFinite(topology)) return 0;
  return Math.max(
    0,
    topology -
      normalizeInset(wall && wall.measurementStartInsetMm) +
      normalizeInset(wall && wall.measurementStartExtensionMm) -
      normalizeInset(wall && wall.measurementEndInsetMm)
  );
}

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
  const first = {
    x: Number(previous.end.xMm) - Number(previous.start.xMm),
    y: Number(previous.end.yMm) - Number(previous.start.yMm)
  };
  const second = {
    x: Number(next.end.xMm) - Number(next.start.xMm),
    y: Number(next.end.yMm) - Number(next.start.yMm)
  };
  const cross = first.x * second.y - first.y * second.x;
  if (Math.abs(cross) < 0.000001) return null;
  const between = {
    x: Number(next.start.xMm) - Number(previous.start.xMm),
    y: Number(next.start.yMm) - Number(previous.start.yMm)
  };
  const factor = (between.x * second.y - between.y * second.x) / cross;
  return {
    xMm: Number(previous.start.xMm) + factor * first.x,
    yMm: Number(previous.start.yMm) + factor * first.y
  };
}

module.exports = {
  wallFrame,
  resolveBodyNormal,
  projectWallFaces,
  projectWorkingFace,
  intersectWorkingLines,
  measuredReadingMm
};
