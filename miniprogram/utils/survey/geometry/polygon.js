const segment = require('./segment.js');

function signedArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    sum += Number(point.xMm) * Number(next.yMm) - Number(next.xMm) * Number(point.yMm);
  });
  return sum / 2;
}

function hasSelfIntersection(points) {
  if (!Array.isArray(points) || points.length < 4) return false;
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (first === 0 && secondNext === 0) continue;
      if (segment.segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  signedArea,
  area: (points) => Math.abs(signedArea(points)),
  hasSelfIntersection
};
