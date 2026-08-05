/*
 * Builds a boolean union of wall body polygons without a rendering dependency.
 * Boundary edges are split at intersections, classified by samples on both
 * sides, and then stitched into oriented rings. The ring orientation is kept
 * so non-zero canvas/SVG filling preserves room-side holes.
 */

const EPSILON = 0.0001;

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function normalizePolygon(points) {
  const cleaned = [];
  (points || []).forEach((point) => {
    if (!point) return;
    const normalized = { x: Number(point.x), y: Number(point.y) };
    if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y)) return;
    if (!cleaned.length || distance(cleaned[cleaned.length - 1], normalized) > EPSILON) {
      cleaned.push(normalized);
    }
  });
  if (cleaned.length > 1 && distance(cleaned[0], cleaned[cleaned.length - 1]) <= EPSILON) cleaned.pop();
  if (cleaned.length < 3) return [];
  return signedArea(cleaned) >= 0 ? cleaned : cleaned.reverse();
}

function pointKey(point) {
  return `${Math.round(point.x / EPSILON)}:${Math.round(point.y / EPSILON)}`;
}

function snapPoint(point) {
  return {
    x: Math.round(point.x / EPSILON) * EPSILON,
    y: Math.round(point.y / EPSILON) * EPSILON
  };
}

function segmentKey(start, end) {
  const first = pointKey(start);
  const second = pointKey(end);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function pointOnSegment(point, start, end) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared <= EPSILON * EPSILON) return distance(point, start) <= EPSILON;
  const t = ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared;
  if (t < -EPSILON || t > 1 + EPSILON) return false;
  const projection = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  };
  return distance(point, projection) <= EPSILON * 10;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (pointOnSegment(point, prior, current)) return true;
    const intersects = ((current.y > point.y) !== (prior.y > point.y)) &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function lineIntersection(firstStart, firstEnd, secondStart, secondEnd) {
  const firstVector = { x: firstEnd.x - firstStart.x, y: firstEnd.y - firstStart.y };
  const secondVector = { x: secondEnd.x - secondStart.x, y: secondEnd.y - secondStart.y };
  const denominator = firstVector.x * secondVector.y - firstVector.y * secondVector.x;
  const offset = { x: secondStart.x - firstStart.x, y: secondStart.y - firstStart.y };
  if (Math.abs(denominator) <= EPSILON) return null;
  const firstT = (offset.x * secondVector.y - offset.y * secondVector.x) / denominator;
  const secondT = (offset.x * firstVector.y - offset.y * firstVector.x) / denominator;
  if (firstT < -EPSILON || firstT > 1 + EPSILON || secondT < -EPSILON || secondT > 1 + EPSILON) return null;
  return {
    point: {
      x: firstStart.x + firstVector.x * firstT,
      y: firstStart.y + firstVector.y * firstT
    },
    firstT,
    secondT
  };
}

function infiniteLineIntersection(firstStart, firstEnd, secondStart, secondEnd) {
  const firstVector = { x: firstEnd.x - firstStart.x, y: firstEnd.y - firstStart.y };
  const secondVector = { x: secondEnd.x - secondStart.x, y: secondEnd.y - secondStart.y };
  const denominator = firstVector.x * secondVector.y - firstVector.y * secondVector.x;
  if (Math.abs(denominator) <= EPSILON) return null;
  const offset = { x: secondStart.x - firstStart.x, y: secondStart.y - firstStart.y };
  const t = (offset.x * secondVector.y - offset.y * secondVector.x) / denominator;
  return {
    x: firstStart.x + firstVector.x * t,
    y: firstStart.y + firstVector.y * t
  };
}

function convexHull(points) {
  const unique = Array.from(new Map(points.map((point) => [pointKey(point), snapPoint(point)])).values());
  if (unique.length < 3) return [];
  unique.sort((first, second) => first.x - second.x || first.y - second.y);
  const buildHalf = (items) => {
    const half = [];
    items.forEach((point) => {
      while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], point) <= EPSILON) half.pop();
      half.push(point);
    });
    return half;
  };
  const lower = buildHalf(unique);
  const upper = buildHalf(unique.slice().reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function projectPointToOuterEdge(wall, point) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return null;
  const t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lengthSquared;
  return {
    x: wall.outerStart.x + (wall.outerEnd.x - wall.outerStart.x) * t,
    y: wall.outerStart.y + (wall.outerEnd.y - wall.outerStart.y) * t
  };
}

function buildJoinPolygons(walls) {
  const geometryWalls = (walls || []).filter((wall) => (
    wall && wall.start && wall.end && wall.outerStart && wall.outerEnd
  ));
  const endpoints = new Map();
  geometryWalls.forEach((wall) => {
    [wall.start, wall.end].forEach((point) => endpoints.set(pointKey(point), snapPoint(point)));
  });
  const joins = [];
  endpoints.forEach((joint) => {
    const incident = geometryWalls.filter((wall) => pointOnSegment(joint, wall.start, wall.end));
    if (incident.length < 2) return;
    const points = [joint];
    incident.forEach((wall) => {
      const outerPoint = projectPointToOuterEdge(wall, joint);
      if (outerPoint) points.push(outerPoint);
    });
    for (let firstIndex = 0; firstIndex < incident.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < incident.length; secondIndex += 1) {
        const first = incident[firstIndex];
        const second = incident[secondIndex];
        const intersection = infiniteLineIntersection(first.outerStart, first.outerEnd, second.outerStart, second.outerEnd);
        const limit = Math.max(Number(first.thickness || 0), Number(second.thickness || 0), 1) * 4;
        if (intersection && distance(intersection, joint) <= limit) points.push(intersection);
      }
    }
    const hull = convexHull(points);
    if (hull.length >= 3 && Math.abs(signedArea(hull)) > EPSILON) joins.push(hull);
  });
  return joins;
}

function addProjectedParameter(parameters, point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON * EPSILON) return;
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  if (t >= -EPSILON && t <= 1 + EPSILON) parameters.push(Math.max(0, Math.min(1, t)));
}

function splitEdges(polygons) {
  const edges = [];
  polygons.forEach((polygon) => {
    polygon.forEach((start, index) => {
      const end = polygon[(index + 1) % polygon.length];
      edges.push({ start, end, parameters: [0, 1] });
    });
  });

  for (let firstIndex = 0; firstIndex < edges.length; firstIndex += 1) {
    const first = edges[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex += 1) {
      const second = edges[secondIndex];
      const intersection = lineIntersection(first.start, first.end, second.start, second.end);
      if (intersection) {
        first.parameters.push(intersection.firstT);
        second.parameters.push(intersection.secondT);
        continue;
      }
      if (Math.abs(cross(first.start, first.end, second.start)) <= EPSILON * 10 &&
          Math.abs(cross(first.start, first.end, second.end)) <= EPSILON * 10) {
        addProjectedParameter(first.parameters, second.start, first.start, first.end);
        addProjectedParameter(first.parameters, second.end, first.start, first.end);
        addProjectedParameter(second.parameters, first.start, second.start, second.end);
        addProjectedParameter(second.parameters, first.end, second.start, second.end);
      }
    }
  }

  const pieces = [];
  edges.forEach((edge) => {
    const parameters = Array.from(new Set(edge.parameters.map((value) => Number(value.toFixed(10))))).sort((a, b) => a - b);
    for (let index = 0; index < parameters.length - 1; index += 1) {
      const startT = parameters[index];
      const endT = parameters[index + 1];
      if (endT - startT <= EPSILON) continue;
      pieces.push({
        start: {
          x: edge.start.x + (edge.end.x - edge.start.x) * startT,
          y: edge.start.y + (edge.end.y - edge.start.y) * startT
        },
        end: {
          x: edge.start.x + (edge.end.x - edge.start.x) * endT,
          y: edge.start.y + (edge.end.y - edge.start.y) * endT
        }
      });
    }
  });
  return pieces;
}

function classifyBoundaryPieces(pieces, polygons, scale) {
  const sampleOffset = Math.max(EPSILON * 100, scale * 0.000001);
  const candidates = [];
  pieces.forEach((piece) => {
    const dx = piece.end.x - piece.start.x;
    const dy = piece.end.y - piece.start.y;
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const midpoint = {
      x: (piece.start.x + piece.end.x) / 2,
      y: (piece.start.y + piece.end.y) / 2
    };
    const left = { x: midpoint.x - (dy / length) * sampleOffset, y: midpoint.y + (dx / length) * sampleOffset };
    const right = { x: midpoint.x + (dy / length) * sampleOffset, y: midpoint.y - (dx / length) * sampleOffset };
    const leftInside = polygons.some((polygon) => pointInPolygon(left, polygon));
    const rightInside = polygons.some((polygon) => pointInPolygon(right, polygon));
    if (leftInside === rightInside) return;
    const oriented = leftInside ? piece : { start: piece.end, end: piece.start };
    candidates.push({ start: snapPoint(oriented.start), end: snapPoint(oriented.end) });
  });

  const edgeMap = new Map();
  candidates.forEach((candidate) => {
    const key = segmentKey(candidate.start, candidate.end);
    const previous = edgeMap.get(key);
    if (!previous) {
      edgeMap.set(key, candidate);
      return;
    }
    if (pointKey(previous.start) === pointKey(candidate.end) && pointKey(previous.end) === pointKey(candidate.start)) {
      edgeMap.delete(key);
    }
  });
  return Array.from(edgeMap.values());
}

function chooseNextSegment(current, candidates) {
  if (candidates.length <= 1) return candidates[0];
  const incoming = { x: current.end.x - current.start.x, y: current.end.y - current.start.y };
  return candidates.slice().sort((first, second) => {
    const firstVector = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
    const secondVector = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
    const firstTurn = Math.atan2(incoming.x * firstVector.y - incoming.y * firstVector.x, incoming.x * firstVector.x + incoming.y * firstVector.y);
    const secondTurn = Math.atan2(incoming.x * secondVector.y - incoming.y * secondVector.x, incoming.x * secondVector.x + incoming.y * secondVector.y);
    return secondTurn - firstTurn;
  })[0];
}

function removeCollinearPoints(ring) {
  const result = ring.slice();
  let changed = true;
  while (changed && result.length > 2) {
    changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const next = result[(index + 1) % result.length];
      if (Math.abs(cross(previous, current, next)) <= EPSILON * 10 && pointOnSegment(current, previous, next)) {
        result.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function stitchRings(segments) {
  const outgoing = new Map();
  segments.forEach((segment, index) => {
    const key = pointKey(segment.start);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push({ ...segment, index });
  });
  const used = new Set();
  const rings = [];

  segments.forEach((initial, initialIndex) => {
    if (used.has(initialIndex)) return;
    const ring = [initial.start];
    let current = { ...initial, index: initialIndex };
    used.add(initialIndex);
    let guard = 0;
    while (guard++ < segments.length + 2) {
      ring.push(current.end);
      if (pointKey(current.end) === pointKey(ring[0])) break;
      const options = (outgoing.get(pointKey(current.end)) || []).filter((candidate) => !used.has(candidate.index));
      if (!options.length) break;
      current = chooseNextSegment(current, options);
      used.add(current.index);
    }
    if (ring.length > 3 && pointKey(ring[0]) === pointKey(ring[ring.length - 1])) {
      const cleaned = removeCollinearPoints(ring.slice(0, -1));
      if (Math.abs(signedArea(cleaned)) > EPSILON) rings.push(cleaned);
    }
  });
  return rings;
}

function createWallSolidPlan(input) {
  const options = input || {};
  const sourceWalls = options.walls || [];
  const polygons = sourceWalls
    .map((wall) => normalizePolygon(wall && wall.polygon))
    .filter((polygon) => polygon.length >= 3);
  buildJoinPolygons(sourceWalls).forEach((polygon) => polygons.push(normalizePolygon(polygon)));
  if (!polygons.length) return { rings: [], segments: [] };
  const allPoints = polygons.flat();
  const xs = allPoints.map((point) => point.x);
  const ys = allPoints.map((point) => point.y);
  const scale = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pieces = splitEdges(polygons);
  const segments = classifyBoundaryPieces(pieces, polygons, scale);
  return { rings: stitchRings(segments), segments };
}

module.exports = {
  createWallSolidPlan,
  signedArea
};
