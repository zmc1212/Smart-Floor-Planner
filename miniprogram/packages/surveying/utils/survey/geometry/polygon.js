const segment = require('./segment.js');
const vector2 = require('./vector2.js');

const DEGENERATE_EDGE_MM = 0.001;

function signedArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    sum += Number(point.xMm) * Number(next.yMm) - Number(next.xMm) * Number(point.yMm);
  });
  return sum / 2;
}

function edgeLengthMm(start, end) {
  return vector2.distance(start, end);
}

function orientation(points) {
  const areaMm2 = signedArea(points);
  if (areaMm2 > 0) return 'counterclockwise';
  if (areaMm2 < 0) return 'clockwise';
  return 'degenerate';
}

function containsPoint(point, points) {
  if (!point || !Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const crossesRay = (currentPoint.yMm > point.yMm) !== (previousPoint.yMm > point.yMm);
    if (!crossesRay) continue;
    const intersectionX = (
      (previousPoint.xMm - currentPoint.xMm) * (point.yMm - currentPoint.yMm) /
      (previousPoint.yMm - currentPoint.yMm) + currentPoint.xMm
    );
    if (point.xMm < intersectionX) inside = !inside;
  }
  return inside;
}

function centroid(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const crossValue = point.xMm * next.yMm - next.xMm * point.yMm;
    twiceArea += crossValue;
    centroidX += (point.xMm + next.xMm) * crossValue;
    centroidY += (point.yMm + next.yMm) * crossValue;
  });
  if (Math.abs(twiceArea) < 0.000001) return null;
  return {
    xMm: centroidX / (3 * twiceArea),
    yMm: centroidY / (3 * twiceArea)
  };
}

// Collapse zero-length consecutive ring points (including the wrap-around seam).
// Degenerate edges break the "skip adjacent edges" index math and make endpoint
// touching look like a self-intersection to a naive segment test.
function collapseDegenerateRing(points) {
  if (!Array.isArray(points) || !points.length) return [];
  const collapsed = [];
  points.forEach((point) => {
    if (!point) return;
    const prev = collapsed[collapsed.length - 1];
    if (!prev || edgeLengthMm(prev, point) > DEGENERATE_EDGE_MM) {
      collapsed.push(point);
    }
  });
  while (
    collapsed.length >= 2 &&
    edgeLengthMm(collapsed[0], collapsed[collapsed.length - 1]) <= DEGENERATE_EDGE_MM
  ) {
    collapsed.pop();
  }
  return collapsed;
}

function edgesAreAdjacentOnRing(first, firstNext, second, secondNext, ringLength) {
  if (first === second || firstNext === second || secondNext === first) return true;
  // Wrap-around adjacency: last edge shares the origin with the first edge.
  if (first === 0 && secondNext === 0) return true;
  if (second === 0 && firstNext === 0) return true;
  if (ringLength >= 2 && firstNext === 0 && second === ringLength - 1) return true;
  if (ringLength >= 2 && secondNext === 0 && first === ringLength - 1) return true;
  return false;
}

function hasSelfIntersection(points) {
  const ring = collapseDegenerateRing(points);
  if (ring.length < 4) return false;
  for (let first = 0; first < ring.length; first += 1) {
    const firstNext = (first + 1) % ring.length;
    for (let second = first + 1; second < ring.length; second += 1) {
      const secondNext = (second + 1) % ring.length;
      if (edgesAreAdjacentOnRing(first, firstNext, second, secondNext, ring.length)) continue;
      // Proper crossings only. Shared endpoints / T-touches are not self-intersections
      // for a closed wall-graph face; treating them as such rejects valid adjacent-room
      // closures after shared-wall splits and thickness bridges.
      if (segment.properIntersection(
        ring[first],
        ring[firstNext],
        ring[second],
        ring[secondNext]
      )) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  signedArea,
  area: (points) => Math.abs(signedArea(points)),
  orientation,
  containsPoint,
  centroid,
  hasSelfIntersection,
  collapseDegenerateRing
};
