const segment = require('./segment.js');

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
  return Math.hypot(Number(end.xMm) - Number(start.xMm), Number(end.yMm) - Number(start.yMm));
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
  hasSelfIntersection,
  collapseDegenerateRing
};
