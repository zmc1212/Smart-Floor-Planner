/*
 * Formal survey drawing dimensions.
 *
 * This module is deliberately dependency-free so the Mini Program Canvas,
 * the Admin read-only canvas viewer, and DXF export share one annotation plan.
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
    sourceSpaceId: opts.sourceSpaceId || '',
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

function polygonCentroid(edges) {
  const twiceArea = edges.reduce((sum, edge) => sum + cross(edge.start, edge.end), 0);
  if (Math.abs(twiceArea) < 0.000001) {
    const points = edges.map((edge) => edge.start);
    return points.length
      ? scale(points.reduce((sum, value) => add(sum, value), point(0, 0)), 1 / points.length)
      : point(0, 0);
  }
  const weighted = edges.reduce((sum, edge) => {
    const weight = cross(edge.start, edge.end);
    return add(sum, scale(add(edge.start, edge.end), weight));
  }, point(0, 0));
  return scale(weighted, 1 / (3 * twiceArea));
}

function createOrthogonalFrame(wall, tolerance) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const frame = wallFrame(wall);
  if (Math.abs(dy) <= tolerance) {
    return {
      direction: point(1, 0),
      lineNormal: point(0, 1),
      outward: point(0, frame.outward.y < 0 ? -1 : 1)
    };
  }
  if (Math.abs(dx) <= tolerance) {
    return {
      direction: point(0, 1),
      lineNormal: point(-1, 0),
      outward: point(frame.outward.x < 0 ? -1 : 1, 0)
    };
  }
  return null;
}

function resolveMeasurementUnitScale(options, walls) {
  const explicit = Number(options && options.measurementUnitsPerCoordinate);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const ratios = (walls || []).flatMap((wall) => {
    const coordinateLength = Number(wall.coordinateLength || distance(wall.start, wall.end));
    const measurementLength = Number(wall.measurementLength || 0);
    return coordinateLength > 0 && measurementLength > 0
      ? [measurementLength / coordinateLength]
      : [];
  }).sort((first, second) => first - second);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
}

function intersectInfiniteLines(firstStart, firstEnd, secondStart, secondEnd) {
  const firstVector = subtract(firstEnd, firstStart);
  const secondVector = subtract(secondEnd, secondStart);
  const denominator = cross(firstVector, secondVector);
  if (Math.abs(denominator) < 0.000001) return null;
  const amount = cross(subtract(secondStart, firstStart), secondVector) / denominator;
  return add(firstStart, scale(firstVector, amount));
}

function createSpaceInnerFaceMap(walls, spaces, tolerance) {
  const wallsById = new Map((walls || []).map((wall) => [wall.id, wall]));
  const faces = new Map();

  (spaces || []).filter((space) => space && space.closed).forEach((space) => {
    const edges = orientSpaceEdges(space, wallsById, tolerance);
    if (edges.length < 3) return;
    const centroid = polygonCentroid(edges);
    const selectedFaces = edges.map((edge) => {
      const wall = edge.wall;
      const frameWall = Object.assign({}, wall, wallFrame(wall));
      const topologyStart = wall.start;
      const topologyEnd = wall.end;
      const oppositeStart = exteriorPoint(frameWall, topologyStart);
      const oppositeEnd = exteriorPoint(frameWall, topologyEnd);
      const topologyMidpoint = scale(add(topologyStart, topologyEnd), 0.5);
      const oppositeMidpoint = scale(add(oppositeStart, oppositeEnd), 0.5);
      const usesOppositeFace = distance(centroid, oppositeMidpoint) < distance(centroid, topologyMidpoint);
      const innerStart = usesOppositeFace ? oppositeStart : topologyStart;
      const innerEnd = usesOppositeFace ? oppositeEnd : topologyEnd;
      const reversed = distance(edge.start, wall.end) < distance(edge.start, wall.start);
      return {
        edge,
        wall,
        reversed,
        lineStart: reversed ? innerEnd : innerStart,
        lineEnd: reversed ? innerStart : innerEnd
      };
    });
    const corners = selectedFaces.map((current, index) => {
      const previous = selectedFaces[(index - 1 + selectedFaces.length) % selectedFaces.length];
      const intersection = intersectInfiniteLines(
        previous.lineStart,
        previous.lineEnd,
        current.lineStart,
        current.lineEnd
      );
      if (!intersection) return current.lineStart;
      const cornerLimit = Math.max(
        Number(previous.wall.thickness || 0),
        Number(current.wall.thickness || 0),
        tolerance
      ) * 4;
      return distance(intersection, current.lineStart) <= cornerLimit
        ? intersection
        : current.lineStart;
    });

    selectedFaces.forEach((entry, index) => {
      const orientedStart = corners[index];
      const orientedEnd = corners[(index + 1) % corners.length];
      faces.set(`${space.id}:${entry.wall.id}`, {
        spaceId: space.id,
        wallId: entry.wall.id,
        wall: entry.wall,
        innerStart: entry.reversed ? orientedEnd : orientedStart,
        innerEnd: entry.reversed ? orientedStart : orientedEnd
      });
    });
  });

  return faces;
}

function mergeRoomClearRuns(candidates, tolerance) {
  const groups = new Map();
  candidates.forEach((candidate) => {
    const key = [
      candidate.sourceSpaceId,
      normalKey(candidate.normal),
      roundKey(candidate.lineProjection, tolerance)
    ].join(':');
    const entries = groups.get(key) || [];
    entries.push(candidate);
    groups.set(key, entries);
  });

  const merged = [];
  groups.forEach((entries, groupKey) => {
    const groupRuns = [];
    entries.sort((first, second) => first.minProjection - second.minProjection);
    entries.forEach((entry) => {
      const previous = groupRuns[groupRuns.length - 1];
      if (previous && entry.minProjection - previous.maxProjection <= tolerance) {
        previous.maxProjection = Math.max(previous.maxProjection, entry.maxProjection);
        previous.labelLength += entry.labelLength;
        previous.sourceWallIds.push(entry.sourceWallId);
        return;
      }
      groupRuns.push(Object.assign({}, entry, {
        groupKey,
        sourceWallIds: [entry.sourceWallId]
      }));
    });
    merged.push(...groupRuns);
  });
  return merged;
}

function createRingEdges(ring) {
  return (ring || []).map((start, index) => ({
    start,
    end: ring[(index + 1) % ring.length]
  })).filter((edge) => distance(edge.start, edge.end) > 0.000001);
}

function createOuterRingSegments(rings, tolerance) {
  return (rings || []).flatMap((ring, ringIndex) => {
    const edges = createRingEdges(ring);
    if (edges.length < 3 || polygonArea(edges) <= tolerance * tolerance) return [];
    return edges.map((edge, edgeIndex) => Object.assign(edge, {
      id: `outer-ring:${ringIndex}:${edgeIndex}`,
      outsideSign: -1
    }));
  });
}

function createRoomCandidatesFromPlans(spacePlans, outerSegments, maxExteriorGap, tolerance) {
  const candidates = [];
  (spacePlans || []).forEach((spacePlan) => {
    const segments = Array.isArray(spacePlan.innerSegments)
      ? spacePlan.innerSegments
      : createRingEdges(spacePlan.innerBoundaryPoints || []);
    const boundaryPoints = spacePlan.innerBoundaryPoints || segments.map((segment) => segment.start);
    const boundaryEdges = createRingEdges(boundaryPoints);
    if (!segments.length || boundaryEdges.length < 3) return;
    const winding = polygonArea(boundaryEdges) >= 0 ? 1 : -1;

    segments.forEach((segment) => {
      const dx = segment.end.x - segment.start.x;
      const dy = segment.end.y - segment.start.y;
      const segmentDirection = normalize(subtract(segment.end, segment.start));
      const outward = winding > 0
        ? point(segmentDirection.y, -segmentDirection.x)
        : point(-segmentDirection.y, segmentDirection.x);
      let direction;
      let lineNormal;
      if (Math.abs(dy) <= tolerance) {
        direction = point(1, 0);
        lineNormal = point(0, 1);
      } else if (Math.abs(dx) <= tolerance) {
        direction = point(0, 1);
        lineNormal = point(-1, 0);
      } else {
        return;
      }
      const midpoint = scale(add(segment.start, segment.end), 0.5);
      const normal = dot(outward, lineNormal) >= 0 ? lineNormal : scale(lineNormal, -1);
      const minProjection = Math.min(dot(segment.start, direction), dot(segment.end, direction));
      const maxProjection = Math.max(dot(segment.start, direction), dot(segment.end, direction));

      const exposed = outerSegments.some((outerSegment) => {
        const outerFrame = createOrthogonalFrame(outerSegment, tolerance);
        if (!outerFrame || normalKey(outerFrame.outward) !== normalKey(normal)) return false;
        const outerMin = Math.min(dot(outerSegment.start, direction), dot(outerSegment.end, direction));
        const outerMax = Math.max(dot(outerSegment.start, direction), dot(outerSegment.end, direction));
        const overlap = Math.min(maxProjection, outerMax) - Math.max(minProjection, outerMin);
        if (overlap <= tolerance * 0.25) return false;
        const outerMidpoint = scale(add(outerSegment.start, outerSegment.end), 0.5);
        const outwardDistance = dot(subtract(outerMidpoint, midpoint), normal);
        return outwardDistance >= -tolerance && outwardDistance <= maxExteriorGap;
      });
      if (!exposed) return;

      candidates.push({
        sourceSpaceId: spacePlan.spaceId || '',
        sourceWallId: segment.wallId || '',
        normal,
        direction,
        lineNormal,
        lineProjection: dot(midpoint, lineNormal),
        minProjection,
        maxProjection,
        labelLength: Math.max(
          0,
          maxProjection - minProjection -
          Number(segment.measurementStartInsetMm || 0) -
          Number(segment.measurementEndInsetMm || 0) +
          Number(segment.measurementStartExtensionMm || 0)
        )
      });
    });
  });
  return candidates;
}

function createRoomPlansFromFaces(walls, spaces, faceMap, tolerance) {
  const wallsById = new Map((walls || []).map((wall) => [wall.id, wall]));
  return (spaces || []).flatMap((space) => {
    const edges = orientSpaceEdges(space, wallsById, tolerance);
    if (edges.length < 3) return [];
    const innerSegments = edges.flatMap((edge) => {
      const face = faceMap.get(`${space.id}:${edge.wall.id}`);
      if (!face) return [];
      const reversed = distance(edge.start, edge.wall.end) < distance(edge.start, edge.wall.start);
      return [{
        wallId: edge.wall.id,
        start: reversed ? face.innerEnd : face.innerStart,
        end: reversed ? face.innerStart : face.innerEnd
      }];
    });
    if (innerSegments.length !== edges.length) return [];
    return [{
      spaceId: space.id,
      innerBoundaryPoints: innerSegments.map((segment) => segment.start),
      innerSegments
    }];
  });
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

function extraClearanceSupport(points, normal) {
  if (!points || !points.length) return Number.NEGATIVE_INFINITY;
  return Math.max(...points.map((value) => dot(value, normal)));
}

function overlappingOutlineSupport(outlineSegments, normal, direction, minProjection, maxProjection, tolerance, fallbackPoints) {
  const innerSupport = fallbackPoints && fallbackPoints.length
    ? Math.max(...fallbackPoints.map((value) => dot(value, normal)))
    : Number.NEGATIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  outlineSegments.forEach((segment) => {
    const frame = createOrthogonalFrame(segment, tolerance);
    if (!frame || normalKey(frame.outward) !== normalKey(normal)) return;
    const segmentMin = Math.min(dot(segment.start, direction), dot(segment.end, direction));
    const segmentMax = Math.max(dot(segment.start, direction), dot(segment.end, direction));
    if (Math.min(maxProjection, segmentMax) - Math.max(minProjection, segmentMin) <= tolerance * 0.25) return;
    const segmentSupport = Math.max(dot(segment.start, normal), dot(segment.end, normal));
    if (segmentSupport + tolerance < innerSupport) return;
    nearest = Math.min(nearest, segmentSupport);
  });
  return nearest === Number.POSITIVE_INFINITY ? Number.NEGATIVE_INFINITY : nearest;
}

function dimensionPointAtSupport(value, normal, support, gap) {
  return add(value, scale(normal, Math.max(0, support - dot(value, normal)) + gap));
}

/**
 * Builds the two semantic dimension bands used after orthogonal spaces close:
 * room clear spans nearest the building, then the physical building bounds.
 * Diagonal outlines intentionally retain the legacy exterior planner.
 */
function createClosedDimensionPlan(input) {
  const options = input || {};
  const baseGap = Math.max(0, Number(options.baseGap || 0));
  const laneGap = Math.max(1, Number(options.laneGap || 1));
  const tolerance = Math.max(0.5, Number(options.groupTolerance || options.tolerance || 1));
  const walls = (options.walls || []).filter((wall) => wall && wall.id && wall.start && wall.end);
  const spaces = (options.spaces || []).filter((space) => space && space.closed && Array.isArray(space.wallIds));
  const exteriorWalls = createExteriorBoundarySegments({ walls, spaces, tolerance });
  const outerRingSegments = createOuterRingSegments(options.outerRings || [], tolerance);
  const outlineSegments = outerRingSegments.length ? outerRingSegments : exteriorWalls;
  const openings = options.openings || [];

  if (!outlineSegments.length) return { items: [], exteriorWalls, fallback: false };
  // The orthogonal planner also consumes physical exterior walls for door
  // dimensions. A derived outer ring can stay orthogonal while a remeasured
  // wall becomes diagonal, so validate both inputs before reading frames.
  if (outlineSegments.concat(exteriorWalls).some((wall) => !createOrthogonalFrame(wall, tolerance))) {
    const fallbackPlan = createExteriorDimensionPlan({
      baseGap,
      laneGap,
      groupTolerance: tolerance,
      walls: exteriorWalls,
      openings
    });
    return { items: fallbackPlan.items, exteriorWalls, fallback: true };
  }

  const measurementScale = resolveMeasurementUnitScale(options, walls);
  const faceMap = createSpaceInnerFaceMap(walls, spaces, tolerance);
  const exteriorPoints = outerRingSegments.length
    ? outerRingSegments.flatMap((wall) => [wall.start, wall.end])
    : exteriorWalls.flatMap((wall) => [wall.outerStart, wall.outerEnd]);
  // A closed room remains the source of its permanent dimensions while other
  // walls are still on the canvas. Annotations sit outside those unclosed wall
  // bodies (and a stationary preview) rather than underneath them. An in-flight
  // drag preview is omitted by the renderer until the length is committed.
  const extraClearancePoints = (options.clearancePoints || [])
    .filter((value) => value && Number.isFinite(value.x) && Number.isFinite(value.y));
  const extraClearanceFor = (normal) => extraClearanceSupport(extraClearancePoints, normal);
  const supportFor = (normal) => Math.max(
    extraClearanceFor(normal),
    ...exteriorPoints.map((value) => dot(value, normal))
  );
  const localSupportFor = (normal, direction, minProjection, maxProjection, fallbackPoints) => {
    const outlineSupport = overlappingOutlineSupport(
      outlineSegments,
      normal,
      direction,
      minProjection,
      maxProjection,
      tolerance,
      fallbackPoints
    );
    const fallbackSupport = fallbackPoints && fallbackPoints.length
      ? Math.max(...fallbackPoints.map((value) => dot(value, normal)))
      : Number.NEGATIVE_INFINITY;
    return Math.max(outlineSupport, fallbackSupport, extraClearanceFor(normal));
  };
  const sideGroups = new Map();

  outlineSegments.forEach((wall) => {
    const frame = createOrthogonalFrame(wall, tolerance);
    const sideKey = normalKey(frame.outward);
    if (!sideGroups.has(sideKey)) {
      sideGroups.set(sideKey, {
        key: sideKey,
        normal: frame.outward,
        direction: frame.direction,
        lineNormal: frame.lineNormal,
        walls: []
      });
    }
    sideGroups.get(sideKey).walls.push(wall);
  });

  const maxWallThickness = Math.max(0, ...walls.map((wall) => Number(wall.thickness || 0)));
  const plannedRoomCandidates = createRoomCandidatesFromPlans(
    options.spacePlans || [],
    outlineSegments,
    maxWallThickness * 2 + tolerance * 4,
    tolerance
  );
  const derivedRoomCandidates = createRoomCandidatesFromPlans(
    createRoomPlansFromFaces(walls, spaces, faceMap, tolerance),
    outlineSegments,
    maxWallThickness * 2 + tolerance * 4,
    tolerance
  );
  const roomCandidates = plannedRoomCandidates.length
    ? plannedRoomCandidates
    : derivedRoomCandidates;

  const doorOpeningsByWall = new Map();
  openings.forEach((opening) => {
    if (!opening || opening.type !== 'door' || !opening.wallId) return;
    const entries = doorOpeningsByWall.get(opening.wallId) || [];
    entries.push(opening);
    doorOpeningsByWall.set(opening.wallId, entries);
  });
  const sidesWithDoorDimensions = new Set();
  exteriorWalls.forEach((wall) => {
    if (!getDoorOpeningsForWall(wall, doorOpeningsByWall).length) return;
    const frame = createOrthogonalFrame(wall, tolerance);
    sidesWithDoorDimensions.add(normalKey(frame.outward));
  });

  const items = [];
  exteriorWalls.forEach((wall) => {
    const doorOpenings = getDoorOpeningsForWall(wall, doorOpeningsByWall);
    if (!doorOpenings.length) return;
    const frame = createOrthogonalFrame(wall, tolerance);
    const coordinateLength = Math.max(0.0001, Number(wall.coordinateLength || distance(wall.start, wall.end)));
    const measurementLength = Math.max(0, Number(wall.measurementLength || coordinateLength * measurementScale));
    const wallDirection = wallFrame(wall).direction;
    const wallMin = Math.min(dot(wall.start, frame.direction), dot(wall.end, frame.direction));
    const wallMax = Math.max(dot(wall.start, frame.direction), dot(wall.end, frame.direction));
    const support = localSupportFor(frame.outward, frame.direction, wallMin, wallMax, [wall.outerStart, wall.outerEnd]);
    const segments = [];
    let cursor = 0;
    doorOpenings.forEach((opening) => {
      segments.push([cursor, opening.start], [opening.start, opening.end]);
      cursor = opening.end;
    });
    segments.push([cursor, coordinateLength]);

    segments.forEach(([startOffset, endOffset], index) => {
      const safeStart = clamp(Number(startOffset || 0), 0, coordinateLength);
      const safeEnd = clamp(Number(endOffset || 0), safeStart, coordinateLength);
      if (safeEnd - safeStart < 0.5) return;
      const topologyStart = add(wall.start, scale(wallDirection, safeStart));
      const topologyEnd = add(wall.start, scale(wallDirection, safeEnd));
      const outerStart = exteriorPoint(Object.assign({}, wall, wallFrame(wall)), topologyStart);
      const outerEnd = exteriorPoint(Object.assign({}, wall, wallFrame(wall)), topologyEnd);
      const dimensionPoint = (value) => dimensionPointAtSupport(value, frame.outward, support, baseGap);
      items.push(createDimensionItem({
        id: `dimension-opening:${wall.sourceWallId}:${index}`,
        kind: 'opening-segment',
        groupId: `dimension-opening:${wall.sourceWallId}`,
        wallId: wall.id,
        sourceWallId: wall.sourceWallId,
        label: (safeEnd - safeStart) / coordinateLength * measurementLength,
        lane: 0,
        start: topologyStart,
        end: topologyEnd,
        dimensionStart: dimensionPoint(outerStart),
        dimensionEnd: dimensionPoint(outerEnd),
        extensionStart: outerStart,
        extensionEnd: outerEnd,
        normal: frame.outward,
        distance: baseGap
      }));
    });
  });

  const mergedRooms = mergeRoomClearRuns(roomCandidates, tolerance);
  const sidesWithRoomDimensions = new Set();
  mergedRooms.forEach((run, index) => {
    if (run.maxProjection - run.minProjection <= tolerance * 0.25) return;
    const sideKey = normalKey(run.normal);
    const lane = sidesWithDoorDimensions.has(sideKey) ? 1 : 0;
    const extensionStart = add(
      scale(run.direction, run.minProjection),
      scale(run.lineNormal, run.lineProjection)
    );
    const extensionEnd = add(
      scale(run.direction, run.maxProjection),
      scale(run.lineNormal, run.lineProjection)
    );
    const support = localSupportFor(
      run.normal,
      run.direction,
      run.minProjection,
      run.maxProjection,
      [extensionStart, extensionEnd]
    );
    const gap = baseGap + laneGap * lane;
    const dimensionPoint = (value) => dimensionPointAtSupport(value, run.normal, support, gap);
    items.push(createDimensionItem({
      id: `dimension-room:${run.sourceSpaceId}:${sideKey}:${index}`,
      kind: 'room-clear',
      groupId: `dimension-room:${run.sourceSpaceId}:${sideKey}`,
      sourceSpaceId: run.sourceSpaceId,
      sourceWallId: run.sourceWallIds[0] || '',
      label: run.labelLength * measurementScale,
      lane,
      start: extensionStart,
      end: extensionEnd,
      dimensionStart: dimensionPoint(extensionStart),
      dimensionEnd: dimensionPoint(extensionEnd),
      extensionStart,
      extensionEnd,
      normal: run.normal,
      distance: gap
    }));
    sidesWithRoomDimensions.add(sideKey);
  });

  const maxThickness = Math.max(80, maxWallThickness);
  sideGroups.forEach((side) => {
    const lineBuckets = new Map();
    side.walls.forEach((wall) => {
      const lineKey = roundKey(dot(wall.start, side.lineNormal), tolerance);
      const startProjection = dot(wall.start, side.direction);
      const endProjection = dot(wall.end, side.direction);
      const list = lineBuckets.get(lineKey) || [];
      list.push(Object.assign({}, wall, {
        startProjection: Math.min(startProjection, endProjection),
        endProjection: Math.max(startProjection, endProjection),
        lineProjection: dot(wall.start, side.lineNormal)
      }));
      lineBuckets.set(lineKey, list);
    });
    const roomsOnSide = mergedRooms.filter((run) => normalKey(run.normal) === side.key);
    const lane = sidesWithDoorDimensions.has(side.key) ? 1 : 0;
    const gap = baseGap + laneGap * lane;
    lineBuckets.forEach((bucket) => {
      splitContinuousRuns(bucket, tolerance).forEach((outlineRun, runIndex) => {
        const runMin = outlineRun.minProjection;
        const runMax = outlineRun.maxProjection;
        const lineProjection = outlineRun.entries[0].lineProjection;
        const runSupport = Math.max(
          extraClearanceFor(side.normal),
          ...outlineRun.entries.flatMap((wall) => [dot(wall.start, side.normal), dot(wall.end, side.normal)])
        );
        const covers = roomsOnSide
          .map((room) => ({
            min: Math.max(runMin, room.minProjection),
            max: Math.min(runMax, room.maxProjection)
          }))
          .filter((span) => span.max - span.min > tolerance * 0.25)
          .sort((first, second) => first.min - second.min);
        const cuts = [runMin];
        covers.forEach((span) => {
          if (span.min - cuts[cuts.length - 1] > tolerance) cuts.push(span.min);
          if (span.max - cuts[cuts.length - 1] > tolerance) cuts.push(span.max);
        });
        if (runMax - cuts[cuts.length - 1] > tolerance) cuts.push(runMax);
        for (let index = 0; index < cuts.length - 1; index += 1) {
          const startProjection = cuts[index];
          const endProjection = cuts[index + 1];
          const covered = covers.some((span) => (
            startProjection >= span.min - tolerance && endProjection <= span.max + tolerance
          ));
          if (covered) continue;
          const length = endProjection - startProjection;
          if (length < 50 || length > maxThickness + tolerance * 4) continue;
          const extensionStart = add(
            scale(side.direction, startProjection),
            scale(side.lineNormal, lineProjection)
          );
          const extensionEnd = add(
            scale(side.direction, endProjection),
            scale(side.lineNormal, lineProjection)
          );
          const dimensionPoint = (value) => dimensionPointAtSupport(value, side.normal, runSupport, gap);
          items.push(createDimensionItem({
            id: `dimension-thickness:${side.key}:${runIndex}:${index}`,
            kind: 'wall-thickness',
            groupId: `dimension-thickness:${side.key}`,
            label: length * measurementScale,
            lane,
            start: extensionStart,
            end: extensionEnd,
            dimensionStart: dimensionPoint(extensionStart),
            dimensionEnd: dimensionPoint(extensionEnd),
            extensionStart,
            extensionEnd,
            normal: side.normal,
            distance: gap
          }));
        }
      });
    });
  });

  sideGroups.forEach((side) => {
    const sidePoints = side.walls.flatMap((wall) => [wall.start, wall.end]);
    const orderedPoints = sidePoints.slice().sort((first, second) => (
      dot(first, side.direction) - dot(second, side.direction)
    ));
    const extensionStart = orderedPoints[0];
    const extensionEnd = orderedPoints[orderedPoints.length - 1];
    const minProjection = dot(extensionStart, side.direction);
    const maxProjection = dot(extensionEnd, side.direction);
    if (maxProjection - minProjection <= tolerance * 0.25) return;
    const support = supportFor(side.normal);
    const nearLane = sidesWithDoorDimensions.has(side.key) ? 1 : 0;
    const lane = nearLane + (sidesWithRoomDimensions.has(side.key) ? 1 : 0);
    const gap = baseGap + laneGap * lane;
    const dimensionPoint = (value) => add(value, scale(
      side.normal,
      Math.max(0, support - dot(value, side.normal)) + gap
    ));
    items.push(createDimensionItem({
      id: `dimension-building:${side.key}`,
      kind: 'building-overall',
      groupId: `dimension-building:${side.key}`,
      label: (maxProjection - minProjection) * measurementScale,
      lane,
      start: extensionStart,
      end: extensionEnd,
      dimensionStart: dimensionPoint(extensionStart),
      dimensionEnd: dimensionPoint(extensionEnd),
      extensionStart,
      extensionEnd,
      normal: side.normal,
      distance: gap
    }));
  });

  return { items, exteriorWalls, fallback: false };
}

module.exports = {
  createExteriorBoundarySegments,
  createExteriorDimensionPlan,
  createClosedDimensionPlan
};
