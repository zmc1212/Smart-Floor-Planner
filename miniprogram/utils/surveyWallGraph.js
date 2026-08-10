const DEFAULT_THICKNESS_MM = 200;
const DEFAULT_SCALE = 0.05;
const CLOSE_TOLERANCE_MM = 350;
const RECTANGLE_ALIGNMENT_TOLERANCE_MM = CLOSE_TOLERANCE_MM;
const DIAGONAL_DIRECTION_SNAP_TOLERANCE_DEG = 8;
const MIN_WALL_LENGTH_MM = 100;
const MIN_THICKNESS_MM = 50;
const WALL_OVERLAP_TOLERANCE_MM = 30;
const WALL_EXTENSION_DIRECTION_TOLERANCE_DEG = 0.2;
const MIN_CLOSED_SPACE_AREA_MM2 = MIN_WALL_LENGTH_MM * MIN_WALL_LENGTH_MM;
const DEFAULT_DOOR_WIDTH_MM = 900;
const DEFAULT_DOOR_HEIGHT_MM = 2100;
const DEFAULT_WINDOW_WIDTH_MM = 1500;
const DEFAULT_WINDOW_HEIGHT_MM = 1500;
const DEFAULT_WINDOW_SILL_HEIGHT_MM = 900;
const DEFAULT_OPENING_DEPTH_MM = DEFAULT_THICKNESS_MM;
const MIN_OPENING_SIZE_MM = 100;
const MAX_OPENING_WALL_RATIO = 0.6;

let idSeed = 1;

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix) {
  idSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`;
}

function cloneDraft(draft) {
  return JSON.parse(JSON.stringify(draft));
}

function createSession() {
  return {
    state: 'idle',
    anchorNodeId: '',
    previewPoint: null,
    previewAngleDeg: 0,
    previewLengthMm: 0,
    previewAngleSource: '',
    previewInteriorAngleDeg: null,
    mode: 'straight',
    thicknessMm: DEFAULT_THICKNESS_MM,
    measurementSide: 'left',
    pendingWallId: '',
    selectedWallId: '',
    selectedOpeningId: '',
    closeCandidateNodeId: '',
    closeCandidatePoint: null,
    closeCandidateType: '',
    closeCandidateSharedWallId: '',
    alignmentSnapGuide: null,
    activeSpaceStartNodeId: '',
    activeSpaceStartWallIndex: 0,
    activeSpaceSharedWallId: '',
    activeSpaceSharedStartT: null,
    activeSpaceSharedSnapLine: '',
    lastWallSnapNodeId: '',
    lastWallSnapWallId: '',
    lastWallSnapT: null,
    lastWallSnapLine: '',
    previewMeasurementSide: '',
    previewMeasurementStartInsetMm: 0,
    previewMeasurementEndInsetMm: 0
  };
}

function createSurveyDraft() {
  const timestamp = nowIso();
  return {
    schemaVersion: 1,
    kind: 'survey-wall-graph',
    status: 'draft',
    activeFloorId: 'floor-1',
    floors: [
      {
        id: 'floor-1',
        name: '1F',
        elevationMm: 0,
        nodes: [],
        walls: [],
        openings: [],
        spaces: [],
        session: createSession(),
        viewport: { scale: DEFAULT_SCALE, offsetX: 0, offsetY: 0 }
      }
    ],
    settings: {
      defaultThicknessMm: DEFAULT_THICKNESS_MM,
      orientationDeg: 0
    },
    source: 'surveying-editor',
    updatedAt: timestamp
  };
}

function getActiveFloor(draft) {
  return draft.floors.find((floor) => floor.id === draft.activeFloorId) || draft.floors[0];
}

function getNode(floor, nodeId) {
  return floor.nodes.find((node) => node.id === nodeId);
}

function getWall(floor, wallId) {
  return floor.walls.find((wall) => wall.id === wallId);
}

function ensureOpenings(floor) {
  if (!Array.isArray(floor.openings)) {
    floor.openings = [];
  }
  return floor.openings;
}

function getOpening(floor, openingId) {
  return ensureOpenings(floor).find((opening) => opening.id === openingId);
}

function ensureSessionSpaceTracking(floor) {
  const session = floor.session || createSession();
  floor.session = session;
  if (typeof session.activeSpaceStartNodeId !== 'string') {
    session.activeSpaceStartNodeId = '';
  }
  if (!Number.isInteger(session.activeSpaceStartWallIndex) || session.activeSpaceStartWallIndex < 0) {
    session.activeSpaceStartWallIndex = 0;
  }
  if (session.activeSpaceStartWallIndex > floor.walls.length) {
    session.activeSpaceStartWallIndex = floor.walls.length;
  }
  if (typeof session.activeSpaceSharedWallId !== 'string') {
    session.activeSpaceSharedWallId = '';
  }
  if (typeof session.activeSpaceSharedStartT !== 'number') {
    session.activeSpaceSharedStartT = null;
  }
  if (typeof session.activeSpaceSharedSnapLine !== 'string') {
    session.activeSpaceSharedSnapLine = '';
  }
  if (typeof session.lastWallSnapNodeId !== 'string') {
    session.lastWallSnapNodeId = '';
  }
  if (typeof session.lastWallSnapWallId !== 'string') {
    session.lastWallSnapWallId = '';
  }
  if (typeof session.lastWallSnapT !== 'number') {
    session.lastWallSnapT = null;
  }
  if (typeof session.lastWallSnapLine !== 'string') {
    session.lastWallSnapLine = '';
  }
  if (typeof session.previewMeasurementSide !== 'string') {
    session.previewMeasurementSide = '';
  }
  if (!Number.isFinite(Number(session.previewMeasurementStartInsetMm))) {
    session.previewMeasurementStartInsetMm = 0;
  }
  if (!Number.isFinite(Number(session.previewMeasurementEndInsetMm))) {
    session.previewMeasurementEndInsetMm = 0;
  }
  if (typeof session.previewAngleSource !== 'string') {
    session.previewAngleSource = '';
  }
  if (!Object.prototype.hasOwnProperty.call(session, 'previewInteriorAngleDeg')) {
    session.previewInteriorAngleDeg = null;
  }
  if (!Object.prototype.hasOwnProperty.call(session, 'closeCandidatePoint')) {
    session.closeCandidatePoint = null;
  }
  if (typeof session.closeCandidateType !== 'string') {
    session.closeCandidateType = '';
  }
  if (typeof session.closeCandidateSharedWallId !== 'string') {
    session.closeCandidateSharedWallId = '';
  }
  if (!Object.prototype.hasOwnProperty.call(session, 'alignmentSnapGuide')) {
    session.alignmentSnapGuide = null;
  }
  return session;
}

function distanceMm(a, b) {
  if (!a || !b) return 0;
  const dx = b.xMm - a.xMm;
  const dy = b.yMm - a.yMm;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

function angleDeg(a, b) {
  if (!a || !b) return 0;
  return normalizeAngle(Math.atan2(b.yMm - a.yMm, b.xMm - a.xMm) * 180 / Math.PI);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function pointLineDistanceMm(point, start, direction) {
  return Math.abs(cross({
    x: point.xMm - start.xMm,
    y: point.yMm - start.yMm
  }, direction));
}

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return Math.round(normalized * 10) / 10;
}

function findClosedSpaceForWall(floor, wallId) {
  if (!floor || !wallId || !Array.isArray(floor.spaces)) return null;
  return floor.spaces.find((space) => (
    space &&
    space.closed &&
    Array.isArray(space.wallIds) &&
    space.wallIds.indexOf(wallId) !== -1
  )) || null;
}

function normalizeMeasurementInset(value) {
  const parsed = Math.round(Number(value) || 0);
  return Math.max(0, parsed);
}

function getWallCoordinateLength(floor, wall) {
  if (!floor || !wall) return 0;
  return distanceMm(
    getNode(floor, wall.startNodeId),
    getNode(floor, wall.endNodeId)
  );
}

function getWallMeasurementInsets(wall) {
  return {
    start: normalizeMeasurementInset(wall && wall.measurementStartInsetMm),
    end: normalizeMeasurementInset(wall && wall.measurementEndInsetMm)
  };
}

function getMeasuredWallLength(floor, wall) {
  const coordinateLength = getWallCoordinateLength(floor, wall);
  const insets = getWallMeasurementInsets(wall);
  return Math.max(0, coordinateLength - insets.start - insets.end);
}

function calculateBoundaryCentroid(floor, wallIds) {
  const points = buildSpaceBoundaryPoints(floor, wallIds);
  if (!points || points.length < 3) return null;

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

function pointsNearlyEqual(a, b) {
  return distanceMm(a, b) <= 1;
}

function addVector(point, vector, amount) {
  return {
    xMm: point.xMm + vector.x * amount,
    yMm: point.yMm + vector.y * amount
  };
}

function resolveRenderThicknessMm(wall, options) {
  const opts = options || {};
  const thicknessMap = opts.renderThicknessMmMap || {};
  const mappedThickness = wall && wall.id ? thicknessMap[wall.id] : null;
  const explicitThickness = opts.renderThicknessMm;
  const resolved = mappedThickness || explicitThickness || (wall && wall.thicknessMm) || DEFAULT_THICKNESS_MM;
  return Math.max(MIN_THICKNESS_MM, resolved);
}

function traceClosedSpaceWallChain(floor, wallIds, reverseFirstWall) {
  if (!floor || !Array.isArray(wallIds) || wallIds.length < 3) return [];
  const firstWall = getWall(floor, wallIds[0]);
  if (!firstWall) return [];

  const initialNodeId = reverseFirstWall ? firstWall.endNodeId : firstWall.startNodeId;
  let currentNodeId = initialNodeId;
  const chain = [];

  for (let index = 0; index < wallIds.length; index += 1) {
    const wall = getWall(floor, wallIds[index]);
    if (!wall) return [];
    let nextNodeId = '';
    if (wall.startNodeId === currentNodeId) {
      nextNodeId = wall.endNodeId;
    } else if (wall.endNodeId === currentNodeId) {
      nextNodeId = wall.startNodeId;
    } else {
      return [];
    }
    const start = getNode(floor, currentNodeId);
    const end = getNode(floor, nextNodeId);
    if (!start || !end) return [];
    chain.push({ wall, start, end, reversed: wall.endNodeId === currentNodeId });
    currentNodeId = nextNodeId;
  }

  return currentNodeId === initialNodeId ? chain : [];
}

function buildClosedSpaceWallChain(floor, wallIds) {
  const forward = traceClosedSpaceWallChain(floor, wallIds, false);
  return forward.length ? forward : traceClosedSpaceWallChain(floor, wallIds, true);
}

function resolveAdjacentWalls(floor, wall, options) {
  const opts = options || {};
  const hasPrevious = Object.prototype.hasOwnProperty.call(opts, 'previousWall');
  const hasNext = Object.prototype.hasOwnProperty.call(opts, 'nextWall');
  const index = floor.walls.findIndex((item) => item.id === wall.id);
  const closedSpace = findClosedSpaceForWall(floor, wall.id);
  let startWall = null;
  let endWall = null;

  if (!hasPrevious && !hasNext && closedSpace) {
    const chain = buildClosedSpaceWallChain(floor, closedSpace.wallIds);
    const closedIndex = chain.findIndex((entry) => entry.wall.id === wall.id);
    if (closedIndex >= 0) {
      const entry = chain[closedIndex];
      const previousWall = chain[(closedIndex - 1 + chain.length) % chain.length].wall;
      const nextWall = chain[(closedIndex + 1) % chain.length].wall;
      return entry.reversed
        ? { startWall: nextWall, endWall: previousWall }
        : { startWall: previousWall, endWall: nextWall };
    }
  }

  if (hasPrevious) {
    startWall = opts.previousWall;
  } else if (index > 0) {
    startWall = floor.walls[index - 1];
  }

  if (hasNext) {
    endWall = opts.nextWall;
  } else if (index >= 0 && index < floor.walls.length - 1) {
    endWall = floor.walls[index + 1];
  }

  return { startWall, endWall };
}

function pointTouchesWallSegment(point, start, end) {
  if (!point || !start || !end) return false;
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return distanceMm(point, start) <= 1;
  const t = ((point.xMm - start.xMm) * dx + (point.yMm - start.yMm) * dy) / lengthSquared;
  if (t < -0.0001 || t > 1.0001) return false;
  const projected = { xMm: start.xMm + dx * t, yMm: start.yMm + dy * t };
  return distanceMm(point, projected) <= 1;
}

function hasWallConnectionAtPoint(floor, wall, point) {
  return (floor.walls || []).some((candidate) => {
    if (!candidate || candidate.id === wall.id) return false;
    const start = getNode(floor, candidate.startNodeId);
    const end = getNode(floor, candidate.endNodeId);
    return pointTouchesWallSegment(point, start, end);
  });
}

function buildBaseWallSegment(floor, wall, options) {
  const opts = options || {};
  const start = opts.startPoint || getNode(floor, wall.startNodeId);
  const end = opts.endPoint || getNode(floor, wall.endNodeId);
  if (!start || !end) return null;

  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const rawLength = Math.sqrt(dx * dx + dy * dy);
  if (!rawLength) return null;

  const direction = { x: dx / rawLength, y: dy / rawLength };
  const leftNormal = { x: direction.y, y: -direction.x };
  const rightNormal = { x: -direction.y, y: direction.x };
  const closedSpace = findClosedSpaceForWall(floor, wall.id);
  const centroid = closedSpace ? calculateBoundaryCentroid(floor, closedSpace.wallIds) : null;
  const midpoint = {
    xMm: (start.xMm + end.xMm) / 2,
    yMm: (start.yMm + end.yMm) / 2
  };
  const outward = centroid
    ? { x: midpoint.xMm - centroid.xMm, y: midpoint.yMm - centroid.yMm }
    : null;
  // Once a space is explicitly closed, its physical wall body must always
  // expand away from the room centroid. The first-wall measurement-side choice
  // controls the redline while measuring; it cannot invert a closed room shell.
  const normal = outward && dot(leftNormal, outward) >= dot(rightNormal, outward)
    ? leftNormal
    : (outward ? rightNormal : (wall.measurementSide === 'left' ? leftNormal : rightNormal));
  const thicknessMm = resolveRenderThicknessMm(wall, opts);

  return {
    wall,
    start,
    end,
    direction,
    normal,
    thicknessMm,
    lengthMm: distanceMm(start, end),
    outerStart: addVector(start, normal, thicknessMm),
    outerEnd: addVector(end, normal, thicknessMm)
  };
}

function findPerpendicularClosedBoundaryWall(floor, node, towardPoint, excludedWallId, preferredWallId) {
  if (!floor || !node || !towardPoint) return null;
  const dx = towardPoint.xMm - node.xMm;
  const dy = towardPoint.yMm - node.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!length) return null;
  const outgoingDirection = { x: dx / length, y: dy / length };
  const candidates = [];

  (floor.walls || []).forEach((candidate) => {
    if (!candidate || candidate.id === excludedWallId || !findClosedSpaceForWall(floor, candidate.id)) return;
    const candidateStart = getNode(floor, candidate.startNodeId);
    const candidateEnd = getNode(floor, candidate.endNodeId);
    const isPreferred = candidate.id === preferredWallId;
    const touchesNode = candidate.startNodeId === node.id || candidate.endNodeId === node.id ||
      (isPreferred && pointTouchesWallSegment(node, candidateStart, candidateEnd));
    if (!touchesNode) return;
    const segment = buildBaseWallSegment(floor, candidate);
    if (!segment) return;
    const parallelScore = Math.abs(dot(outgoingDirection, segment.direction));
    const outwardScore = dot(outgoingDirection, segment.normal);
    if (parallelScore > 0.25 || outwardScore < 0.25) return;
    candidates.push({ wall: candidate, parallelScore, outwardScore, isPreferred });
  });

  candidates.sort((first, second) => (
    first.parallelScore - second.parallelScore ||
    Number(second.isPreferred) - Number(first.isPreferred) ||
    second.outwardScore - first.outwardScore
  ));
  return candidates.length ? candidates[0].wall : null;
}

function resolveClosedBoundaryInsetMm(floor, node, towardPoint, options) {
  const opts = options || {};
  const boundaryWall = findPerpendicularClosedBoundaryWall(
    floor,
    node,
    towardPoint,
    opts.excludedWallId || '',
    opts.preferredWallId || ''
  );
  if (!boundaryWall) return 0;
  return Math.round(resolveRenderThicknessMm(boundaryWall, opts));
}

function isClosedBoundaryCorner(floor, session) {
  if (!floor || !session || !session.activeSpaceStartNodeId || !session.activeSpaceSharedWallId) return false;
  if (!findClosedSpaceForWall(floor, session.activeSpaceSharedWallId)) return false;
  const incidentClosedWalls = (floor.walls || []).filter((wall) => (
    (wall.startNodeId === session.activeSpaceStartNodeId || wall.endNodeId === session.activeSpaceStartNodeId) &&
    !!findClosedSpaceForWall(floor, wall.id)
  ));
  return incidentClosedWalls.length >= 2;
}

function buildResolvedSegment(floor, wall, options) {
  const opts = options || {};
  const base = buildBaseWallSegment(floor, wall, opts);
  if (!base) return null;
  const storedInsets = getWallMeasurementInsets(wall);
  const renderStartInset = storedInsets.start > 0
    ? resolveClosedBoundaryInsetMm(floor, base.start, base.end, {
      excludedWallId: wall.id,
      renderThicknessMmMap: opts.renderThicknessMmMap
    }) || storedInsets.start
    : 0;
  const renderEndInset = storedInsets.end > 0
    ? resolveClosedBoundaryInsetMm(floor, base.end, base.start, {
      excludedWallId: wall.id,
      renderThicknessMmMap: opts.renderThicknessMmMap
    }) || storedInsets.end
    : 0;
  const maximumInset = Math.max(0, base.lengthMm - 1);
  const startInset = Math.min(renderStartInset, maximumInset);
  const endInset = Math.min(renderEndInset, Math.max(0, maximumInset - startInset));
  const start = addVector(base.start, base.direction, startInset);
  const end = addVector(base.end, base.direction, -endInset);

  return Object.assign({}, base, {
    topologyStart: base.start,
    topologyEnd: base.end,
    start,
    end,
    lengthMm: Number.isFinite(Number(wall.lengthMm))
      ? Math.max(0, Math.round(Number(wall.lengthMm)))
      : Math.max(0, base.lengthMm - storedInsets.start - storedInsets.end),
    measurementStartInsetMm: storedInsets.start,
    measurementEndInsetMm: storedInsets.end,
    outerStart: addVector(start, base.normal, base.thicknessMm),
    outerEnd: addVector(end, base.normal, base.thicknessMm)
  });
}

function normalForMeasurementSide(start, end, side) {
  if (!start || !end) return null;
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const rawLength = Math.sqrt(dx * dx + dy * dy);
  if (!rawLength) return null;

  const direction = { x: dx / rawLength, y: dy / rawLength };
  const leftNormal = { x: direction.y, y: -direction.x };
  const rightNormal = { x: -direction.y, y: direction.x };
  return side === 'left' ? leftNormal : rightNormal;
}

function resolveStableAxisMeasurementSide(start, end) {
  const leftNormal = normalForMeasurementSide(start, end, 'left');
  const rightNormal = normalForMeasurementSide(start, end, 'right');
  if (!leftNormal || !rightNormal) return 'left';

  const dx = Math.abs(end.xMm - start.xMm);
  const dy = Math.abs(end.yMm - start.yMm);
  const preferredNormal = dy >= dx
    ? { x: 1, y: 0 }
    : { x: 0, y: 1 };
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
  let bestScore = sourceSegment
    ? Math.abs(dot(previewDirection, sourceSegment.direction))
    : -1;

  // A closed-room corner belongs to two boundary walls. Use the wall aligned
  // with the outgoing preview to preserve the inner/outer corner distinction.
  (floor.walls || []).forEach((wall) => {
    if (
      wall.id === sourceWall.id ||
      (wall.startNodeId !== start.id && wall.endNodeId !== start.id) ||
      !findClosedSpaceForWall(floor, wall.id)
    ) {
      return;
    }
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
  const sourceSegment = sourceWall ? buildResolvedSegment(floor, sourceWall) : null;
  if (!sourceSegment || !sourceSegment.normal) return session.measurementSide;

  const towardWallBody = session.activeSpaceSharedSnapLine === 'outer'
    ? { x: -sourceSegment.normal.x, y: -sourceSegment.normal.y }
    : sourceSegment.normal;
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

function resolvePreviewMeasurementStartInsetMm(floor, session, anchor, previewPoint) {
  if (!floor || !session || !anchor || !previewPoint || !session.activeSpaceSharedWallId) return 0;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (activeWallCount !== 0 || !findClosedSpaceForWall(floor, session.activeSpaceSharedWallId)) return 0;
  return resolveClosedBoundaryInsetMm(floor, anchor, previewPoint, {
    preferredWallId: session.activeSpaceSharedWallId
  });
}

function resolveMeasurementEndInsetMm(floor, start, end, preferredWallId, excludedWallId) {
  if (!floor || !start || !end) return 0;
  return resolveClosedBoundaryInsetMm(floor, end, start, {
    excludedWallId: excludedWallId || '',
    preferredWallId: preferredWallId || ''
  });
}

function calculateMeasuredPreviewLength(anchor, previewPoint, startInsetMm, endInsetMm) {
  return Math.max(
    0,
    distanceMm(anchor, previewPoint) -
      normalizeMeasurementInset(startInsetMm) -
      normalizeMeasurementInset(endInsetMm)
  );
}

function intersectLines(a1, a2, b1, b2) {
  const p = { x: a1.xMm, y: a1.yMm };
  const r = { x: a2.xMm - a1.xMm, y: a2.yMm - a1.yMm };
  const q = { x: b1.xMm, y: b1.yMm };
  const s = { x: b2.xMm - b1.xMm, y: b2.yMm - b1.yMm };
  const denominator = cross(r, s);

  if (Math.abs(denominator) < 0.000001) {
    return null;
  }

  const t = cross({ x: q.x - p.x, y: q.y - p.y }, s) / denominator;
  return {
    xMm: p.x + t * r.x,
    yMm: p.y + t * r.y
  };
}

function projectAlong(segment, point) {
  return dot(
    { x: point.xMm - segment.start.xMm, y: point.yMm - segment.start.yMm },
    segment.direction
  );
}

function segmentOverlapLengthMm(start, end, otherStart, otherEnd) {
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!length) return 0;

  const direction = { x: dx / length, y: dy / length };
  if (
    pointLineDistanceMm(otherStart, start, direction) > WALL_OVERLAP_TOLERANCE_MM ||
    pointLineDistanceMm(otherEnd, start, direction) > WALL_OVERLAP_TOLERANCE_MM
  ) {
    return 0;
  }

  const otherStartAlong = dot({ x: otherStart.xMm - start.xMm, y: otherStart.yMm - start.yMm }, direction);
  const otherEndAlong = dot({ x: otherEnd.xMm - start.xMm, y: otherEnd.yMm - start.yMm }, direction);
  const overlapStart = Math.max(0, Math.min(otherStartAlong, otherEndAlong));
  const overlapEnd = Math.min(length, Math.max(otherStartAlong, otherEndAlong));
  return Math.max(0, overlapEnd - overlapStart);
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

    const overlapLength = segmentOverlapLengthMm(start, end, wallStart, wallEnd);
    const wallLength = distanceMm(wallStart, wallEnd);
    const meaningfulOverlap = Math.min(currentLength, wallLength) * 0.25;
    return overlapLength > Math.max(WALL_OVERLAP_TOLERANCE_MM, meaningfulOverlap);
  }) || null;
}

function hasClosureInteriorIntersection(start, end, otherStart, otherEnd) {
  const direction = { x: end.xMm - start.xMm, y: end.yMm - start.yMm };
  const otherDirection = { x: otherEnd.xMm - otherStart.xMm, y: otherEnd.yMm - otherStart.yMm };
  const denominator = cross(direction, otherDirection);

  if (Math.abs(denominator) < 0.000001) {
    return segmentOverlapLengthMm(start, end, otherStart, otherEnd) > WALL_OVERLAP_TOLERANCE_MM;
  }

  const offset = { x: otherStart.xMm - start.xMm, y: otherStart.yMm - start.yMm };
  const t = cross(offset, otherDirection) / denominator;
  const u = cross(offset, direction) / denominator;
  const epsilon = 0.0001;

  // The virtual closing edge may meet the first/last wall at either endpoint,
  // but it cannot pass through any existing wall in its interior.
  return t > epsilon && t < 1 - epsilon && u >= -epsilon && u <= 1 + epsilon;
}

function calculatePolygonAreaMm2(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let twiceArea = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twiceArea += point.xMm * next.yMm - next.xMm * point.yMm;
  });
  return Math.abs(twiceArea) / 2;
}

function buildOrthogonalClosurePoints(startPoint, endPoint, incomingStart) {
  const horizontalFirst = [
    endPoint,
    { xMm: startPoint.xMm, yMm: endPoint.yMm },
    startPoint
  ];
  const verticalFirst = [
    endPoint,
    { xMm: endPoint.xMm, yMm: startPoint.yMm },
    startPoint
  ];
  const incomingIsHorizontal = incomingStart
    ? isHorizontalSegment(incomingStart, endPoint)
    : true;
  return incomingIsHorizontal
    ? [horizontalFirst, verticalFirst]
    : [verticalFirst, horizontalFirst];
}

function normalizeClosurePoints(points) {
  return points.filter((point, index) => (
    index === 0 || distanceMm(point, points[index - 1]) > 0.001
  ));
}

function isSafeClosurePath(points, occupiedSegments) {
  if (!Array.isArray(points) || points.length < 2) return false;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (distanceMm(start, end) < MIN_WALL_LENGTH_MM) return false;
    const intersects = occupiedSegments.some((segment) => (
      segment.start && segment.end &&
      hasClosureInteriorIntersection(start, end, segment.start, segment.end)
    ));
    if (intersects) return false;
  }
  return true;
}

function isSafeOrthogonalClosurePath(points, occupiedSegments) {
  if (!Array.isArray(points) || points.length < 2) return false;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = distanceMm(start, end);
    // A short first or final leg can be the wall-thickness alignment bridge
    // between an adjacent room's outside corner and the shared-wall topology.
    // Interior inferred legs are real walls and keep the normal minimum.
    if (index > 0 && index < points.length - 2 && length < MIN_WALL_LENGTH_MM) return false;
    if (length <= 0) continue;
    const intersects = occupiedSegments.some((segment) => (
      segment.start && segment.end && hasClosureInteriorIntersection(
        start,
        end,
        segment.start,
        segment.end
      )
    ));
    if (intersects) return false;
  }
  return true;
}

function isAxisAlignedSegment(start, end) {
  if (!start || !end) return false;
  return Math.abs(end.xMm - start.xMm) <= RECTANGLE_ALIGNMENT_TOLERANCE_MM ||
    Math.abs(end.yMm - start.yMm) <= RECTANGLE_ALIGNMENT_TOLERANCE_MM;
}

function getMinimumClosureSuggestionWallCount(floor, session) {
  if (!session || !session.activeSpaceSharedWallId) return 2;
  if (!isClosedBoundaryCorner(floor, session)) return 1;
  return 3;
}

function findMergeClosurePlan(floor, session, endPoint) {
  if (!floor || !session || !endPoint) return null;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWalls = (floor.walls || []).slice(startWallIndex);
  const anchor = getNode(floor, session.anchorNodeId);
  const includesPreview = !!session.previewPoint;
  const requiredWallCount = activeWalls.length + (includesPreview ? 1 : 0);

  // A reset cursor can begin a new wall chain from an existing boundary. In
  // that case, one measured wall plus a new closing edge can form a room by
  // following the existing boundary back to the snapped start point.
  // Closed-corner continuations may use the opposite corner as a snap
  // reference on their second wall, but that reference must not become a
  // closure suggestion until a third new wall exists.
  const minimumSharedWallCount = isClosedBoundaryCorner(floor, session) && session.mode === 'straight'
    ? 2
    : getMinimumClosureSuggestionWallCount(floor, session);
  if (
    session.activeSpaceSharedWallId &&
    activeStartNode &&
    anchor &&
    requiredWallCount >= minimumSharedWallCount
  ) {
    const closureStart = includesPreview ? endPoint : anchor;
    const activeWallIds = {};
    activeWalls.forEach((wall) => { activeWallIds[wall.id] = true; });
    const segments = (floor.walls || []).map((wall) => ({
      start: getNode(floor, wall.startNodeId),
      end: getNode(floor, wall.endNodeId)
    }));
    if (includesPreview) {
      segments.push({ start: anchor, end: endPoint });
    }

    const activeSharedWall = getWall(floor, session.activeSpaceSharedWallId);
    const activeSharedEndpointIds = activeSharedWall
      ? [activeSharedWall.startNodeId, activeSharedWall.endNodeId]
      : [];
    const candidatePlans = (floor.nodes || []).map((candidate) => {
      if (!candidate || candidate.id === activeStartNode.id || candidate.id === anchor.id) return null;
      if (distanceMm(closureStart, candidate) < MIN_WALL_LENGTH_MM) return null;

      const candidateConnections = (floor.walls || []).filter((wall) => (
        !activeWallIds[wall.id] && (wall.startNodeId === candidate.id || wall.endNodeId === candidate.id)
      ));
      if (candidateConnections.length < 1) return null;

      const boundaryPath = findWallPathBetweenNodes(
        floor,
        candidate.id,
        activeStartNode.id,
        activeWallIds
      );
      if (boundaryPath.length < 1) return null;

      return {
        candidate,
        boundaryPath,
        // A room restarted from an existing wall should close against the
        // opposite end of that same wall before considering a longer route
        // around the old room. Node insertion order is unrelated to geometry;
        // using it here can make the new room swallow the previous room.
        sharedEndpointRank: activeSharedEndpointIds.indexOf(candidate.id) === -1 ? 1 : 0,
        boundaryLengthMm: boundaryPath.reduce((total, wallId) => {
          const wall = getWall(floor, wallId);
          return total + (wall ? getWallCoordinateLength(floor, wall) : 0);
        }, 0),
        closureDistanceMm: distanceMm(closureStart, candidate)
      };
    }).filter(Boolean).sort((left, right) => (
      left.sharedEndpointRank - right.sharedEndpointRank ||
      left.boundaryPath.length - right.boundaryPath.length ||
      left.boundaryLengthMm - right.boundaryLengthMm ||
      left.closureDistanceMm - right.closureDistanceMm
    ));

    for (let index = 0; index < candidatePlans.length; index += 1) {
      const candidatePlan = candidatePlans[index];
      const candidate = candidatePlan.candidate;
      if (!candidate || candidate.id === activeStartNode.id || candidate.id === anchor.id) continue;
      // Corners of an already closed room have two boundary connections. They
      // remain valid merge targets when the new chain can return through an
      // existing boundary path; restricting this to dangling nodes prevents
      // adjacent rooms from closing when started at a closed-room corner.
      const boundaryPath = candidatePlan.boundaryPath;
      // findWallPathBetweenNodes returns wall ids, so a single existing shared
      // wall is a valid boundary path (and is the normal corner-to-corner
      // adjacent-room case).
      if (boundaryPath.length < 1) continue;

      // A restarted chain from a closed-room corner usually reaches the
      // opposite corner through an L-shaped orthogonal route. The old logic
      // only accepted a direct axis-aligned segment, so two valid walls never
      // exposed the merge candidate until the cursor happened to be diagonal.
      const allowOrthogonalSharedPath = session.mode === 'straight' &&
        isClosedBoundaryCorner(floor, session);
      const lastActiveWall = activeWalls[activeWalls.length - 1] || null;
      const incomingStart = includesPreview
        ? anchor
        : (lastActiveWall ? getNode(floor, lastActiveWall.startNodeId) : anchor);
      const pathCandidates = allowOrthogonalSharedPath
        ? buildOrthogonalClosurePoints(candidate, closureStart, incomingStart)
        : [[closureStart, candidate]];
      for (let pathIndex = 0; pathIndex < pathCandidates.length; pathIndex += 1) {
        const points = normalizeClosurePoints(pathCandidates[pathIndex]);
        if (session.mode === 'straight' && points.some((point, pointIndex) => (
          pointIndex > 0 && !isAxisAlignedSegment(points[pointIndex - 1], point)
        ))) continue;
        const safePath = allowOrthogonalSharedPath
          ? isSafeOrthogonalClosurePath(points, segments)
          : isSafeClosurePath(points, segments);
        if (!safePath) continue;
        return {
          targetNode: candidate,
          points
        };
      }
    }
  }

  // In straight mode, two confirmed orthogonal walls already determine the
  // remaining rectangle. Surface that two-segment closure as a suggestion;
  // the missing walls are still only persisted after the user confirms it.
  const minimumWallCount = session.mode === 'straight' ? 2 : 3;
  if (!activeStartNode || !anchor || requiredWallCount < minimumWallCount || distanceMm(endPoint, activeStartNode) < MIN_WALL_LENGTH_MM) {
    return null;
  }

  const outlinePoints = [activeStartNode];
  let previousNodeId = activeStartNode.id;
  for (let index = 0; index < activeWalls.length; index += 1) {
    const wall = activeWalls[index];
    if (!wall || wall.startNodeId !== previousNodeId) return null;
    const wallEnd = getNode(floor, wall.endNodeId);
    if (!wallEnd) return null;
    outlinePoints.push(wallEnd);
    previousNodeId = wallEnd.id;
  }

  if (previousNodeId !== anchor.id) return null;
  if (includesPreview) outlinePoints.push(endPoint);
  const segments = (floor.walls || []).map((wall) => ({
    start: getNode(floor, wall.startNodeId),
    end: getNode(floor, wall.endNodeId)
  }));
  if (includesPreview) {
    segments.push({ start: anchor, end: endPoint });
  }

  const lastWall = activeWalls[activeWalls.length - 1] || null;
  const incomingStart = includesPreview
    ? anchor
    : (lastWall ? getNode(floor, lastWall.startNodeId) : null);
  const pathCandidates = session.mode === 'straight'
    ? buildOrthogonalClosurePoints(activeStartNode, endPoint, incomingStart)
    : [[endPoint, activeStartNode]];

  for (let index = 0; index < pathCandidates.length; index += 1) {
    const points = normalizeClosurePoints(pathCandidates[index]);
    const polygonPoints = outlinePoints.concat(points.slice(1, -1));
    if (calculatePolygonAreaMm2(polygonPoints) < MIN_CLOSED_SPACE_AREA_MM2) continue;
    if (!isSafeClosurePath(points, segments)) continue;
    return {
      targetNode: activeStartNode,
      points
    };
  }

  return null;
}

function findMergeClosureCandidate(floor, session, endPoint) {
  const plan = findMergeClosurePlan(floor, session, endPoint);
  return plan ? plan.targetNode : null;
}

function getClosurePath(floor, session) {
  if (!floor || !session) return [];
  const currentNode = session.previewPoint || getNode(floor, session.anchorNodeId);
  const targetNode = session.closeCandidatePoint || getNode(floor, session.closeCandidateNodeId);
  if (!currentNode || !targetNode) return [];
  if (session.closeCandidateType !== 'merge') return [currentNode, targetNode];

  const plan = findMergeClosurePlan(floor, session, currentNode);
  if (!plan || !plan.targetNode || plan.targetNode.id !== session.closeCandidateNodeId) return [];
  const points = plan.points.map((point) => ({ xMm: point.xMm, yMm: point.yMm }));
  if (points.length >= 2) {
    const previous = points[points.length - 2];
    const target = points[points.length - 1];
    const endInsetMm = resolveMeasurementEndInsetMm(
      floor,
      previous,
      plan.targetNode,
      session.activeSpaceSharedWallId
    );
    const length = distanceMm(previous, target);
    if (endInsetMm > 0 && length > endInsetMm) {
      points[points.length - 1] = {
        xMm: Math.round(target.xMm + (previous.xMm - target.xMm) / length * endInsetMm),
        yMm: Math.round(target.yMm + (previous.yMm - target.yMm) / length * endInsetMm)
      };
    }
  }
  return points;
}

function isUsableJoinPoint(segment, point) {
  if (!point) return false;
  const along = projectAlong(segment, point);
  const limit = Math.max(segment.thicknessMm * 4, CLOSE_TOLERANCE_MM);
  return along >= -limit && along <= segment.lengthMm + limit;
}

function offsetJoinPoint(current, adjacent) {
  if (!current || !adjacent) return null;
  const point = intersectLines(current.outerStart, current.outerEnd, adjacent.outerStart, adjacent.outerEnd);
  return isUsableJoinPoint(current, point) ? point : null;
}

function buildWallRenderGeometry(floor, wall, options) {
  const opts = options || {};
  const current = buildResolvedSegment(floor, wall, options);
  if (!current) return null;

  const adjacent = resolveAdjacentWalls(floor, wall, options);
  const adjacentOptions = {
    renderThicknessMmMap: opts.renderThicknessMmMap
  };
  const startAdjacent = adjacent.startWall ? buildResolvedSegment(floor, adjacent.startWall, adjacentOptions) : null;
  const endAdjacent = adjacent.endWall ? buildResolvedSegment(floor, adjacent.endWall, adjacentOptions) : null;
  const startJoined = !!(startAdjacent && (
    pointsNearlyEqual(startAdjacent.start, current.start) || pointsNearlyEqual(startAdjacent.end, current.start)
  ));
  const endJoined = !!(endAdjacent && (
    pointsNearlyEqual(endAdjacent.start, current.end) || pointsNearlyEqual(endAdjacent.end, current.end)
  ));
  const outerStart = (startJoined && offsetJoinPoint(current, startAdjacent)) || current.outerStart;
  const outerEnd = (endJoined && offsetJoinPoint(current, endAdjacent)) || current.outerEnd;

  return {
    start: current.start,
    end: current.end,
    lengthMm: current.lengthMm,
    angleDeg: angleDeg(current.start, current.end),
    startJoined,
    endJoined,
    startOpen: !hasWallConnectionAtPoint(floor, wall, current.start),
    endOpen: !hasWallConnectionAtPoint(floor, wall, current.end),
    outerStart,
    outerEnd,
    outerStartAlongMm: projectAlong(current, outerStart),
    outerEndAlongMm: projectAlong(current, outerEnd),
    thicknessMm: current.thicknessMm
  };
}

function buildWallSnapGeometry(floor, wall) {
  const segment = buildResolvedSegment(floor, wall);
  if (!segment) return null;
  return {
    start: segment.start,
    end: segment.end,
    outerStart: segment.outerStart,
    outerEnd: segment.outerEnd
  };
}

function pointsToJoinFill(previous, next) {
  if (!previous || !next || !pointsNearlyEqual(previous.end, next.start)) {
    return null;
  }
  if (Math.abs(dot(previous.normal, next.normal)) > 0.98) {
    return null;
  }

  const joint = previous.end;
  const miter = intersectLines(previous.outerStart, previous.outerEnd, next.outerStart, next.outerEnd);
  const hasSharedMiter = isUsableJoinPoint(previous, miter) && isUsableJoinPoint(next, miter);

  // Each wall body already reaches the shared miter point. Adding the former
  // four-point patch here created a second, offset corner on diagonal joins.
  if (hasSharedMiter) return null;

  return {
    id: `${previous.wall.id}-${next.wall.id}`,
    wallIds: [previous.wall.id, next.wall.id],
    joint,
    // Only cover the small open gap when an extreme join cannot be mitered.
    points: [joint, previous.outerEnd, next.outerStart]
  };
}

function buildWallJoinRenderGeometries(floor, options) {
  if (!floor || !floor.walls || floor.walls.length < 2) return [];

  const opts = options || {};
  const segmentOptions = {
    renderThicknessMmMap: opts.renderThicknessMmMap
  };
  const joins = [];

  for (let index = 0; index < floor.walls.length - 1; index += 1) {
    const previous = buildResolvedSegment(floor, floor.walls[index], segmentOptions);
    const next = buildResolvedSegment(floor, floor.walls[index + 1], segmentOptions);
    const join = pointsToJoinFill(previous, next);
    if (join) joins.push(join);
  }

  const singleWholePathClosed = floor.spaces &&
    floor.spaces.filter((space) => space.closed && Array.isArray(space.wallIds)).length === 1 &&
    floor.spaces.some((space) => (
      space.closed &&
      Array.isArray(space.wallIds) &&
      space.wallIds.length === floor.walls.length &&
      floor.walls.every((wall, index) => wall.id === space.wallIds[index])
    ));

  if (singleWholePathClosed && floor.walls.length > 2) {
    const previous = buildResolvedSegment(floor, floor.walls[floor.walls.length - 1], segmentOptions);
    const next = buildResolvedSegment(floor, floor.walls[0], segmentOptions);
    const join = pointsToJoinFill(previous, next);
    if (join) joins.push(join);
  }

  return joins;
}

function addNode(floor, point) {
  const node = {
    id: nextId('node'),
    xMm: Math.round(point.xMm),
    yMm: Math.round(point.yMm),
    createdAt: nowIso()
  };
  floor.nodes.push(node);
  return node;
}

function touchDraft(draft) {
  draft.updatedAt = nowIso();
  return draft;
}

function snapPreviewPoint(anchor, rawPoint, mode) {
  const point = {
    xMm: Math.round(rawPoint.xMm),
    yMm: Math.round(rawPoint.yMm)
  };

  if (mode !== 'straight') {
    return point;
  }

  const dx = point.xMm - anchor.xMm;
  const dy = point.yMm - anchor.yMm;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { xMm: point.xMm, yMm: anchor.yMm };
  }

  return { xMm: anchor.xMm, yMm: point.yMm };
}

function isHorizontalSegment(start, end) {
  return Math.abs((end || {}).xMm - (start || {}).xMm) >= Math.abs((end || {}).yMm - (start || {}).yMm);
}

function maybeSnapThirdWallForRectangle(floor, session, anchor, previewPoint) {
  if (!floor || !session || session.mode !== 'straight' || !anchor || !previewPoint) {
    return { point: previewPoint, guide: null };
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  // Keep the rectangle reference while the third wall is being corrected.
  // Once it has been committed, forward extension and reverse shortening both
  // still need to snap its terminal endpoint to the first wall's orthogonal axis.
  if (activeWallCount !== 2 && activeWallCount !== 3) {
    return { point: previewPoint, guide: null };
  }

  const firstWall = floor.walls[startWallIndex];
  const firstStart = firstWall ? getNode(floor, firstWall.startNodeId) : null;
  const firstEnd = firstWall ? getNode(floor, firstWall.endNodeId) : null;
  if (!firstStart || !firstEnd) {
    return { point: previewPoint, guide: null };
  }

  const firstIsHorizontal = isHorizontalSegment(firstStart, firstEnd);
  const previewIsHorizontal = isHorizontalSegment(anchor, previewPoint);
  if (firstIsHorizontal !== previewIsHorizontal) {
    return { point: previewPoint, guide: null };
  }

  const alignedPoint = firstIsHorizontal
    ? { xMm: firstStart.xMm, yMm: previewPoint.yMm }
    : { xMm: previewPoint.xMm, yMm: firstStart.yMm };
  const offset = firstIsHorizontal
    ? Math.abs(previewPoint.xMm - firstStart.xMm)
    : Math.abs(previewPoint.yMm - firstStart.yMm);

  if (offset > RECTANGLE_ALIGNMENT_TOLERANCE_MM || distanceMm(anchor, alignedPoint) < MIN_WALL_LENGTH_MM) {
    return { point: previewPoint, guide: null };
  }

  return {
    point: alignedPoint,
    guide: {
      type: 'rectangle-third-wall',
      direction: firstIsHorizontal ? 'vertical' : 'horizontal',
      referencePoint: { xMm: firstStart.xMm, yMm: firstStart.yMm },
      snappedPoint: { xMm: alignedPoint.xMm, yMm: alignedPoint.yMm }
    }
  };
}

function maybeSnapStraightClosureToStart(floor, session, anchor, rawPoint, previewPoint) {
  if (
    !floor ||
    !session ||
    session.mode !== 'straight' ||
    session.activeSpaceSharedWallId ||
    !anchor ||
    !rawPoint ||
    !previewPoint
  ) {
    return { point: previewPoint, guide: null };
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  if (
    activeWallCount < 3 ||
    !activeStartNode ||
    activeStartNode.id === anchor.id ||
    distanceMm(rawPoint, activeStartNode) > CLOSE_TOLERANCE_MM ||
    distanceMm(anchor, activeStartNode) < MIN_WALL_LENGTH_MM
  ) {
    return { point: previewPoint, guide: null };
  }

  const sharesVerticalAxis = Math.abs(anchor.xMm - activeStartNode.xMm) <= 1;
  const sharesHorizontalAxis = Math.abs(anchor.yMm - activeStartNode.yMm) <= 1;
  if (!sharesVerticalAxis && !sharesHorizontalAxis) {
    return { point: previewPoint, guide: null };
  }

  const snappedPoint = {
    xMm: activeStartNode.xMm,
    yMm: activeStartNode.yMm
  };
  return {
    point: snappedPoint,
    guide: {
      type: 'start-vertex-closure',
      direction: sharesVerticalAxis ? 'horizontal' : 'vertical',
      referencePoint: snappedPoint,
      snappedPoint
    }
  };
}

function pointFromLength(anchor, previewPoint, lengthMm, startInsetMm, endInsetMm) {
  const dx = previewPoint.xMm - anchor.xMm;
  const dy = previewPoint.yMm - anchor.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);

  const coordinateLengthMm = lengthMm +
    normalizeMeasurementInset(startInsetMm) +
    normalizeMeasurementInset(endInsetMm);

  if (length === 0) {
    return { xMm: anchor.xMm + coordinateLengthMm, yMm: anchor.yMm };
  }

  return {
    xMm: Math.round(anchor.xMm + dx / length * coordinateLengthMm),
    yMm: Math.round(anchor.yMm + dy / length * coordinateLengthMm)
  };
}

function resolveClosedCornerOuterVertex(floor, node, guideDirection) {
  if (!floor || !node) return null;
  const wantsVerticalWall = guideDirection === 'vertical';
  const candidates = [];
  (floor.walls || []).forEach((wall) => {
    if (!findClosedSpaceForWall(floor, wall.id) ||
      (wall.startNodeId !== node.id && wall.endNodeId !== node.id)) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;
    const isVerticalWall = Math.abs(end.xMm - start.xMm) <= 1;
    if (isVerticalWall !== wantsVerticalWall) return;
    const geometry = buildWallRenderGeometry(floor, wall);
    if (!geometry) return;
    const point = wall.startNodeId === node.id ? geometry.outerStart : geometry.outerEnd;
    if (point) candidates.push(point);
  });
  return candidates[0] || null;
}

function resolveSharedBoundaryOppositeNode(floor, session) {
  if (!floor || !session || !session.activeSpaceSharedWallId || !session.activeSpaceStartNodeId) {
    return null;
  }
  const firstWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const firstWall = floor.walls[firstWallIndex];
  const firstSegment = firstWall ? buildBaseWallSegment(floor, firstWall) : null;
  const candidates = (floor.walls || []).filter((wall) => (
    findClosedSpaceForWall(floor, wall.id) &&
    (wall.startNodeId === session.activeSpaceStartNodeId || wall.endNodeId === session.activeSpaceStartNodeId)
  )).map((wall) => {
    const segment = buildBaseWallSegment(floor, wall);
    return {
      wall,
      parallelScore: firstSegment && segment
        ? Math.abs(dot(firstSegment.direction, segment.direction))
        : (wall.id === session.activeSpaceSharedWallId ? 0 : 1),
      preferred: wall.id === session.activeSpaceSharedWallId
    };
  }).sort((first, second) => (
    first.parallelScore - second.parallelScore || Number(second.preferred) - Number(first.preferred)
  ));
  const wall = candidates.length ? candidates[0].wall : null;
  if (!wall) return null;
  return wall.startNodeId === session.activeSpaceStartNodeId
    ? getNode(floor, wall.endNodeId)
    : getNode(floor, wall.startNodeId);
}

function maybeSnapResetChainForRectangleClosure(floor, session, anchor, previewPoint) {
  if (!floor || !session || session.mode !== 'straight' || !anchor || !previewPoint) {
    return { point: previewPoint, guide: null };
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  // A restarted chain may need the first or second measured wall to align
  // with the far endpoint of an existing shared boundary.
  if (activeWallCount > 1 || !session.activeSpaceSharedWallId) {
    return { point: previewPoint, guide: null };
  }

  const previewSession = Object.assign({}, session, { previewPoint });
  const closureNode = isClosedBoundaryCorner(floor, session)
    ? resolveSharedBoundaryOppositeNode(floor, session)
    : findMergeClosureCandidate(floor, previewSession, previewPoint);
  if (!closureNode) {
    return { point: previewPoint, guide: null };
  }

  const previewIsHorizontal = isHorizontalSegment(anchor, previewPoint);
  const guideDirection = previewIsHorizontal ? 'vertical' : 'horizontal';
  const outerVertex = isClosedBoundaryCorner(floor, session)
    ? resolveClosedCornerOuterVertex(floor, closureNode, guideDirection)
    : null;
  const snapTargets = [
    { point: closureNode, snapLine: 'inner' }
  ];
  if (outerVertex && distanceMm(outerVertex, closureNode) > 1) {
    snapTargets.push({ point: outerVertex, snapLine: 'outer' });
  }
  snapTargets.sort((first, second) => {
    const firstOffset = previewIsHorizontal
      ? Math.abs(previewPoint.xMm - first.point.xMm)
      : Math.abs(previewPoint.yMm - first.point.yMm);
    const secondOffset = previewIsHorizontal
      ? Math.abs(previewPoint.xMm - second.point.xMm)
      : Math.abs(previewPoint.yMm - second.point.yMm);
    return firstOffset - secondOffset;
  });
  const snapTarget = snapTargets[0];
  const alignedPoint = previewIsHorizontal
    ? { xMm: snapTarget.point.xMm, yMm: previewPoint.yMm }
    : { xMm: previewPoint.xMm, yMm: snapTarget.point.yMm };
  const offset = previewIsHorizontal
    ? Math.abs(previewPoint.xMm - snapTarget.point.xMm)
    : Math.abs(previewPoint.yMm - snapTarget.point.yMm);

  if (
    offset > RECTANGLE_ALIGNMENT_TOLERANCE_MM ||
    distanceMm(anchor, alignedPoint) < MIN_WALL_LENGTH_MM ||
    distanceMm(alignedPoint, snapTarget.point) < MIN_WALL_LENGTH_MM
  ) {
    return { point: previewPoint, guide: null };
  }

  return {
    point: alignedPoint,
    guide: {
      type: 'rectangle-third-wall',
      direction: guideDirection,
      snapLine: snapTarget.snapLine,
      referencePoint: { xMm: snapTarget.point.xMm, yMm: snapTarget.point.yMm },
      snappedPoint: { xMm: alignedPoint.xMm, yMm: alignedPoint.yMm }
    }
  };
}

function maybeSnapToPreviousDiagonalDirection(floor, session, anchor, previewPoint) {
  if (!floor || !session || session.mode !== 'diagonal' || !anchor || !previewPoint) {
    return { point: previewPoint, guide: null };
  }

  const previousWall = getIncomingWallAtAnchor(floor, session.anchorNodeId);
  const previousAngle = getIncomingAngleAtAnchor(floor, previousWall, session.anchorNodeId);
  if (!previousWall || previousWall.mode !== 'diagonal' || previousAngle === null) {
    return { point: previewPoint, guide: null };
  }

  const length = distanceMm(anchor, previewPoint);
  if (length < MIN_WALL_LENGTH_MM) {
    return { point: previewPoint, guide: null };
  }

  const rawAngle = angleDeg(anchor, previewPoint);
  if (Math.abs(normalizeSignedAngle(rawAngle - previousAngle)) > DIAGONAL_DIRECTION_SNAP_TOLERANCE_DEG) {
    return { point: previewPoint, guide: null };
  }

  const radians = previousAngle * Math.PI / 180;
  const snappedPoint = {
    xMm: Math.round(anchor.xMm + Math.cos(radians) * length),
    yMm: Math.round(anchor.yMm + Math.sin(radians) * length)
  };
  return {
    point: snappedPoint,
    guide: {
      type: 'previous-diagonal-direction',
      anchorPoint: { xMm: anchor.xMm, yMm: anchor.yMm },
      snappedPoint: { xMm: snappedPoint.xMm, yMm: snappedPoint.yMm }
    }
  };
}

function getIncomingWallAtAnchor(floor, anchorNodeId) {
  if (!floor || !anchorNodeId) return null;
  for (let index = floor.walls.length - 1; index >= 0; index -= 1) {
    const wall = floor.walls[index];
    if (wall.endNodeId === anchorNodeId || wall.startNodeId === anchorNodeId) {
      return wall;
    }
  }
  return null;
}

function getIncomingAngleAtAnchor(floor, wall, anchorNodeId) {
  if (!wall) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  if (!start || !end) return null;
  return wall.endNodeId === anchorNodeId ? angleDeg(start, end) : angleDeg(end, start);
}

function normalizeSignedAngle(angle) {
  let normalized = angle;
  while (normalized <= -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
}

function validateInteriorAngle(angle) {
  const parsed = Number(angle);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 180) {
    throw new Error('Angle must be between 0 and 180 degrees');
  }
  return Math.round(parsed * 10) / 10;
}

function getFirstNode(floor) {
  if (!floor.walls.length) return null;
  return getNode(floor, floor.walls[0].startNodeId);
}

function getLastWall(floor) {
  return floor.walls[floor.walls.length - 1] || null;
}

function getLastEndNode(floor) {
  const lastWall = getLastWall(floor);
  return lastWall ? getNode(floor, lastWall.endNodeId) : null;
}

function refreshWallMetrics(floor) {
  floor.walls.forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    wall.lengthMm = getMeasuredWallLength(floor, wall);
    wall.angleDeg = angleDeg(start, end);
  });
}

function removeUnreferencedNodes(floor) {
  const used = {};
  floor.walls.forEach((wall) => {
    used[wall.startNodeId] = true;
    used[wall.endNodeId] = true;
  });
  const session = floor.session || {};
  if (session.anchorNodeId) used[session.anchorNodeId] = true;
  floor.nodes = floor.nodes.filter((node) => used[node.id]);
}

function validateLength(lengthMm) {
  const parsed = Number(lengthMm);
  if (!Number.isInteger(parsed) || parsed < MIN_WALL_LENGTH_MM) {
    throw new Error(`请输入不少于 ${MIN_WALL_LENGTH_MM} mm 的整数长度`);
  }
  return parsed;
}

function validateThickness(thicknessMm) {
  const parsed = Number(thicknessMm);
  if (!Number.isInteger(parsed) || parsed < MIN_THICKNESS_MM) {
    throw new Error(`请输入不少于 ${MIN_THICKNESS_MM} mm 的整数墙厚`);
  }
  return parsed;
}

function validateOpeningSize(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_OPENING_SIZE_MM) {
    throw new Error(`${label || 'opening size'} must be an integer >= ${MIN_OPENING_SIZE_MM} mm`);
  }
  return parsed;
}

function validateOpeningDepth(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_THICKNESS_MM) {
    throw new Error(`opening depth must be an integer >= ${MIN_THICKNESS_MM} mm`);
  }
  return parsed;
}

function projectPointToWallSegment(point, start, end) {
  if (!point || !start || !end) return null;
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return null;
  const rawT = ((point.xMm - start.xMm) * dx + (point.yMm - start.yMm) * dy) / lengthSq;
  const t = clampNumber(rawT, 0, 1);
  const projected = {
    xMm: Math.round(start.xMm + dx * t),
    yMm: Math.round(start.yMm + dy * t)
  };
  return {
    point: projected,
    t,
    distanceMm: distanceMm(point, projected)
  };
}

function buildWallProjectionCandidate(wall, start, end, projection, snapLine) {
  if (!projection) return null;
  return {
    wall,
    start,
    end,
    point: projection.point,
    t: projection.t,
    distanceMm: projection.distanceMm,
    snapLine
  };
}

function findNearestWallProjection(floor, point) {
  if (!floor || !point) return null;
  let best = null;
  floor.walls.forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const candidates = [
      buildWallProjectionCandidate(
        wall,
        start,
        end,
        projectPointToWallSegment(point, start, end),
        'inner'
      )
    ];
    const segment = buildResolvedSegment(floor, wall);
    if (segment && segment.outerStart && segment.outerEnd) {
      candidates.push(buildWallProjectionCandidate(
        wall,
        start,
        end,
        projectPointToWallSegment(point, segment.outerStart, segment.outerEnd),
        'outer'
      ));
    }

    candidates.filter(Boolean).forEach((projection) => {
      if (!best || projection.distanceMm < best.distanceMm) {
        best = projection;
      }
    });
  });
  return best;
}

function findNearestOuterVertex(floor, point, maxDistanceMm) {
  if (!floor || !point) return null;
  const limit = typeof maxDistanceMm === 'number' ? maxDistanceMm : CLOSE_TOLERANCE_MM;
  let best = null;

  (floor.walls || []).forEach((wall) => {
    const geometry = buildWallRenderGeometry(floor, wall);
    if (!geometry) return;

    [
      { pointMm: geometry.outerStart, nodeId: wall.startNodeId, t: 0 },
      { pointMm: geometry.outerEnd, nodeId: wall.endNodeId, t: 1 }
    ].forEach((candidate) => {
      const node = getNode(floor, candidate.nodeId);
      if (!candidate.pointMm || !node) return;
      const candidateDistance = distanceMm(point, candidate.pointMm);
      if (candidateDistance > limit) return;
      if (!best || candidateDistance < best.distanceMm) {
        best = {
          type: 'vertex',
          pointMm: {
            xMm: Math.round(candidate.pointMm.xMm),
            yMm: Math.round(candidate.pointMm.yMm)
          },
          nodeId: node.id,
          wallId: wall.id,
          snapLine: 'outer',
          t: candidate.t,
          distanceMm: candidateDistance
        };
      }
    });
  });

  return best;
}

function getNodeWallUseCount(floor, nodeId) {
  if (!floor || !nodeId) return 0;
  return (floor.walls || []).filter((wall) => wall.startNodeId === nodeId || wall.endNodeId === nodeId).length;
}

function findNearestSharedEndpointProjection(floor, point) {
  if (!floor || !point) return null;
  let best = null;

  (floor.walls || []).forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    [
      { node: start, t: 0 },
      { node: end, t: 1 }
    ].forEach((candidate) => {
      if (getNodeWallUseCount(floor, candidate.node.id) < 2) return;
      const candidateDistance = distanceMm(point, candidate.node);
      if (candidateDistance > CLOSE_TOLERANCE_MM) return;
      if (!best || candidateDistance < best.distanceMm) {
        best = {
          wall,
          start,
          end,
          point: { xMm: candidate.node.xMm, yMm: candidate.node.yMm },
          node: candidate.node,
          t: candidate.t,
          distanceMm: candidateDistance
        };
      }
    });
  });

  return best;
}

function findWallSnapProjection(floor, point) {
  return findNearestSharedEndpointProjection(floor, point) || findNearestWallProjection(floor, point);
}

function canExtendLastWall(floor, session, anchor, endPoint, measurementSide, isClosingCurrentSpace) {
  if (isClosingCurrentSpace || !anchor || !endPoint) return false;

  const lastWallIndex = floor.walls.length - 1;
  const lastWall = floor.walls[lastWallIndex];
  if (!lastWall || lastWallIndex < session.activeSpaceStartWallIndex || lastWall.endNodeId !== anchor.id) {
    return false;
  }
  if (lastWall.status !== 'confirmed' || lastWall.mode !== session.mode ||
      Number(lastWall.thicknessMm) !== Number(session.thicknessMm) ||
      lastWall.measurementSide !== measurementSide) {
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

function canShortenLastWall(floor, session, anchor, endPoint, isClosingCurrentSpace) {
  if (isClosingCurrentSpace || !anchor || !endPoint) return false;

  const lastWallIndex = floor.walls.length - 1;
  const lastWall = floor.walls[lastWallIndex];
  if (!lastWall || lastWallIndex < session.activeSpaceStartWallIndex || lastWall.endNodeId !== anchor.id) {
    return false;
  }
  if (lastWall.status !== 'confirmed' || lastWall.mode !== session.mode ||
      Number(lastWall.thicknessMm) !== Number(session.thicknessMm) ||
      floor.openings.some((opening) => opening.wallId === lastWall.id)) {
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
  const currentLength = lastStart ? distanceMm(lastStart, anchor) : 0;
  if (!lastStart || currentLength < MIN_WALL_LENGTH_MM) return false;

  const direction = {
    x: (anchor.xMm - lastStart.xMm) / currentLength,
    y: (anchor.yMm - lastStart.yMm) / currentLength
  };
  const shortenedLength = dot({
    x: endPoint.xMm - lastStart.xMm,
    y: endPoint.yMm - lastStart.yMm
  }, direction);
  if (shortenedLength < MIN_WALL_LENGTH_MM || shortenedLength >= currentLength - 1 ||
      pointLineDistanceMm(endPoint, lastStart, direction) > WALL_OVERLAP_TOLERANCE_MM) {
    return false;
  }

  const previousAngle = angleDeg(lastStart, anchor);
  const reverseAngle = angleDeg(anchor, endPoint);
  return Math.abs(Math.abs(normalizeSignedAngle(reverseAngle - previousAngle)) - 180) <=
    WALL_EXTENSION_DIRECTION_TOLERANCE_DEG;
}

function findTargetWallProjection(floor, point, target) {
  if (!floor || !point || !target || !target.wallId || !target.snapLine) return null;
  const wall = getWall(floor, target.wallId);
  if (!wall) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  if (!start || !end) return null;

  if (
    target.snapLine === 'outer' &&
    target.nodeId &&
    (target.nodeId === wall.startNodeId || target.nodeId === wall.endNodeId)
  ) {
    const node = getNode(floor, target.nodeId);
    const geometry = buildWallRenderGeometry(floor, wall);
    const outerVertex = geometry && target.nodeId === wall.startNodeId
      ? geometry.outerStart
      : (geometry && geometry.outerEnd);
    if (!node || !outerVertex) return null;
    return {
      wall,
      start,
      end,
      point: { xMm: Math.round(outerVertex.xMm), yMm: Math.round(outerVertex.yMm) },
      node,
      t: target.nodeId === wall.startNodeId ? 0 : 1,
      distanceMm: distanceMm(point, outerVertex),
      snapLine: 'outer'
    };
  }

  if (target.snapLine === 'outer') {
    const segment = buildResolvedSegment(floor, wall);
    if (!segment || !segment.outerStart || !segment.outerEnd) return null;
    return buildWallProjectionCandidate(
      wall,
      start,
      end,
      projectPointToWallSegment(point, segment.outerStart, segment.outerEnd),
      'outer'
    );
  }

  return buildWallProjectionCandidate(
    wall,
    start,
    end,
    projectPointToWallSegment(point, start, end),
    'inner'
  );
}

function getWallSnapPoint(floor, point, maxDistanceMm) {
  const projection = findWallSnapProjection(floor, point);
  if (
    projection &&
    typeof maxDistanceMm === 'number' &&
    projection.distanceMm > maxDistanceMm
  ) {
    return null;
  }
  return projection ? projection.point : null;
}

/**
 * Resolve a new wall-chain cursor target without changing the graph.
 * Existing vertices intentionally win over a nearby wall segment so users can
 * reliably restart a room from a measured corner.
 */
function getCursorPlacementTarget(floor, point, maxDistanceMm) {
  if (!floor || !point) {
    return { type: 'none', pointMm: null, distanceMm: Infinity };
  }

  const freeTarget = {
    type: 'free',
    pointMm: { xMm: Math.round(point.xMm), yMm: Math.round(point.yMm) },
    distanceMm: 0
  };
  if (!Array.isArray(floor.walls) || !floor.walls.length) return freeTarget;

  const limit = typeof maxDistanceMm === 'number' ? maxDistanceMm : CLOSE_TOLERANCE_MM;
  const wallNodeIds = new Set();
  (floor.walls || []).forEach((wall) => {
    wallNodeIds.add(wall.startNodeId);
    wallNodeIds.add(wall.endNodeId);
  });
  let nearestVertex = null;
  (floor.nodes || []).forEach((node) => {
    if (!wallNodeIds.has(node.id)) return;
    const candidateDistance = distanceMm(point, node);
    if (candidateDistance > limit) return;
    if (!nearestVertex || candidateDistance < nearestVertex.distanceMm) {
      nearestVertex = {
        type: 'vertex',
        pointMm: { xMm: node.xMm, yMm: node.yMm },
        nodeId: node.id,
        distanceMm: candidateDistance
      };
    }
  });

  const nearestOuterVertex = findNearestOuterVertex(floor, point, limit);
  if (
    nearestOuterVertex &&
    (!nearestVertex || nearestOuterVertex.distanceMm < nearestVertex.distanceMm)
  ) {
    nearestVertex = nearestOuterVertex;
  }

  const projection = findNearestWallProjection(floor, point);
  const outerProjectionWins = nearestVertex && projection &&
    projection.snapLine === 'outer' &&
    projection.distanceMm <= limit &&
    projection.distanceMm < nearestVertex.distanceMm;
  if (nearestVertex && !outerProjectionWins) return nearestVertex;

  if (!projection || projection.distanceMm > limit) {
    return freeTarget;
  }

  return {
    type: 'wall',
    pointMm: projection.point,
    wallId: projection.wall && projection.wall.id,
    snapLine: projection.snapLine || 'inner',
    distanceMm: projection.distanceMm
  };
}

function getOrCreateSnapNode(floor, projection) {
  if (!projection) return null;
  if (projection.node) return projection.node;
  if (projection.snapLine !== 'outer') {
    if (projection.t <= 0.0001) return projection.start;
    if (projection.t >= 0.9999) return projection.end;
  }

  const existing = floor.nodes.find((node) => distanceMm(node, projection.point) <= 1);
  return existing || addNode(floor, projection.point);
}

function getOrCreateWallCenterNode(floor, wallId, point) {
  const wall = getWall(floor, wallId);
  if (!wall || !point) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  const projection = projectPointToWallSegment(point, start, end);
  if (!projection) return null;
  if (projection.t <= 0.0001) return start;
  if (projection.t >= 0.9999) return end;

  const existing = floor.nodes.find((node) => distanceMm(node, projection.point) <= 1);
  return existing || addNode(floor, projection.point);
}

function getSharedWallProjection(floor, session, point) {
  if (!session || !session.activeSpaceSharedWallId || !point) return null;
  const wall = getWall(floor, session.activeSpaceSharedWallId);
  if (!wall) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  const projection = projectPointToWallSegment(point, start, end);
  if (!projection || projection.distanceMm > CLOSE_TOLERANCE_MM) return null;
  const startT = typeof session.activeSpaceSharedStartT === 'number' ? session.activeSpaceSharedStartT : null;
  if (startT !== null && Math.abs(projection.t - startT) * distanceMm(start, end) < MIN_WALL_LENGTH_MM) {
    return null;
  }
  const endpointCandidates = [
    { node: start, t: 0 },
    { node: end, t: 1 }
  ];
  const nearestEndpoint = endpointCandidates
    .map((candidate) => Object.assign(candidate, {
      distanceMm: distanceMm(projection.point, candidate.node)
    }))
    .sort((a, b) => a.distanceMm - b.distanceMm)[0];
  if (nearestEndpoint && nearestEndpoint.distanceMm <= CLOSE_TOLERANCE_MM) {
    projection.point = { xMm: nearestEndpoint.node.xMm, yMm: nearestEndpoint.node.yMm };
    projection.node = nearestEndpoint.node;
    projection.t = nearestEndpoint.t;
  }
  if (projection.t <= 0.0001) projection.node = start;
  if (projection.t >= 0.9999) projection.node = end;
  projection.wall = wall;
  projection.start = start;
  projection.end = end;
  return projection;
}

function findSharedWallClosureProjection(floor, session, point) {
  if (!floor || !session || !point) return null;
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId);
  if (!activeStartNode) return null;

  const preferred = getSharedWallProjection(floor, session, point);
  if (preferred) return preferred;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  let best = null;

  (floor.walls || []).forEach((wall, index) => {
    if (index >= startWallIndex) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const startProjection = projectPointToWallSegment(activeStartNode, start, end);
    const endProjection = projectPointToWallSegment(point, start, end);
    if (!startProjection || !endProjection) return;
    if (startProjection.distanceMm > CLOSE_TOLERANCE_MM) return;
    if (endProjection.distanceMm > CLOSE_TOLERANCE_MM) return;
    if (Math.abs(endProjection.t - startProjection.t) * distanceMm(start, end) < MIN_WALL_LENGTH_MM) return;

    const endpointCandidates = [
      { node: start, t: 0 },
      { node: end, t: 1 }
    ];
    const nearestEndpoint = endpointCandidates
      .map((candidate) => Object.assign(candidate, {
        distanceMm: distanceMm(endProjection.point, candidate.node)
      }))
      .sort((a, b) => a.distanceMm - b.distanceMm)[0];
    if (nearestEndpoint && nearestEndpoint.distanceMm <= CLOSE_TOLERANCE_MM) {
      endProjection.point = { xMm: nearestEndpoint.node.xMm, yMm: nearestEndpoint.node.yMm };
      endProjection.node = nearestEndpoint.node;
      endProjection.t = nearestEndpoint.t;
    }

    if (!best || endProjection.distanceMm < best.distanceMm) {
      best = Object.assign({}, endProjection, { wall, start, end });
    }
  });

  if (!best) return null;
  if (best.t <= 0.0001) best.node = best.start;
  if (best.t >= 0.9999) best.node = best.end;
  return best;
}

function findAnySharedWallClosureProjection(floor, session, point) {
  const sameWallProjection = findSharedWallClosureProjection(floor, session, point);
  if (sameWallProjection) return sameWallProjection;
  if (!floor || !session || !point || !session.activeSpaceSharedWallId) return null;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  let best = null;
  (floor.walls || []).forEach((wall, index) => {
    if (index >= startWallIndex || wall.id === session.activeSpaceSharedWallId) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const projection = projectPointToWallSegment(point, start, end);
    if (!projection || projection.distanceMm > CLOSE_TOLERANCE_MM) return;
    const endpointCandidates = [
      { node: start, t: 0 },
      { node: end, t: 1 }
    ];
    const nearestEndpoint = endpointCandidates
      .map((candidate) => Object.assign(candidate, {
        distanceMm: distanceMm(projection.point, candidate.node)
      }))
      .sort((a, b) => a.distanceMm - b.distanceMm)[0];
    if (nearestEndpoint && nearestEndpoint.distanceMm <= CLOSE_TOLERANCE_MM) {
      projection.point = { xMm: nearestEndpoint.node.xMm, yMm: nearestEndpoint.node.yMm };
      projection.node = nearestEndpoint.node;
      projection.t = nearestEndpoint.t;
    }
    if (!best || projection.distanceMm < best.distanceMm) {
      best = Object.assign({}, projection, { wall, start, end });
    }
  });

  if (!best) return null;
  if (best.t <= 0.0001) best.node = best.start;
  if (best.t >= 0.9999) best.node = best.end;
  return best;
}

function findWallPathBetweenNodes(floor, fromNodeId, toNodeId, excludedWallIds) {
  if (!floor || !fromNodeId || !toNodeId) return [];
  if (fromNodeId === toNodeId) return [];

  const excluded = excludedWallIds || {};
  const visited = {};
  const queue = [{ nodeId: fromNodeId, wallIds: [] }];
  visited[fromNodeId] = true;

  while (queue.length) {
    const current = queue.shift();
    const walls = floor.walls || [];
    for (let index = 0; index < walls.length; index += 1) {
      const wall = walls[index];
      if (!wall || excluded[wall.id]) continue;
      let nextNodeId = '';
      if (wall.startNodeId === current.nodeId) {
        nextNodeId = wall.endNodeId;
      } else if (wall.endNodeId === current.nodeId) {
        nextNodeId = wall.startNodeId;
      }
      if (!nextNodeId || visited[nextNodeId]) continue;
      const nextWallIds = current.wallIds.concat(wall.id);
      if (nextNodeId === toNodeId) {
        return nextWallIds;
      }
      visited[nextNodeId] = true;
      queue.push({ nodeId: nextNodeId, wallIds: nextWallIds });
    }
  }

  return [];
}

function cloneWallSegment(sourceWall, startNodeId, endNodeId, id) {
  return {
    id: id || nextId('wall'),
    startNodeId,
    endNodeId,
    mode: sourceWall.mode,
    lengthMm: sourceWall.lengthMm,
    angleDeg: sourceWall.angleDeg,
    thicknessMm: sourceWall.thicknessMm,
    measurementSide: sourceWall.measurementSide,
    measurementStartInsetMm: 0,
    measurementEndInsetMm: 0,
    inputSource: sourceWall.inputSource || 'manual',
    angleSource: sourceWall.angleSource || '',
    angleInteriorDeg: Number.isFinite(sourceWall.angleInteriorDeg) ? sourceWall.angleInteriorDeg : null,
    status: sourceWall.status || 'confirmed',
    measuredAt: sourceWall.measuredAt || nowIso()
  };
}

function pointAlongWall(floor, wall, nodeId) {
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  const node = getNode(floor, nodeId);
  const projection = projectPointToWallSegment(node, start, end);
  return projection ? Math.round(projection.t * distanceMm(start, end)) : 0;
}

function uniqueCutNodesByAlong(items) {
  const sorted = items
    .filter((item) => item && item.node)
    .sort((a, b) => a.alongMm - b.alongMm);
  const result = [];
  sorted.forEach((item) => {
    const previous = result[result.length - 1];
    if (previous && Math.abs(previous.alongMm - item.alongMm) <= 1) {
      return;
    }
    result.push(item);
  });
  return result;
}

function replaceWallInSpaces(floor, wallId, replacementIds) {
  floor.spaces = (floor.spaces || []).map((space) => {
    if (!Array.isArray(space.wallIds) || space.wallIds.indexOf(wallId) === -1) return space;
    const wallIds = [];
    space.wallIds.forEach((id) => {
      if (id === wallId) {
        replacementIds.forEach((replacementId) => wallIds.push(replacementId));
      } else {
        wallIds.push(id);
      }
    });
    return Object.assign({}, space, { wallIds });
  });
}

function remapOpeningsForSplitWall(floor, originalWall, segments) {
  ensureOpenings(floor).forEach((opening) => {
    if (opening.wallId !== originalWall.id) return;
    const originalInsets = getWallMeasurementInsets(originalWall);
    const centerOffset = (opening.centerOffsetMm || 0) + originalInsets.start;
    const target = segments.find((segment) => (
      centerOffset >= segment.startAlongMm - 1 &&
      centerOffset <= segment.endAlongMm + 1
    )) || segments[segments.length - 1];
    if (!target) return;
    opening.wallId = target.wall.id;
    opening.centerOffsetMm = Math.round(
      centerOffset -
      target.startAlongMm -
      getWallMeasurementInsets(target.wall).start
    );
    normalizeOpeningToWall(floor, opening);
    normalizeOpeningDirection(opening);
  });
}

function splitWallAtNodes(floor, wallId, cutNodeIds) {
  const wallIndex = floor.walls.findIndex((wall) => wall.id === wallId);
  const originalWall = floor.walls[wallIndex];
  if (wallIndex === -1 || !originalWall) return { sharedWallId: wallId, segmentIds: [wallId] };

  const wallLength = distanceMm(
    getNode(floor, originalWall.startNodeId),
    getNode(floor, originalWall.endNodeId)
  );
  const cutItems = uniqueCutNodesByAlong([
    { node: getNode(floor, originalWall.startNodeId), alongMm: 0 },
    ...cutNodeIds.map((nodeId) => ({
      node: getNode(floor, nodeId),
      alongMm: pointAlongWall(floor, originalWall, nodeId)
    })),
    { node: getNode(floor, originalWall.endNodeId), alongMm: wallLength }
  ]);

  const segmentRecords = [];
  for (let index = 0; index < cutItems.length - 1; index += 1) {
    const current = cutItems[index];
    const next = cutItems[index + 1];
    if (!current.node || !next.node || Math.abs(next.alongMm - current.alongMm) < MIN_WALL_LENGTH_MM) {
      continue;
    }
    const wall = cloneWallSegment(
      originalWall,
      current.node.id,
      next.node.id,
      segmentRecords.length === 0 ? originalWall.id : undefined
    );
    segmentRecords.push({
      wall,
      startAlongMm: current.alongMm,
      endAlongMm: next.alongMm
    });
  }

  if (!segmentRecords.length) return { sharedWallId: wallId, segmentIds: [wallId] };
  const originalInsets = getWallMeasurementInsets(originalWall);
  segmentRecords[0].wall.measurementStartInsetMm = originalInsets.start;
  segmentRecords[segmentRecords.length - 1].wall.measurementEndInsetMm = originalInsets.end;
  floor.walls.splice(wallIndex, 1, ...segmentRecords.map((record) => record.wall));
  refreshWallMetrics(floor);
  replaceWallInSpaces(floor, originalWall.id, segmentRecords.map((record) => record.wall.id));
  remapOpeningsForSplitWall(floor, originalWall, segmentRecords);

  return {
    segmentIds: segmentRecords.map((record) => record.wall.id),
    getSegmentBetween(nodeAId, nodeBId) {
      return segmentRecords.find((record) => (
        (record.wall.startNodeId === nodeAId && record.wall.endNodeId === nodeBId) ||
        (record.wall.startNodeId === nodeBId && record.wall.endNodeId === nodeAId)
      ));
    }
  };
}

function normalizeOpeningToWall(floor, opening) {
  const wall = getWall(floor, opening.wallId);
  if (!wall) return opening;

  const maxWidth = Math.max(MIN_OPENING_SIZE_MM, Math.floor((wall.lengthMm || 0) * MAX_OPENING_WALL_RATIO));
  opening.widthMm = clampNumber(opening.widthMm, MIN_OPENING_SIZE_MM, maxWidth);
  const halfWidth = opening.widthMm / 2;
  opening.centerOffsetMm = Math.round(clampNumber(
    opening.centerOffsetMm,
    halfWidth,
    Math.max(halfWidth, wall.lengthMm - halfWidth)
  ));
  return opening;
}

function normalizeOpeningDirection(opening) {
  if (!opening || opening.type !== 'door') return opening;
  opening.openDirection = opening.openDirection === 'outside' ? 'outside' : 'inside';
  return opening;
}

function normalizeOpeningsForWall(floor, wallId) {
  ensureOpenings(floor).forEach((opening) => {
    if (opening.wallId === wallId) {
      normalizeOpeningToWall(floor, opening);
      normalizeOpeningDirection(opening);
    }
  });
}

function getSingleSharedEndpoint(floor, wall) {
  if (!floor || !wall) return null;
  const startShared = floor.walls.some((item) => (
    item.id !== wall.id &&
    (item.startNodeId === wall.startNodeId || item.endNodeId === wall.startNodeId)
  ));
  const endShared = floor.walls.some((item) => (
    item.id !== wall.id &&
    (item.startNodeId === wall.endNodeId || item.endNodeId === wall.endNodeId)
  ));

  if (startShared === endShared) return null;
  return startShared
    ? { fixedNodeId: wall.startNodeId, movingNodeId: wall.endNodeId }
    : { fixedNodeId: wall.endNodeId, movingNodeId: wall.startNodeId };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setMode(draft, mode) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  if (mode !== 'straight' && mode !== 'diagonal') return next;
  floor.session.mode = mode;
  return touchDraft(next);
}

function placeCursor(draft, point) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

  if (floor.walls.length) {
    const endNode = getLastEndNode(floor);
    session.anchorNodeId = endNode ? endNode.id : '';
  } else if (session.anchorNodeId) {
    const anchor = getNode(floor, session.anchorNodeId);
    if (anchor) {
      anchor.xMm = Math.round(point.xMm);
      anchor.yMm = Math.round(point.yMm);
    }
  } else {
    const node = addNode(floor, point);
    session.anchorNodeId = node.id;
  }

  session.state = floor.walls.length ? 'wallCommitted' : 'cursorPlaced';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  return touchDraft(next);
}

function startPreview(draft, rawPoint) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  let anchor = getNode(floor, session.anchorNodeId);

  if (!anchor) {
    anchor = addNode(floor, rawPoint);
    session.anchorNodeId = anchor.id;
  }

  const orthogonalPoint = snapPreviewPoint(anchor, rawPoint, session.mode);
  const directionSnap = maybeSnapToPreviousDiagonalDirection(floor, session, anchor, orthogonalPoint);
  const rectangleSnap = maybeSnapThirdWallForRectangle(floor, session, anchor, directionSnap.point);
  const resetClosureSnap = maybeSnapResetChainForRectangleClosure(
    floor,
    session,
    anchor,
    rectangleSnap.point
  );
  const directStartClosureSnap = maybeSnapStraightClosureToStart(
    floor,
    session,
    anchor,
    rawPoint,
    resetClosureSnap.point
  );
  let previewPoint = directStartClosureSnap.point;
  let previewMeasurementStartInsetMm = resolvePreviewMeasurementStartInsetMm(
    floor,
    session,
    anchor,
    previewPoint
  );
  let previewMeasurementEndInsetMm = 0;
  let previewLengthMm = calculateMeasuredPreviewLength(
    anchor,
    previewPoint,
    previewMeasurementStartInsetMm,
    previewMeasurementEndInsetMm
  );
  let previewMeasurementSide = resolveBoundaryAlignedMeasurementSide(floor, session, anchor, previewPoint);
  const activeWallCount = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  if (activeWallCount === 0 && session.activeSpaceSharedWallId) {
    session.measurementSide = previewMeasurementSide;
  }

  session.state = 'wallPreview';
  session.previewPoint = previewPoint;
  session.previewLengthMm = previewLengthMm;
  session.previewAngleDeg = angleDeg(anchor, previewPoint);
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = previewMeasurementSide;
  session.previewMeasurementStartInsetMm = previewMeasurementStartInsetMm;
  session.previewMeasurementEndInsetMm = previewMeasurementEndInsetMm;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = directStartClosureSnap.guide || resetClosureSnap.guide || rectangleSnap.guide || directionSnap.guide;

  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const minimumClosureWallCount = getMinimumClosureSuggestionWallCount(floor, session);
  if (activeStartNode && activeWallCount + 1 >= minimumClosureWallCount) {
    const sharedProjection = findAnySharedWallClosureProjection(floor, session, previewPoint);
    if (sharedProjection) {
      if (
        session.mode === 'straight' &&
        sharedProjection.node &&
        distanceMm(previewPoint, sharedProjection.point) <= CLOSE_TOLERANCE_MM
      ) {
        previewPoint = sharedProjection.point;
        previewMeasurementStartInsetMm = resolvePreviewMeasurementStartInsetMm(
          floor,
          session,
          anchor,
          previewPoint
        );
        previewMeasurementSide = resolveBoundaryAlignedMeasurementSide(
          floor,
          session,
          anchor,
          previewPoint
        );
        session.previewPoint = previewPoint;
        session.previewLengthMm = previewLengthMm;
        session.previewAngleDeg = angleDeg(anchor, previewPoint);
        session.previewMeasurementSide = previewMeasurementSide;
        if (!session.alignmentSnapGuide && distanceMm(previewPoint, rawPoint) > 0) {
          session.alignmentSnapGuide = {
            type: 'rectangle-third-wall',
            direction: isHorizontalSegment(anchor, previewPoint) ? 'vertical' : 'horizontal',
            referencePoint: { xMm: sharedProjection.node.xMm, yMm: sharedProjection.node.yMm },
            snappedPoint: { xMm: previewPoint.xMm, yMm: previewPoint.yMm }
          };
        }
      }
      session.closeCandidatePoint = sharedProjection.point;
      session.closeCandidateType = 'shared-wall';
      session.closeCandidateSharedWallId = sharedProjection.wall.id;
      previewMeasurementEndInsetMm = resolveMeasurementEndInsetMm(
        floor,
        anchor,
        previewPoint,
        sharedProjection.wall.id
      );
    } else if (distanceMm(previewPoint, activeStartNode) <= CLOSE_TOLERANCE_MM) {
      session.closeCandidateNodeId = activeStartNode.id;
      session.closeCandidateType = 'start';
    } else {
      const mergeCandidate = findMergeClosureCandidate(floor, session, previewPoint);
      if (mergeCandidate) {
        session.closeCandidateNodeId = mergeCandidate.id;
        session.closeCandidateType = 'merge';
      }
    }
  }

  session.previewMeasurementStartInsetMm = previewMeasurementStartInsetMm;
  session.previewMeasurementEndInsetMm = previewMeasurementEndInsetMm;
  session.previewLengthMm = calculateMeasuredPreviewLength(
    anchor,
    previewPoint,
    previewMeasurementStartInsetMm,
    previewMeasurementEndInsetMm
  );

  return touchDraft(next);
}

function holdPreviewForInput(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor.session;

  if (session.state !== 'wallPreview' || !session.previewPoint || session.previewLengthMm < MIN_WALL_LENGTH_MM) {
    return next;
  }

  session.state = 'awaitingLength';
  return touchDraft(next);
}

function applyPreviewInteriorAngle(draft, interiorAngleDeg, source) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const anchor = getNode(floor, session.anchorNodeId);
  const incomingWall = getIncomingWallAtAnchor(floor, session.anchorNodeId);
  const incomingAngle = getIncomingAngleAtAnchor(floor, incomingWall, session.anchorNodeId);
  const angle = validateInteriorAngle(interiorAngleDeg);

  if (!anchor || !session.previewPoint || !session.previewLengthMm || session.mode !== 'diagonal' || incomingAngle === null) {
    throw new Error('A connected diagonal preview is required before measuring its angle');
  }

  const currentAngle = angleDeg(anchor, session.previewPoint);
  const turn = normalizeSignedAngle(currentAngle - incomingAngle);
  const turnSign = turn < 0 ? -1 : 1;
  const outgoingAngle = incomingAngle + turnSign * (180 - angle);
  const radians = outgoingAngle * Math.PI / 180;
  const nextPoint = {
    xMm: Math.round(anchor.xMm + Math.cos(radians) * session.previewLengthMm),
    yMm: Math.round(anchor.yMm + Math.sin(radians) * session.previewLengthMm)
  };

  const previewed = startPreview(next, nextPoint);
  const previewSession = getActiveFloor(previewed).session;
  previewSession.state = 'awaitingLength';
  previewSession.previewAngleSource = source || 'manual';
  previewSession.previewInteriorAngleDeg = angle;
  return touchDraft(previewed);
}

function reopenLastDiagonalWallForAngle(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const lastWall = floor.walls[floor.walls.length - 1];
  const hasAttachedOpening = lastWall && floor.openings.some((opening) => opening.wallId === lastWall.id);

  if (!lastWall || lastWall.mode !== 'diagonal' || floor.walls.length < 2 ||
    session.state !== 'wallCommitted' || session.previewPoint || hasAttachedOpening) {
    throw new Error('Only the latest unadorned diagonal wall can be remeasured by angle');
  }

  const start = getNode(floor, lastWall.startNodeId);
  const end = getNode(floor, lastWall.endNodeId);
  if (!start || !end) {
    throw new Error('The latest diagonal wall is incomplete');
  }

  floor.walls.pop();
  if (!floor.walls.some((wall) => wall.startNodeId === end.id || wall.endNodeId === end.id)) {
    floor.nodes = floor.nodes.filter((node) => node.id !== end.id);
  }
  session.anchorNodeId = start.id;
  session.mode = 'diagonal';
  session.state = 'awaitingLength';
  session.previewPoint = { xMm: end.xMm, yMm: end.yMm };
  session.previewLengthMm = lastWall.lengthMm;
  session.previewAngleDeg = lastWall.angleDeg;
  session.previewAngleSource = lastWall.angleSource || 'manual';
  session.previewInteriorAngleDeg = Number.isFinite(lastWall.angleInteriorDeg)
    ? lastWall.angleInteriorDeg
    : null;
  session.previewMeasurementSide = lastWall.measurementSide || session.measurementSide;
  session.previewMeasurementStartInsetMm = normalizeMeasurementInset(
    lastWall.measurementStartInsetMm
  );
  session.previewMeasurementEndInsetMm = normalizeMeasurementInset(
    lastWall.measurementEndInsetMm
  );
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;

  return touchDraft(next);
}

function cancelPending(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.selectedWallId = '';
  session.selectedOpeningId = '';

  if (floor.spaces.some((space) => space.closed)) {
    session.state = 'spaceClosed';
    session.anchorNodeId = '';
  } else if (floor.walls.length) {
    const lastEnd = getLastEndNode(floor);
    session.state = 'wallCommitted';
    session.anchorNodeId = lastEnd ? lastEnd.id : '';
  } else if (session.anchorNodeId) {
    session.state = 'cursorPlaced';
  } else {
    session.state = 'idle';
  }

  return touchDraft(next);
}

function commitPreviewLength(draft, lengthMm, inputSource) {
  const parsedLength = validateLength(lengthMm);
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const anchor = getNode(floor, session.anchorNodeId);

  if (!anchor || !session.previewPoint || (session.state !== 'awaitingLength' && session.state !== 'wallPreview')) {
    throw new Error('请先拖出待确认墙体');
  }

  let endPoint = pointFromLength(
    anchor,
    session.previewPoint,
    parsedLength,
    session.previewMeasurementStartInsetMm,
    session.previewMeasurementEndInsetMm
  );
  // Length confirmation (manual or BLE) rebuilds the endpoint from the
  // measured value. Reapply rectangle/closure snapping here so confirmation
  // cannot silently discard a snap that was visible during the drag preview.
  const confirmedRectangleSnap = maybeSnapThirdWallForRectangle(
    floor,
    session,
    anchor,
    endPoint
  );
  const confirmedResetClosureSnap = maybeSnapResetChainForRectangleClosure(
    floor,
    session,
    anchor,
    confirmedRectangleSnap.point
  );
  endPoint = confirmedResetClosureSnap.point;
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWallCountBeforeCommit = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  const minimumClosureWallCount = getMinimumClosureSuggestionWallCount(floor, session);
  const canCloseWithSharedBoundary = activeWallCountBeforeCommit + 1 >= minimumClosureWallCount;
  const sharedProjection = canCloseWithSharedBoundary
    ? findAnySharedWallClosureProjection(floor, session, endPoint)
    : null;
  const isClosingCurrentSpace = activeStartNode &&
    (activeWallCountBeforeCommit >= 2 || !!sharedProjection) &&
    (sharedProjection || distanceMm(endPoint, activeStartNode) <= CLOSE_TOLERANCE_MM);
  if (sharedProjection) {
    endPoint = sharedProjection.point;
  }
  const measurementStartInsetMm = normalizeMeasurementInset(
    session.previewMeasurementStartInsetMm
  );
  const measurementEndInsetMm = sharedProjection
    ? resolveMeasurementEndInsetMm(
      floor,
      anchor,
      endPoint,
      sharedProjection.wall.id
    )
    : normalizeMeasurementInset(session.previewMeasurementEndInsetMm);
  const shortenLastWall = canShortenLastWall(
    floor,
    session,
    anchor,
    endPoint,
    isClosingCurrentSpace
  );
  const ignoredWallIds = isClosingCurrentSpace
    ? floor.walls.slice(0, session.activeSpaceStartWallIndex).map((wall) => wall.id)
    : [];
  if (!shortenLastWall && findOverlappingWall(floor, anchor, endPoint, { ignoredWallIds })) {
    throw new Error('当前墙与已测墙重叠，请从光标转角继续测量');
  }

  const measurementSide = session.previewMeasurementSide ||
    resolveBoundaryAlignedMeasurementSide(floor, session, anchor, endPoint);
  if (activeWallCountBeforeCommit === 0 && session.activeSpaceSharedWallId) {
    session.measurementSide = measurementSide;
  }
  const extendLastWall = canExtendLastWall(
    floor,
    session,
    anchor,
    endPoint,
    measurementSide,
    isClosingCurrentSpace
  );
  let endNode;
  let wall;
  if (extendLastWall || shortenLastWall) {
    wall = getLastWall(floor);
    anchor.xMm = Math.round(endPoint.xMm);
    anchor.yMm = Math.round(endPoint.yMm);
    endNode = anchor;
    wall.lengthMm = getMeasuredWallLength(floor, wall);
    wall.angleDeg = angleDeg(getNode(floor, wall.startNodeId), endNode);
    wall.inputSource = inputSource || 'manual';
    wall.measuredAt = nowIso();
  } else {
    endNode = sharedProjection ? getOrCreateSnapNode(floor, sharedProjection) : addNode(floor, endPoint);
    wall = {
      id: nextId('wall'),
      startNodeId: anchor.id,
      endNodeId: endNode.id,
      mode: session.mode,
      lengthMm: Math.max(
        0,
        distanceMm(anchor, endNode) - measurementStartInsetMm - measurementEndInsetMm
      ),
      angleDeg: angleDeg(anchor, endNode),
      thicknessMm: session.thicknessMm,
      measurementSide,
      measurementStartInsetMm,
      measurementEndInsetMm,
      inputSource: inputSource || 'manual',
      angleSource: session.previewAngleSource || '',
      angleInteriorDeg: session.previewInteriorAngleDeg,
      status: 'confirmed',
      measuredAt: nowIso()
    };
    floor.walls.push(wall);
  }
  session.anchorNodeId = endNode.id;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;

  const activeWallCount = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  if (sharedProjection && activeWallCount >= 1) {
    session.state = 'closing';
    if (!session.activeSpaceSharedWallId) {
      session.activeSpaceSharedWallId = sharedProjection.wall.id;
    }
    session.closeCandidateNodeId = endNode.id;
    session.closeCandidatePoint = sharedProjection.point;
    session.closeCandidateType = 'shared-wall';
    session.closeCandidateSharedWallId = sharedProjection.wall.id;
  } else if (activeStartNode && activeWallCount >= 3 && distanceMm(endNode, activeStartNode) <= CLOSE_TOLERANCE_MM) {
    session.state = 'closing';
    session.closeCandidateNodeId = activeStartNode.id;
    session.closeCandidateType = 'start';
  } else {
    const minimumMergeWallCount = getMinimumClosureSuggestionWallCount(floor, session);
    const mergeCandidate = activeWallCount >= minimumMergeWallCount
      ? findMergeClosureCandidate(floor, session, endNode)
      : null;
    if (mergeCandidate) {
      session.state = 'mergeClosing';
      session.closeCandidateNodeId = mergeCandidate.id;
      session.closeCandidateType = 'merge';
    } else {
      session.state = 'wallCommitted';
    }
  }

  return touchDraft(next);
}

function confirmClosure(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const hasPreviewCloseCandidate = !!(
    session.previewPoint &&
    session.previewLengthMm >= MIN_WALL_LENGTH_MM &&
    (session.closeCandidateNodeId || session.closeCandidatePoint) &&
    (session.state === 'wallPreview' || session.state === 'awaitingLength')
  );

  if (hasPreviewCloseCandidate) {
    const committed = commitPreviewLength(
      next,
      session.previewLengthMm,
      'closure-preview'
    );
    const committedState = getActiveFloor(committed).session.state;
    if (committedState !== 'closing' && committedState !== 'mergeClosing') {
      throw new Error('当前轮廓不能安全闭合，请继续补测墙体');
    }
    return confirmClosure(committed);
  }

  if (session.state === 'mergeClosing') {
    const anchor = getNode(floor, session.anchorNodeId);
    const closurePlan = findMergeClosurePlan(floor, session, anchor);
    const closeTargetNode = closurePlan && closurePlan.targetNode;
    if (!anchor || !closeTargetNode || closurePlan.points.length < 2) {
      throw new Error('当前轮廓不能安全闭合，请继续补测墙体');
    }

    const closurePoints = closurePlan.points;
    const finalConnectorStart = closurePoints.length > 2
      ? closurePoints[closurePoints.length - 2]
      : null;
    const activeSharedWall = getWall(floor, session.activeSpaceSharedWallId);
    const activeSharedStart = activeSharedWall ? getNode(floor, activeSharedWall.startNodeId) : null;
    const activeSharedEnd = activeSharedWall ? getNode(floor, activeSharedWall.endNodeId) : null;
    const finalConnectorFollowsSharedWall = !!(
      finalConnectorStart &&
      activeSharedStart &&
      activeSharedEnd &&
      (
        isHorizontalSegment(finalConnectorStart, closeTargetNode) ===
          isHorizontalSegment(activeSharedStart, activeSharedEnd)
      )
    );

    let closureStartNode = anchor;
    closurePlan.points.slice(1).forEach((point, index, points) => {
      const closureEndNode = index === points.length - 1
        ? closeTargetNode
        : addNode(floor, point);
      let measurementEndInsetMm = index === points.length - 1
        ? resolveMeasurementEndInsetMm(
          floor,
          closureStartNode,
          closureEndNode,
          session.activeSpaceSharedWallId
        )
        : 0;
      if (index === points.length - 2 && finalConnectorFollowsSharedWall) {
        const targetAlignedStart = {
          xMm: closeTargetNode.xMm + closureStartNode.xMm - closureEndNode.xMm,
          yMm: closeTargetNode.yMm + closureStartNode.yMm - closureEndNode.yMm
        };
        measurementEndInsetMm = resolveMeasurementEndInsetMm(
          floor,
          targetAlignedStart,
          closeTargetNode,
          session.activeSpaceSharedWallId
        );
      }
      const measurementSide = resolveBoundaryAlignedMeasurementSide(
        floor,
        session,
        closureStartNode,
        closureEndNode
      );
      const extendLastWall = index === 0 && canExtendLastWall(
        floor,
        session,
        closureStartNode,
        closureEndNode,
        measurementSide,
        false
      );
      if (extendLastWall) {
        const lastWall = getLastWall(floor);
        lastWall.endNodeId = closureEndNode.id;
        lastWall.measurementEndInsetMm = measurementEndInsetMm;
        lastWall.lengthMm = getMeasuredWallLength(floor, lastWall);
        lastWall.angleDeg = angleDeg(getNode(floor, lastWall.startNodeId), closureEndNode);
        lastWall.inputSource = 'closure-merge';
        lastWall.measuredAt = nowIso();
      } else {
        floor.walls.push({
          id: nextId('wall'),
          startNodeId: closureStartNode.id,
          endNodeId: closureEndNode.id,
          mode: session.mode,
          lengthMm: Math.max(
            0,
            distanceMm(closureStartNode, closureEndNode) - measurementEndInsetMm
          ),
          angleDeg: angleDeg(closureStartNode, closureEndNode),
          thicknessMm: session.thicknessMm,
          measurementSide,
          measurementStartInsetMm: 0,
          measurementEndInsetMm,
          inputSource: 'closure-merge',
          status: 'confirmed',
          measuredAt: nowIso()
        });
      }
      closureStartNode = closureEndNode;
    });
    session.anchorNodeId = closeTargetNode.id;
    session.state = 'closing';
    session.closeCandidateNodeId = closeTargetNode.id;
    session.closeCandidatePoint = null;
    session.closeCandidateType = 'merge';
    session.closeCandidateSharedWallId = '';
  }

  const startWallIndex = session.activeSpaceStartWallIndex || 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  const closeCandidateSharedWallId = session.closeCandidateSharedWallId;
  const hasSharedBoundary = !!(session.activeSpaceSharedWallId || closeCandidateSharedWallId);
  const minimumActiveWallCount = session.activeSpaceSharedWallId
    ? getMinimumClosureSuggestionWallCount(floor, session)
    : (hasSharedBoundary ? 2 : 3);

  if (session.state !== 'closing' || (!session.closeCandidateNodeId && !session.closeCandidatePoint) || activeWallCount < minimumActiveWallCount) {
    return next;
  }

  const lastWall = getLastWall(floor);
  const oldEndNodeId = lastWall.endNodeId;
  const oldEndNode = getNode(floor, oldEndNodeId);
  let closeTargetNode = getNode(floor, session.closeCandidateNodeId);
  if (!closeTargetNode && session.closeCandidatePoint && closeCandidateSharedWallId) {
    const sharedWall = getWall(floor, closeCandidateSharedWallId);
    const sharedStart = sharedWall ? getNode(floor, sharedWall.startNodeId) : null;
    const sharedEnd = sharedWall ? getNode(floor, sharedWall.endNodeId) : null;
    const projection = projectPointToWallSegment(session.closeCandidatePoint, sharedStart, sharedEnd);
    if (projection) {
      projection.wall = sharedWall;
      projection.start = sharedStart;
      projection.end = sharedEnd;
      if (projection.t <= 0.0001) projection.node = sharedStart;
      if (projection.t >= 0.9999) projection.node = sharedEnd;
      closeTargetNode = getOrCreateSnapNode(floor, projection);
      session.closeCandidateNodeId = closeTargetNode ? closeTargetNode.id : '';
    }
  }
  if (!oldEndNode || !closeTargetNode || distanceMm(oldEndNode, closeTargetNode) > CLOSE_TOLERANCE_MM) {
    throw new Error(`闭合误差超过 ${CLOSE_TOLERANCE_MM} mm，请补测最后一面墙`);
  }

  lastWall.endNodeId = session.closeCandidateNodeId;
  refreshWallMetrics(floor);

  const newWallIds = floor.walls.slice(startWallIndex).map((wall) => wall.id);
  const excludedWallIds = {};
  newWallIds.forEach((wallId) => { excludedWallIds[wallId] = true; });

  const sharedBoundaryWallIds = [
    session.activeSpaceSharedWallId,
    closeCandidateSharedWallId
  ].filter((wallId, index, list) => wallId && list.indexOf(wallId) === index);

  let sharedStartNodeId = session.activeSpaceStartNodeId;
  let sharedCloseNodeId = closeTargetNode.id;
  if (session.activeSpaceSharedWallId && session.activeSpaceStartNodeId) {
    const activeStartNode = getNode(floor, session.activeSpaceStartNodeId);
    const sharedStartNode = getOrCreateWallCenterNode(floor, session.activeSpaceSharedWallId, activeStartNode);
    if (sharedStartNode) sharedStartNodeId = sharedStartNode.id;
  }
  if (closeCandidateSharedWallId) {
    const sharedCloseNode = getOrCreateWallCenterNode(floor, closeCandidateSharedWallId, closeTargetNode);
    if (sharedCloseNode) sharedCloseNodeId = sharedCloseNode.id;
  }

  if (sharedBoundaryWallIds.length && session.activeSpaceStartNodeId) {
    sharedBoundaryWallIds.forEach((wallId) => {
      const sharedWall = getWall(floor, wallId);
      const sharedStart = sharedWall ? getNode(floor, sharedWall.startNodeId) : null;
      const sharedEnd = sharedWall ? getNode(floor, sharedWall.endNodeId) : null;
      const splitNodeIds = [sharedStartNodeId, sharedCloseNodeId].filter((nodeId) => {
        const node = getNode(floor, nodeId);
        const projection = projectPointToWallSegment(node, sharedStart, sharedEnd);
        return projection && projection.distanceMm <= CLOSE_TOLERANCE_MM;
      });
      splitWallAtNodes(floor, wallId, splitNodeIds);
    });
  }

  const sharedWallIds = session.activeSpaceStartNodeId
    ? findWallPathBetweenNodes(floor, sharedCloseNodeId, sharedStartNodeId, excludedWallIds)
    : [];
  if (sharedBoundaryWallIds.length && !sharedWallIds.length && !closeCandidateSharedWallId) {
    throw new Error('公共边未连通，请从相邻墙边重新吸附光标');
  }

  const wallIds = newWallIds.concat(sharedWallIds.length ? sharedWallIds : sharedBoundaryWallIds);
  const hasSameSpace = floor.spaces.some((space) => {
    if (!space.closed || !Array.isArray(space.wallIds) || space.wallIds.length !== wallIds.length) return false;
    return space.wallIds.every((wallId, index) => wallId === wallIds[index]);
  });

  if (!hasSameSpace) {
    const roomIndex = floor.spaces.filter((space) => space.closed).length + 1;
    floor.spaces.push({
      id: nextId('space'),
      name: `\u623f\u95f4${roomIndex}`,
      wallIds,
      closed: true,
      source: 'measured'
    });
  }

  session.state = 'spaceClosed';
  session.anchorNodeId = '';
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.alignmentSnapGuide = null;
  session.closedFromNodeId = oldEndNodeId;
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  removeUnreferencedNodes(floor);

  return touchDraft(next);
}

function selectWall(draft, wallId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const wall = getWall(floor, wallId);
  if (!wall) return next;

  floor.session.state = 'wallSelected';
  floor.session.selectedWallId = wallId;
  floor.session.selectedOpeningId = '';
  floor.session.previewPoint = null;
  floor.session.previewLengthMm = 0;
  floor.session.previewAngleDeg = 0;
  floor.session.previewMeasurementStartInsetMm = 0;
  floor.session.previewMeasurementEndInsetMm = 0;
  floor.session.closeCandidateNodeId = '';
  floor.session.closeCandidatePoint = null;
  floor.session.closeCandidateType = '';
  floor.session.closeCandidateSharedWallId = '';
  floor.session.alignmentSnapGuide = null;
  return touchDraft(next);
}

function selectOpening(draft, openingId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const opening = getOpening(floor, openingId);
  if (!opening || !getWall(floor, opening.wallId)) return next;

  floor.session.state = 'wallSelected';
  floor.session.selectedWallId = opening.wallId;
  floor.session.selectedOpeningId = opening.id;
  floor.session.previewPoint = null;
  floor.session.previewLengthMm = 0;
  floor.session.previewAngleDeg = 0;
  floor.session.previewMeasurementStartInsetMm = 0;
  floor.session.previewMeasurementEndInsetMm = 0;
  floor.session.closeCandidateNodeId = '';
  floor.session.closeCandidatePoint = null;
  floor.session.closeCandidateType = '';
  floor.session.closeCandidateSharedWallId = '';
  floor.session.alignmentSnapGuide = null;
  return touchDraft(next);
}

function addOpeningToWall(draft, wallId, type) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const wall = getWall(floor, wallId || floor.session.selectedWallId);
  if (!wall) {
    throw new Error('Please select a wall before adding an opening');
  }

  const openingType = type === 'window' ? 'window' : 'door';
  const widthMm = openingType === 'window' ? DEFAULT_WINDOW_WIDTH_MM : DEFAULT_DOOR_WIDTH_MM;
  const opening = {
    id: nextId('opening'),
    wallId: wall.id,
    type: openingType,
    centerOffsetMm: Math.round((wall.lengthMm || 0) / 2),
    widthMm,
    heightMm: openingType === 'window' ? DEFAULT_WINDOW_HEIGHT_MM : DEFAULT_DOOR_HEIGHT_MM,
    sillHeightMm: openingType === 'window' ? DEFAULT_WINDOW_SILL_HEIGHT_MM : 0,
    openDirection: openingType === 'door' ? 'inside' : '',
    modelId: openingType === 'window' ? 'window-flat-basic' : 'door-single-basic',
    modelCategory: openingType === 'window' ? 'flat-window' : 'single-door',
    materialId: openingType === 'window' ? 'dark-gray' : 'warm-white',
    depthMm: wall.thicknessMm || DEFAULT_OPENING_DEPTH_MM,
    entryDoor: false,
    source: 'manual',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  normalizeOpeningToWall(floor, opening);
  normalizeOpeningDirection(opening);
  ensureOpenings(floor).push(opening);
  floor.session.state = 'wallSelected';
  floor.session.selectedWallId = wall.id;
  floor.session.selectedOpeningId = opening.id;
  return touchDraft(next);
}

function updateOpening(draft, openingId, patch) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const opening = getOpening(floor, openingId || floor.session.selectedOpeningId);
  if (!opening) {
    throw new Error('Please select a door or window first');
  }

  const updates = patch || {};
  if (Object.prototype.hasOwnProperty.call(updates, 'widthMm')) {
    opening.widthMm = validateOpeningSize(updates.widthMm, 'opening width');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'heightMm')) {
    opening.heightMm = validateOpeningSize(updates.heightMm, 'opening height');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'sillHeightMm')) {
    const parsedSill = Number(updates.sillHeightMm);
    if (!Number.isInteger(parsedSill) || parsedSill < 0) {
      throw new Error('opening sill height must be an integer >= 0 mm');
    }
    opening.sillHeightMm = parsedSill;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'depthMm')) {
    opening.depthMm = validateOpeningDepth(updates.depthMm);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'centerOffsetMm')) {
    const parsedOffset = Number(updates.centerOffsetMm);
    if (!Number.isInteger(parsedOffset)) {
      throw new Error('opening offset must be an integer');
    }
    opening.centerOffsetMm = parsedOffset;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'openDirection') && opening.type === 'door') {
    opening.openDirection = updates.openDirection === 'outside' ? 'outside' : 'inside';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'modelId')) {
    opening.modelId = String(updates.modelId || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'modelCategory')) {
    opening.modelCategory = String(updates.modelCategory || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'materialId')) {
    opening.materialId = String(updates.materialId || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'entryDoor') && opening.type === 'door') {
    const nextEntryDoor = !!updates.entryDoor;
    ensureOpenings(floor).forEach((item) => {
      if (item.type === 'door') {
        item.entryDoor = nextEntryDoor && item.id === opening.id;
      }
    });
  }

  normalizeOpeningToWall(floor, opening);
  normalizeOpeningDirection(opening);
  opening.updatedAt = nowIso();
  floor.session.state = 'wallSelected';
  floor.session.selectedWallId = opening.wallId;
  floor.session.selectedOpeningId = opening.id;
  return touchDraft(next);
}

function deleteOpening(draft, openingId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const targetId = openingId || floor.session.selectedOpeningId;
  const opening = getOpening(floor, targetId);
  if (!opening) return next;

  floor.openings = ensureOpenings(floor).filter((item) => item.id !== targetId);
  floor.session.state = 'wallSelected';
  floor.session.selectedWallId = opening.wallId;
  floor.session.selectedOpeningId = '';
  return touchDraft(next);
}

function deleteWall(draft, wallId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const targetId = wallId || session.selectedWallId;
  const wall = getWall(floor, targetId);
  if (!wall) return next;

  const wallIndex = floor.walls.findIndex((item) => item.id === targetId);
  const activeStartWallIndex = session.activeSpaceStartWallIndex;
  const deletesClosedSpaceWall = (floor.spaces || []).some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(targetId) !== -1
  ));
  // Removing only the current chain's tail leaves a valid in-progress path.
  // Preserve its start so the preceding wall can still use rectangle alignment.
  const preserveActiveChain = !deletesClosedSpaceWall &&
    wallIndex === floor.walls.length - 1 &&
    wallIndex >= activeStartWallIndex &&
    wallIndex > activeStartWallIndex;
  const deletedStartNode = getNode(floor, wall.startNodeId);
  floor.walls = floor.walls.filter((item) => item.id !== targetId);
  floor.openings = ensureOpenings(floor).filter((opening) => opening.wallId !== targetId);
  floor.spaces = (floor.spaces || []).filter((space) => {
    return !Array.isArray(space.wallIds) || space.wallIds.indexOf(targetId) === -1;
  });

  refreshWallMetrics(floor);

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.closedFromNodeId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  // A deleted wall invalidates the previous cursor/wall snap. Keeping it lets
  // resetCursor restore a node that no longer belongs to the edited chain.
  session.lastWallSnapNodeId = '';
  session.lastWallSnapWallId = '';
  session.lastWallSnapT = null;
  session.lastWallSnapLine = '';
  if (!preserveActiveChain) {
    session.activeSpaceStartNodeId = '';
    session.activeSpaceStartWallIndex = floor.walls.length;
    session.activeSpaceSharedWallId = '';
    session.activeSpaceSharedStartT = null;
    session.activeSpaceSharedSnapLine = '';
  }

  if (floor.walls.length) {
    const lastEnd = getLastEndNode(floor);
    session.anchorNodeId = lastEnd ? lastEnd.id : '';
    session.state = 'wallCommitted';
  } else if (deletedStartNode) {
    session.anchorNodeId = deletedStartNode.id;
    session.state = 'cursorPlaced';
  } else {
    session.anchorNodeId = '';
    session.state = 'idle';
  }

  removeUnreferencedNodes(floor);
  return touchDraft(next);
}

function startWallSnap(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

  session.state = 'wallSnapPending';
  session.anchorNodeId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';

  return touchDraft(next);
}

function snapCursorToWall(draft, point, target) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const projection = findTargetWallProjection(floor, point, target) || findWallSnapProjection(floor, point);
  // Outer-edge hit testing is a presentation/measurement-side choice. The
  // graph itself is centerline-topological, so keep the snapped node on the
  // source wall centerline; otherwise preview closure points use the centerline
  // while the anchor remains one wall thickness away and the chain disconnects.
  const topologyProjection = projection && projection.snapLine === 'outer' && !projection.node
    ? Object.assign({}, projectPointToWallSegment(projection.point, projection.start, projection.end), {
      wall: projection.wall,
      start: projection.start,
      end: projection.end,
      snapLine: 'inner'
    })
    : projection;
  const node = getOrCreateSnapNode(floor, topologyProjection);

  if (!node) return next;

  session.state = 'cursorPlaced';
  session.anchorNodeId = node.id;
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.activeSpaceStartNodeId = node.id;
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = projection.wall.id;
  session.activeSpaceSharedStartT = projection.t;
  session.activeSpaceSharedSnapLine = projection.snapLine || 'inner';
  session.lastWallSnapNodeId = node.id;
  session.lastWallSnapWallId = projection.wall.id;
  session.lastWallSnapT = projection.t;
  session.lastWallSnapLine = projection.snapLine || 'inner';

  return touchDraft(next);
}

function startRemeasure(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const wall = getWall(floor, floor.session.selectedWallId);
  if (!wall) {
    return next;
  }

  floor.session.state = 'remeasureAwaitingInput';
  const existingFixed = floor.session.fixedNodeId;
  const isWallEndpoint = existingFixed === wall.startNodeId || existingFixed === wall.endNodeId;
  if (!isWallEndpoint) {
    const sharedEndpoint = getSingleSharedEndpoint(floor, wall);
    floor.session.fixedNodeId = sharedEndpoint ? sharedEndpoint.fixedNodeId : wall.startNodeId;
  }
  return touchDraft(next);
}

function setFixedNode(draft, nodeId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  floor.session.fixedNodeId = nodeId;
  return touchDraft(next);
}

function remeasureSelectedWall(draft, lengthMm, inputSource) {
  const parsedLength = validateLength(lengthMm);
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor.session;
  const wall = getWall(floor, session.selectedWallId);
  if (!wall || session.state !== 'remeasureAwaitingInput') {
    throw new Error('请先选择需要复尺的墙体');
  }

  const sharedEndpoint = getSingleSharedEndpoint(floor, wall);
  const fixedNodeId = session.fixedNodeId || (sharedEndpoint ? sharedEndpoint.fixedNodeId : wall.startNodeId);
  const movingNodeId = fixedNodeId === wall.startNodeId ? wall.endNodeId : wall.startNodeId;
  const fixedNode = getNode(floor, fixedNodeId);
  const movingNode = getNode(floor, movingNodeId);
  const currentLength = distanceMm(fixedNode, movingNode);
  const safeLength = currentLength || 1;
  const dx = (movingNode.xMm - fixedNode.xMm) / safeLength;
  const dy = (movingNode.yMm - fixedNode.yMm) / safeLength;

  const insets = getWallMeasurementInsets(wall);
  const coordinateLength = parsedLength + insets.start + insets.end;
  movingNode.xMm = Math.round(fixedNode.xMm + dx * coordinateLength);
  movingNode.yMm = Math.round(fixedNode.yMm + dy * coordinateLength);
  wall.inputSource = inputSource || 'manual';
  wall.measuredAt = nowIso();

  refreshWallMetrics(floor);
  normalizeOpeningsForWall(floor, wall.id);

  if (floor.spaces.some((space) => space.closed)) {
    session.state = 'spaceClosed';
    session.anchorNodeId = '';
    session.selectedWallId = wall.id;
  } else {
    session.state = 'wallCommitted';
    session.anchorNodeId = movingNodeId;
    session.selectedWallId = '';
  }

  session.selectedOpeningId = '';
  return touchDraft(next);
}

function setMeasurementSide(draft, side, wallId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const targetSide = side === 'left' ? 'left' : 'right';
  const targetWallId = wallId || floor.session.selectedWallId;
  const wall = targetWallId ? getWall(floor, targetWallId) : null;

  // The measuring edge establishes the convention for a free-standing wall
  // chain. A chain snapped to an existing boundary inherits that boundary side.
  if (!canSetInitialMeasurementSide(floor, floor.session, wall && wall.id)) return next;

  floor.session.measurementSide = targetSide;
  if (floor.session.previewPoint) {
    floor.session.previewMeasurementSide = targetSide;
  }
  if (wall) {
    wall.measurementSide = targetSide;
  }

  return touchDraft(next);
}

function canSetInitialMeasurementSide(floor, session, wallId) {
  if (!floor || !session) return false;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  const firstWall = floor.walls[startWallIndex] || null;

  if (session.activeSpaceSharedWallId) {
    const startsFromClosedBoundary = !!findClosedSpaceForWall(floor, session.activeSpaceSharedWallId);
    const previewStage = startsFromClosedBoundary &&
      activeWallCount === 0 &&
      !!session.previewPoint &&
      (session.state === 'wallPreview' || session.state === 'awaitingLength');
    const committedStage = startsFromClosedBoundary &&
      activeWallCount === 1 &&
      !!firstWall &&
      (!wallId || wallId === firstWall.id) &&
      (session.state === 'wallCommitted' || session.state === 'mergeClosing') &&
      !session.previewPoint;
    return previewStage || committedStage;
  }

  return !!(
    firstWall &&
    (!wallId || wallId === firstWall.id) &&
    floor.walls.length === startWallIndex + 1 &&
    session.state === 'wallCommitted' &&
    !session.previewPoint
  );
}

function placeNewWallChainCursor(draft, point) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const node = addNode(floor, point);

  session.state = 'cursorPlaced';
  session.anchorNodeId = node.id;
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.activeSpaceStartNodeId = node.id;
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  session.lastWallSnapNodeId = '';
  session.lastWallSnapWallId = '';
  session.lastWallSnapT = null;
  session.lastWallSnapLine = '';
  return touchDraft(next);
}

function setThickness(draft, thicknessMm, wallId) {
  const parsedThickness = validateThickness(thicknessMm);
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const targetWallId = wallId || floor.session.selectedWallId;
  const wall = targetWallId ? getWall(floor, targetWallId) : null;

  floor.session.thicknessMm = parsedThickness;
  next.settings.defaultThicknessMm = parsedThickness;
  if (wall) {
    wall.thicknessMm = parsedThickness;
  }

  return touchDraft(next);
}

function resetCursor(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';

  const lastSnapNode = session.lastWallSnapNodeId ? getNode(floor, session.lastWallSnapNodeId) : null;
  const lastSnapWall = session.lastWallSnapWallId ? getWall(floor, session.lastWallSnapWallId) : null;
  if (lastSnapNode && lastSnapWall) {
    session.state = 'cursorPlaced';
    session.anchorNodeId = lastSnapNode.id;
    session.activeSpaceStartNodeId = lastSnapNode.id;
    session.activeSpaceStartWallIndex = floor.walls.length;
    session.activeSpaceSharedWallId = lastSnapWall.id;
    session.activeSpaceSharedStartT = typeof session.lastWallSnapT === 'number'
      ? session.lastWallSnapT
      : pointAlongWall(floor, lastSnapWall, lastSnapNode.id) /
        Math.max(1, getWallCoordinateLength(floor, lastSnapWall));
    session.activeSpaceSharedSnapLine = session.lastWallSnapLine || 'inner';
    return touchDraft(next);
  }

  if (floor.spaces.some((space) => space.closed)) {
    session.state = 'spaceClosed';
    session.anchorNodeId = '';
    return touchDraft(next);
  }

  if (floor.walls.length) {
    const lastEnd = getLastEndNode(floor);
    session.anchorNodeId = lastEnd ? lastEnd.id : '';
    session.state = 'wallCommitted';
    return touchDraft(next);
  }

  const anchor = session.anchorNodeId ? getNode(floor, session.anchorNodeId) : null;
  if (anchor) {
    anchor.xMm = 0;
    anchor.yMm = 0;
  } else {
    const node = addNode(floor, { xMm: 0, yMm: 0 });
    session.anchorNodeId = node.id;
  }
  session.state = 'cursorPlaced';
  return touchDraft(next);
}

function updateViewport(draft, viewportPatch) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  floor.viewport = Object.assign({}, floor.viewport, viewportPatch || {});
  return touchDraft(next);
}

function buildSpaceBoundaryPoints(floor, wallIds) {
  const forward = traceClosedSpaceWallChain(floor, wallIds, false);
  const chain = forward.length ? forward : traceClosedSpaceWallChain(floor, wallIds, true);
  if (!chain.length) return [];
  return chain.map((entry) => entry.start);
}

function buildSpaceWallFaceSegments(floor, wallIds) {
  const chain = buildClosedSpaceWallChain(floor, wallIds);
  const centroid = calculateBoundaryCentroid(floor, wallIds);
  if (!chain.length || !centroid) return [];

  return chain.map((entry) => {
    // Closure may persist a short topology bridge whose entire coordinate
    // length is consumed by a measurement inset. It represents the thickness
    // connection to a shared wall, not an additional clear-room boundary.
    if (getMeasuredWallLength(floor, entry.wall) <= 0) return null;
    const base = buildBaseWallSegment(floor, entry.wall);
    if (!base) return null;
    const midpoint = {
      xMm: (base.start.xMm + base.end.xMm) / 2,
      yMm: (base.start.yMm + base.end.yMm) / 2
    };
    const centroidOffset = dot({
      x: centroid.xMm - midpoint.xMm,
      y: centroid.yMm - midpoint.yMm
    }, base.normal);
    // A physical wall is emitted once between its topology face and offset
    // face.  For a shared wall, the two spaces sit on opposite sides and must
    // therefore select opposite inner faces from the same wall object.
    const usesOffsetFace = centroidOffset > 0;
    let innerStart = usesOffsetFace ? base.outerStart : base.start;
    let innerEnd = usesOffsetFace ? base.outerEnd : base.end;
    let oppositeStart = usesOffsetFace ? base.start : base.outerStart;
    let oppositeEnd = usesOffsetFace ? base.end : base.outerEnd;
    if (entry.reversed) {
      [innerStart, innerEnd] = [innerEnd, innerStart];
      [oppositeStart, oppositeEnd] = [oppositeEnd, oppositeStart];
    }
    return {
      wallId: entry.wall.id,
      wall: entry.wall,
      thicknessMm: base.thicknessMm,
      face: usesOffsetFace ? 'offset' : 'topology',
      innerStart,
      innerEnd,
      oppositeStart,
      oppositeEnd
    };
  }).filter(Boolean);
}

function buildFaceBoundaryPoints(segments, startKey, endKey) {
  if (!Array.isArray(segments) || segments.length < 3) return [];
  const points = segments.map((segment, index) => {
    const previous = segments[(index - 1 + segments.length) % segments.length];
    const previousStart = previous[startKey];
    const previousEnd = previous[endKey];
    const currentStart = segment[startKey];
    const currentEnd = segment[endKey];
    const intersection = intersectLines(previousStart, previousEnd, currentStart, currentEnd);
    if (!intersection) return currentStart;

    const cornerLimit = Math.max(
      Number(previous.thicknessMm) || DEFAULT_THICKNESS_MM,
      Number(segment.thicknessMm) || DEFAULT_THICKNESS_MM,
      CLOSE_TOLERANCE_MM
    ) * 4;
    return distanceMm(intersection, currentStart) <= cornerLimit
      ? intersection
      : currentStart;
  });

  return points.filter((point, index) => (
    index === 0 || !pointsNearlyEqual(point, points[index - 1])
  ));
}

function buildSpaceInnerBoundaryPoints(floor, wallIds) {
  const segments = buildSpaceWallFaceSegments(floor, wallIds);
  const points = buildFaceBoundaryPoints(segments, 'innerStart', 'innerEnd');
  return points.length >= 3 && calculatePolygonAreaMm2(points) > 0
    ? points
    : buildSpaceBoundaryPoints(floor, wallIds);
}

function calculateBoundaryBounds(points) {
  if (!Array.isArray(points) || !points.length) {
    return { widthMm: 0, heightMm: 0 };
  }
  const xs = points.map((point) => Number(point.xMm));
  const ys = points.map((point) => Number(point.yMm));
  return {
    widthMm: Math.round(Math.max(...xs) - Math.min(...xs)),
    heightMm: Math.round(Math.max(...ys) - Math.min(...ys))
  };
}

function buildSpaceDimensionPlan(floor, spaceOrWallIds) {
  const wallIds = Array.isArray(spaceOrWallIds)
    ? spaceOrWallIds
    : (spaceOrWallIds && spaceOrWallIds.wallIds);
  if (!floor || !Array.isArray(wallIds)) return null;
  const faces = buildSpaceWallFaceSegments(floor, wallIds);
  if (faces.length < 3) return null;
  const innerBoundaryPoints = buildFaceBoundaryPoints(faces, 'innerStart', 'innerEnd');
  const outerBoundaryPoints = buildFaceBoundaryPoints(faces, 'oppositeStart', 'oppositeEnd');
  if (innerBoundaryPoints.length < 3 || outerBoundaryPoints.length < 3) return null;
  const innerBounds = calculateBoundaryBounds(innerBoundaryPoints);
  const outerBounds = calculateBoundaryBounds(outerBoundaryPoints);
  return {
    innerBoundaryPoints,
    outerBoundaryPoints,
    inner: Object.assign({}, innerBounds, {
      areaMm2: Math.round(calculatePolygonAreaMm2(innerBoundaryPoints))
    }),
    outer: Object.assign({}, outerBounds, {
      areaMm2: Math.round(calculatePolygonAreaMm2(outerBoundaryPoints))
    }),
    wallThicknessSegments: faces.map((face) => {
      const start = {
        xMm: (face.innerStart.xMm + face.innerEnd.xMm) / 2,
        yMm: (face.innerStart.yMm + face.innerEnd.yMm) / 2
      };
      const end = {
        xMm: (face.oppositeStart.xMm + face.oppositeEnd.xMm) / 2,
        yMm: (face.oppositeStart.yMm + face.oppositeEnd.yMm) / 2
      };
      return {
        wallId: face.wallId,
        kind: 'wall-thickness',
        start,
        end,
        lengthMm: Math.round(distanceMm(start, end))
      };
    })
  };
}

function calculateSpaceAreaMm2(draft, spaceId) {
  const floor = getActiveFloor(draft);
  const closedSpace = floor.spaces.find((space) => (
    space.closed && (!spaceId || space.id === spaceId)
  ));
  if (!closedSpace) return 0;
  const plan = buildSpaceDimensionPlan(floor, closedSpace);
  return plan ? plan.inner.areaMm2 : 0;
}

module.exports = {
  DEFAULT_THICKNESS_MM,
  DEFAULT_SCALE,
  CLOSE_TOLERANCE_MM,
  MIN_WALL_LENGTH_MM,
  MIN_THICKNESS_MM,
  createSurveyDraft,
  cloneDraft,
  getActiveFloor,
  getNode,
  getWall,
  getOpening,
  getWallSnapPoint,
  getCursorPlacementTarget,
  distanceMm,
  angleDeg,
  buildWallSnapGeometry,
  buildWallRenderGeometry,
  buildWallJoinRenderGeometries,
  buildSpaceBoundaryPoints,
  buildSpaceInnerBoundaryPoints,
  buildSpaceDimensionPlan,
  getClosurePath,
  getMinimumClosureSuggestionWallCount,
  calculateSpaceAreaMm2,
  setMode,
  placeCursor,
  placeNewWallChainCursor,
  startPreview,
  holdPreviewForInput,
  applyPreviewInteriorAngle,
  reopenLastDiagonalWallForAngle,
  cancelPending,
  commitPreviewLength,
  confirmClosure,
  selectWall,
  selectOpening,
  addOpeningToWall,
  updateOpening,
  deleteOpening,
  deleteWall,
  startWallSnap,
  snapCursorToWall,
  startRemeasure,
  remeasureSelectedWall,
  setFixedNode,
  setMeasurementSide,
  canSetInitialMeasurementSide,
  setThickness,
  resetCursor,
  updateViewport
};
