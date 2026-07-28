/*
 * Formal survey drawing dimensions.
 *
 * This module is deliberately dependency-free so the Mini Program Canvas and
 * the admin SVG viewer produce the same engineering-style annotation plan.
 * It consumes a read model only; formal v4 surveyGraph data remains unchanged.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function point(x, y) {
  return { x, y };
}

function add(first, second) {
  return point(first.x + second.x, first.y + second.y);
}

function scale(vector, amount) {
  return point(vector.x * amount, vector.y * amount);
}

function subtract(first, second) {
  return point(first.x - second.x, first.y - second.y);
}

function dot(first, second) {
  return first.x * second.x + first.y * second.y;
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y);
}

function cross(first, second) {
  return first.x * second.y - first.y * second.x;
}

function distance(first, second) {
  return magnitude(subtract(first, second));
}

function normalize(vector) {
  const length = magnitude(vector);
  return length ? scale(vector, 1 / length) : point(1, 0);
}

function roundKey(value, tolerance) {
  return Math.round(value / tolerance);
}

function wallFrame(wall) {
  const start = wall.start;
  const end = wall.end;
  const direction = normalize(subtract(end, start));
  const localY = point(-direction.y, direction.x);
  const outward = scale(localY, wall.outsideSign === -1 ? -1 : 1);
  const canonicalDirection = direction.x < -0.0001 || (Math.abs(direction.x) <= 0.0001 && direction.y < 0)
    ? scale(direction, -1)
    : direction;
  const canonicalNormal = point(-canonicalDirection.y, canonicalDirection.x);
  const midpoint = scale(add(start, end), 0.5);
  return {
    start,
    end,
    direction,
    outward,
    canonicalDirection,
    canonicalNormal,
    midpoint,
    startProjection: dot(start, canonicalDirection),
    endProjection: dot(end, canonicalDirection),
    lineProjection: dot(midpoint, canonicalNormal)
  };
}

function exteriorPoint(wall, sourcePoint) {
  const sourceVector = subtract(wall.end, wall.start);
  const sourceLengthSquared = dot(sourceVector, sourceVector);
  const thickness = Math.max(0, Number(wall.thickness || 0));
  if (!sourceLengthSquared) return add(sourcePoint, scale(wall.outward, thickness));

  const position = clamp(dot(subtract(sourcePoint, wall.start), sourceVector) / sourceLengthSquared, 0, 1);
  if (wall.outerStart && wall.outerEnd) {
    return add(wall.outerStart, scale(subtract(wall.outerEnd, wall.outerStart), position));
  }
  return add(sourcePoint, scale(wall.outward, thickness));
}

function dimensionLinePoint(wall, sourcePoint, normal, outerSupport, gap) {
  const exterior = exteriorPoint(wall, sourcePoint);
  return add(exterior, scale(normal, Math.max(0, outerSupport - dot(exterior, normal)) + gap));
}

function normalKey(normal) {
  return `${roundKey(normal.x, 0.001)}:${roundKey(normal.y, 0.001)}`;
}

function getDoorOpeningsForWall(wall, openingsByWall) {
  const sourceWallId = wall.sourceWallId || wall.id;
  const openings = openingsByWall.get(sourceWallId) || [];
  const coordinateLength = Math.max(0.0001, Number(wall.coordinateLength || magnitude(subtract(wall.end, wall.start))));
  const sourceStart = Number.isFinite(wall.sourceStart) ? wall.sourceStart : 0;
  const sourceEnd = Number.isFinite(wall.sourceEnd) ? wall.sourceEnd : coordinateLength;
  const sourceMin = Math.min(sourceStart, sourceEnd);
  const sourceMax = Math.max(sourceStart, sourceEnd);
  const sourceSpan = sourceEnd - sourceStart;
  if (Math.abs(sourceSpan) < 0.0001) return [];

  return openings.flatMap((opening) => {
    const clippedStart = Math.max(sourceMin, Number(opening.start || 0));
    const clippedEnd = Math.min(sourceMax, Number(opening.end || 0));
    if (clippedEnd - clippedStart < 0.5) return [];
    const localStart = (clippedStart - sourceStart) / sourceSpan * coordinateLength;
    const localEnd = (clippedEnd - sourceStart) / sourceSpan * coordinateLength;
    return [Object.assign({}, opening, {
      start: Math.min(localStart, localEnd),
      end: Math.max(localStart, localEnd)
    })];
  }).sort((first, second) => first.start - second.start);
}

function createDimensionItem(options) {
  const opts = options || {};
  const start = opts.start;
  const end = opts.end;
  const normal = opts.normal;
  const distance = Math.max(0, Number(opts.distance || 0));
  const direction = normalize(opts.direction || subtract(end, start));
  const hasLineProjection = Number.isFinite(opts.lineProjection);
  const dimensionStart = opts.dimensionStart || (hasLineProjection
    ? add(scale(direction, dot(start, direction)), scale(normal, opts.lineProjection))
    : add(start, scale(normal, distance)));
  const dimensionEnd = opts.dimensionEnd || (hasLineProjection
    ? add(scale(direction, dot(end, direction)), scale(normal, opts.lineProjection))
    : add(end, scale(normal, distance)));
  return {
    id: opts.id,
    kind: opts.kind,
    groupId: opts.groupId,
    wallId: opts.wallId || '',
    sourceWallId: opts.sourceWallId || opts.wallId || '',
    label: `${Math.round(Number(opts.label || 0))}`,
    lane: Number(opts.lane || 0),
    start: dimensionStart,
    end: dimensionEnd,
    extensionStart: opts.extensionStart || start,
    extensionEnd: opts.extensionEnd || end,
    normal,
    distance
  };
}

function splitContinuousRuns(walls, tolerance) {
  const ordered = walls.slice().sort((first, second) => first.startProjection - second.startProjection);
  const runs = [];
  ordered.forEach((entry) => {
    const start = Math.min(entry.startProjection, entry.endProjection);
    const end = Math.max(entry.startProjection, entry.endProjection);
    const previous = runs[runs.length - 1];
    if (!previous || start - previous.maxProjection > tolerance) {
      runs.push({ entries: [entry], minProjection: start, maxProjection: end });
      return;
    }
    previous.entries.push(entry);
    previous.minProjection = Math.min(previous.minProjection, start);
    previous.maxProjection = Math.max(previous.maxProjection, end);
  });
  return runs;
}

function pointKey(value, tolerance) {
  return `${roundKey(value.x, tolerance)}:${roundKey(value.y, tolerance)}`;
}

function pointOrder(first, second, tolerance) {
  const firstX = roundKey(first.x, tolerance);
  const secondX = roundKey(second.x, tolerance);
  if (firstX !== secondX) return firstX - secondX;
  return roundKey(first.y, tolerance) - roundKey(second.y, tolerance);
}

function polygonArea(edges) {
  return edges.reduce((area, edge) => area + cross(edge.start, edge.end), 0) / 2;
}

function orientSpaceEdges(space, wallsById, tolerance) {
  const sourceWalls = (space.wallIds || []).map((wallId) => wallsById.get(wallId)).filter(Boolean);
  if (sourceWalls.length < 3) return [];
  const buildVariant = (reverseFirst) => {
    const edges = [];
    let currentEnd = null;
    for (let index = 0; index < sourceWalls.length; index += 1) {
      const wall = sourceWalls[index];
      let start = index === 0 && reverseFirst ? wall.end : wall.start;
      let end = index === 0 && reverseFirst ? wall.start : wall.end;
      if (index > 0 && currentEnd) {
        if (distance(currentEnd, end) < distance(currentEnd, start)) {
          start = wall.end;
          end = wall.start;
        }
        if (distance(currentEnd, start) > tolerance * 2) return [];
      }
      edges.push({ wall, start, end });
      currentEnd = end;
    }
    return distance(edges[0].start, edges[edges.length - 1].end) <= tolerance * 2 ? edges : [];
  };
  const forwardEdges = buildVariant(false);
  const edges = forwardEdges.length ? forwardEdges : buildVariant(true);
  if (edges.length < 3) return [];
  if (polygonArea(edges) >= 0) return edges;
  return edges.slice().reverse().map((edge) => ({ wall: edge.wall, start: edge.end, end: edge.start }));
}

function parameterOnEdge(edge, candidate, tolerance) {
  const vector = subtract(edge.end, edge.start);
  const lengthSquared = dot(vector, vector);
  if (!lengthSquared) return null;
  const relative = subtract(candidate, edge.start);
  if (Math.abs(cross(vector, relative)) > tolerance * Math.sqrt(lengthSquared)) return null;
  const parameter = dot(relative, vector) / lengthSquared;
  return parameter >= -0.000001 && parameter <= 1.000001 ? clamp(parameter, 0, 1) : null;
}

function sourceOffset(wall, value) {
  const vector = subtract(wall.end, wall.start);
  const geometricLength = magnitude(vector);
  const coordinateLength = Math.max(0.0001, Number(wall.coordinateLength || geometricLength));
  if (!geometricLength) return 0;
  return dot(subtract(value, wall.start), scale(vector, 1 / geometricLength)) / geometricLength * coordinateLength;
}

/**
 * Merges ordered closed-space edges into the building's outer rings.
 * Coincident shared edges cancel even when adjacent spaces use different wall
 * ids or split the same physical edge into different lengths. Negative rings
 * are enclosed holes and are intentionally excluded from dimensions.
 */
function createExteriorBoundarySegments(input) {
  const options = input || {};
  const tolerance = Math.max(0.5, Number(options.tolerance || options.groupTolerance || 1));
  const wallsById = new Map((options.walls || []).filter((wall) => wall && wall.id && wall.start && wall.end).map((wall) => [wall.id, wall]));
  const spaceEdges = (options.spaces || [])
    .filter((space) => space && space.closed && Array.isArray(space.wallIds))
    .flatMap((space) => orientSpaceEdges(space, wallsById, tolerance));
  if (!spaceEdges.length) return [];

  const atoms = [];
  spaceEdges.forEach((edge, edgeIndex) => {
    const parameters = [0, 1];
    spaceEdges.forEach((candidate) => {
      [candidate.start, candidate.end].forEach((candidatePoint) => {
        const parameter = parameterOnEdge(edge, candidatePoint, tolerance);
        if (parameter !== null) parameters.push(parameter);
      });
    });
    const ordered = Array.from(new Set(parameters.map((value) => Math.round(value * 1000000) / 1000000))).sort((first, second) => first - second);
    const vector = subtract(edge.end, edge.start);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const startParameter = ordered[index];
      const endParameter = ordered[index + 1];
      if (endParameter - startParameter <= 0.000001) continue;
      const start = add(edge.start, scale(vector, startParameter));
      const end = add(edge.start, scale(vector, endParameter));
      if (distance(start, end) <= tolerance * 0.25) continue;
      atoms.push({
        id: `boundary-atom-${edgeIndex}-${index}`,
        wall: edge.wall,
        start,
        end,
        startKey: pointKey(start, tolerance),
        endKey: pointKey(end, tolerance)
      });
    }
  });

  const buckets = new Map();
  atoms.forEach((atom) => {
    const forward = pointOrder(atom.start, atom.end, tolerance) <= 0;
    const key = forward ? `${atom.startKey}|${atom.endKey}` : `${atom.endKey}|${atom.startKey}`;
    const bucket = buckets.get(key) || { balance: 0, forward: [], reverse: [] };
    bucket.balance += forward ? 1 : -1;
    bucket[forward ? 'forward' : 'reverse'].push(atom);
    buckets.set(key, bucket);
  });

  const boundaryAtoms = [];
  buckets.forEach((bucket) => {
    if (!bucket.balance) return;
    const entries = bucket.balance > 0 ? bucket.forward : bucket.reverse;
    if (entries.length) boundaryAtoms.push(entries[0]);
  });

  const outgoing = new Map();
  boundaryAtoms.forEach((atom) => {
    const list = outgoing.get(atom.startKey) || [];
    list.push(atom);
    outgoing.set(atom.startKey, list);
  });
  const unused = new Set(boundaryAtoms.map((atom) => atom.id));
  const outerAtoms = [];

  boundaryAtoms.forEach((firstAtom) => {
    if (!unused.has(firstAtom.id)) return;
    const ring = [];
    let current = firstAtom;
    while (current && unused.has(current.id)) {
      ring.push(current);
      unused.delete(current.id);
      if (current.endKey === firstAtom.startKey) break;
      const candidates = (outgoing.get(current.endKey) || []).filter((atom) => unused.has(atom.id));
      current = candidates.length ? candidates[0] : null;
    }
    if (!ring.length || ring[ring.length - 1].endKey !== firstAtom.startKey) return;
    if (polygonArea(ring) > tolerance * tolerance) outerAtoms.push(...ring);
  });

  return outerAtoms.map((atom, index) => {
    const wall = atom.wall;
    const startOffset = sourceOffset(wall, atom.start);
    const endOffset = sourceOffset(wall, atom.end);
    const sourceCoordinateLength = Math.max(0.0001, Number(wall.coordinateLength || distance(wall.start, wall.end)));
    const measurementLength = Math.abs(endOffset - startOffset) / sourceCoordinateLength * Math.max(0, Number(wall.measurementLength || sourceCoordinateLength));
    return {
      id: `exterior:${wall.id}:${index}`,
      sourceWallId: wall.id,
      closed: true,
      isExteriorBoundary: true,
      start: atom.start,
      end: atom.end,
      sourceStart: startOffset,
      sourceEnd: endOffset,
      coordinateLength: distance(atom.start, atom.end),
      measurementLength,
      thickness: Math.max(0, Number(wall.thickness || 0)),
      outerStart: exteriorPoint(Object.assign({}, wall, wallFrame(wall)), atom.start),
      outerEnd: exteriorPoint(Object.assign({}, wall, wallFrame(wall)), atom.end),
      outsideSign: -1
    };
  });
}

/**
 * Returns a rendering-independent set of exterior dimensions.
 *
 * Input coordinates may be millimetres (admin SVG) or pixels (Mini Program
 * Canvas), as long as all fields in a single call use the same coordinate unit.
 */
function createExteriorDimensionPlan(input) {
  const options = input || {};
  const baseGap = Math.max(0, Number(options.baseGap || 0));
  const laneGap = Math.max(1, Number(options.laneGap || 1));
  const tolerance = Math.max(0.5, Number(options.groupTolerance || 1));
  const sourceWalls = (options.walls || [])
    .filter((wall) => wall && wall.closed && wall.isExteriorBoundary && wall.start && wall.end)
    .map((wall) => Object.assign({}, wall, wallFrame(wall)));
  const doorOpeningsByWall = new Map();
  (options.openings || []).forEach((opening) => {
    if (!opening || opening.type !== 'door' || !opening.wallId) return;
    const entries = doorOpeningsByWall.get(opening.wallId) || [];
    entries.push(opening);
    doorOpeningsByWall.set(opening.wallId, entries);
  });
  const lineGroups = new Map();
  sourceWalls.forEach((wall) => {
    const normalSign = dot(wall.outward, wall.canonicalNormal) >= 0 ? 1 : -1;
    const key = [
      roundKey(wall.canonicalDirection.x, 0.001),
      roundKey(wall.canonicalDirection.y, 0.001),
      roundKey(wall.lineProjection, tolerance),
      normalSign
    ].join(':');
    const list = lineGroups.get(key) || [];
    list.push(wall);
    lineGroups.set(key, list);
  });

  const items = [];
  let runIndex = 0;
  const exteriorPoints = sourceWalls.flatMap((wall) => [
    { wall, sourcePoint: wall.start, point: exteriorPoint(wall, wall.start) },
    { wall, sourcePoint: wall.end, point: exteriorPoint(wall, wall.end) }
  ]);
  const normalGroups = new Map();
  sourceWalls.forEach((wall) => {
    const key = normalKey(wall.outward);
    if (!normalGroups.has(key)) {
      normalGroups.set(key, {
        key,
        normal: wall.outward,
        direction: wall.canonicalDirection
      });
    }
  });
  const nextLaneByNormal = new Map();
  lineGroups.forEach((walls) => {
    splitContinuousRuns(walls, tolerance).forEach((run) => {
      runIndex += 1;
      const groupId = `dimension-run-${runIndex}`;
      const normal = run.entries[0].outward;
      const maxThickness = Math.max(...run.entries.map((wall) => Math.max(0, Number(wall.thickness || 0))));
      const support = Math.max(...exteriorPoints.map((entry) => dot(entry.point, normal)));
      const laneKey = normalKey(normal);
      const detailLane = nextLaneByNormal.get(laneKey) || 0;
      const hasDoorPositioning = run.entries.some((wall) => getDoorOpeningsForWall(wall, doorOpeningsByWall).length);
      const hasPositioningChain = run.entries.length > 1 || hasDoorPositioning;
      const detailGap = baseGap + laneGap * detailLane;
      const createExteriorDimension = (config) => createDimensionItem(Object.assign({
        groupId,
        normal,
        lane: config.lane,
        distance: maxThickness + config.gap,
        dimensionStart: dimensionLinePoint(config.startWall, config.start, normal, support, config.gap),
        dimensionEnd: dimensionLinePoint(config.endWall, config.end, normal, support, config.gap),
        extensionStart: exteriorPoint(config.startWall, config.start),
        extensionEnd: exteriorPoint(config.endWall, config.end)
      }, config));

      if (hasPositioningChain) {
        run.entries.forEach((wall) => {
          const coordinateLength = Math.max(0.0001, Number(wall.coordinateLength || magnitude(subtract(wall.end, wall.start))));
          const measurementLength = Math.max(0, Number(wall.measurementLength || coordinateLength));
          const openings = getDoorOpeningsForWall(wall, doorOpeningsByWall);
          const segments = [];
          let cursor = 0;
          if (openings.length) {
            openings.forEach((opening) => {
              segments.push([cursor, opening.start], [opening.start, opening.end]);
              cursor = opening.end;
            });
            segments.push([cursor, coordinateLength]);
          } else {
            segments.push([0, coordinateLength]);
          }
          segments.forEach(([startOffset, endOffset], index) => {
            const safeStart = clamp(Number(startOffset || 0), 0, coordinateLength);
            const safeEnd = clamp(Number(endOffset || 0), safeStart, coordinateLength);
            if (safeEnd - safeStart < 0.5) return;
            const segmentStart = add(wall.start, scale(wall.direction, safeStart));
            const segmentEnd = add(wall.start, scale(wall.direction, safeEnd));
            items.push(createExteriorDimension({
              id: `${groupId}:${wall.id}:position-${index}`,
              kind: openings.length ? 'opening-segment' : 'chain-segment',
              wallId: wall.id,
              sourceWallId: wall.sourceWallId || wall.id,
              label: (safeEnd - safeStart) / coordinateLength * measurementLength,
              lane: detailLane,
              gap: detailGap,
              startWall: wall,
              endWall: wall,
              start: segmentStart,
              end: segmentEnd
            }));
          });
        });
        nextLaneByNormal.set(laneKey, detailLane + 1);
      }
    });
  });

  normalGroups.forEach(({ key, normal, direction }) => {
    const entries = exteriorPoints.slice().sort((first, second) => (
      dot(first.sourcePoint, direction) - dot(second.sourcePoint, direction)
    ));
    if (entries.length < 2) return;
    const startEntry = entries[0];
    const endEntry = entries[entries.length - 1];
    const coordinateLength = Math.max(0, dot(endEntry.sourcePoint, direction) - dot(startEntry.sourcePoint, direction));
    if (!coordinateLength) return;
    const parallelWalls = sourceWalls.filter((wall) => Math.abs(Math.abs(dot(wall.direction, direction)) - 1) < 0.001);
    const measurementScale = parallelWalls.length
      ? parallelWalls.reduce((sum, wall) => {
        const wallLength = Math.max(0.0001, Number(wall.coordinateLength || magnitude(subtract(wall.end, wall.start))));
        return sum + Math.max(0, Number(wall.measurementLength || wallLength)) / wallLength;
      }, 0) / parallelWalls.length
      : 1;
    const lane = nextLaneByNormal.get(key) || 0;
    const gap = baseGap + laneGap * lane;
    const support = Math.max(...exteriorPoints.map((entry) => dot(entry.point, normal)));
    const thickness = Math.max(...sourceWalls.map((wall) => Math.max(0, Number(wall.thickness || 0))));
    const dimensionPoint = (entry) => add(entry.point, scale(normal, Math.max(0, support - dot(entry.point, normal)) + gap));

    items.push(createDimensionItem({
      id: `dimension-overall:${key}`,
      kind: 'chain-total',
      groupId: `dimension-overall:${key}`,
      sourceWallId: startEntry.wall.sourceWallId || startEntry.wall.id,
      label: coordinateLength * measurementScale,
      lane,
      start: startEntry.point,
      end: endEntry.point,
      dimensionStart: dimensionPoint(startEntry),
      dimensionEnd: dimensionPoint(endEntry),
      extensionStart: startEntry.point,
      extensionEnd: endEntry.point,
      normal,
      distance: thickness + gap
    }));
  });

  return { items };
}

module.exports = {
  createExteriorBoundarySegments,
  createExteriorDimensionPlan
};
