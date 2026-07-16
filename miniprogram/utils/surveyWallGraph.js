const DEFAULT_THICKNESS_MM = 200;
const DEFAULT_SCALE = 0.05;
const CLOSE_TOLERANCE_MM = 350;
const RECTANGLE_ALIGNMENT_TOLERANCE_MM = CLOSE_TOLERANCE_MM;
const MIN_WALL_LENGTH_MM = 100;
const MIN_THICKNESS_MM = 50;
const WALL_OVERLAP_TOLERANCE_MM = 30;
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
    previewMeasurementSide: ''
  };
}

function createSurveyDraft() {
  const timestamp = nowIso();
  return {
    schemaVersion: 1,
    kind: 'survey-wall-graph',
    status: 'prototype',
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

function hasClosedSpace(floor) {
  return !!(floor && floor.spaces && floor.spaces.some((space) => space.closed));
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

function resolveAdjacentWalls(floor, wall, options) {
  const opts = options || {};
  const hasPrevious = Object.prototype.hasOwnProperty.call(opts, 'previousWall');
  const hasNext = Object.prototype.hasOwnProperty.call(opts, 'nextWall');
  const index = floor.walls.findIndex((item) => item.id === wall.id);
  const closed = hasClosedSpace(floor);
  let previousWall = null;
  let nextWall = null;

  if (hasPrevious) {
    previousWall = opts.previousWall;
  } else if (index > 0) {
    previousWall = floor.walls[index - 1];
  } else if (closed && floor.walls.length > 1) {
    previousWall = floor.walls[floor.walls.length - 1];
  }

  if (hasNext) {
    nextWall = opts.nextWall;
  } else if (index >= 0 && index < floor.walls.length - 1) {
    nextWall = floor.walls[index + 1];
  } else if (closed && floor.walls.length > 1) {
    nextWall = floor.walls[0];
  }

  return { previousWall, nextWall };
}

function buildResolvedSegment(floor, wall, options) {
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
  const normal = wall.measurementSide === 'left' ? leftNormal : rightNormal;
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

function resolveBoundaryAlignedMeasurementSide(floor, session, start, end) {
  if (!floor || !session || !start || !end) return session ? session.measurementSide : 'left';
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (activeWallCount !== 0 || !session.activeSpaceSharedWallId || !session.activeSpaceSharedSnapLine) {
    return session.measurementSide;
  }

  const sourceWall = getWall(floor, session.activeSpaceSharedWallId);
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

function findMergeClosureCandidate(floor, session, endPoint) {
  if (!floor || !session || !endPoint) return null;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWalls = (floor.walls || []).slice(startWallIndex);
  const anchor = getNode(floor, session.anchorNodeId);
  const includesPreview = !!session.previewPoint;
  const requiredWallCount = activeWalls.length + (includesPreview ? 1 : 0);

  if (!activeStartNode || !anchor || requiredWallCount < 3 || distanceMm(endPoint, activeStartNode) < MIN_WALL_LENGTH_MM) {
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
  if (calculatePolygonAreaMm2(outlinePoints) < MIN_CLOSED_SPACE_AREA_MM2) return null;

  const segments = (floor.walls || []).map((wall) => ({
    start: getNode(floor, wall.startNodeId),
    end: getNode(floor, wall.endNodeId)
  }));
  if (includesPreview) {
    segments.push({ start: anchor, end: endPoint });
  }

  const intersectsExistingWall = segments.some((segment) => (
    segment.start && segment.end && hasClosureInteriorIntersection(endPoint, activeStartNode, segment.start, segment.end)
  ));
  return intersectsExistingWall ? null : activeStartNode;
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
  const previous = adjacent.previousWall ? buildResolvedSegment(floor, adjacent.previousWall, adjacentOptions) : null;
  const next = adjacent.nextWall ? buildResolvedSegment(floor, adjacent.nextWall, adjacentOptions) : null;
  const startJoined = !!(previous && pointsNearlyEqual(previous.end, current.start));
  const endJoined = !!(next && pointsNearlyEqual(next.start, current.end));
  const outerStart = (startJoined && offsetJoinPoint(current, previous)) || current.outerStart;
  const outerEnd = (endJoined && offsetJoinPoint(current, next)) || current.outerEnd;

  return {
    start: current.start,
    end: current.end,
    lengthMm: current.lengthMm,
    angleDeg: angleDeg(current.start, current.end),
    startJoined,
    endJoined,
    startOpen: !startJoined,
    endOpen: !endJoined,
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
  if (activeWallCount !== 2) {
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

function pointFromLength(anchor, previewPoint, lengthMm) {
  const dx = previewPoint.xMm - anchor.xMm;
  const dy = previewPoint.yMm - anchor.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length === 0) {
    return { xMm: anchor.xMm + lengthMm, yMm: anchor.yMm };
  }

  return {
    xMm: Math.round(anchor.xMm + dx / length * lengthMm),
    yMm: Math.round(anchor.yMm + dy / length * lengthMm)
  };
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
    wall.lengthMm = distanceMm(start, end);
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
    inputSource: sourceWall.inputSource || 'manual',
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
    const centerOffset = opening.centerOffsetMm || 0;
    const target = segments.find((segment) => (
      centerOffset >= segment.startAlongMm - 1 &&
      centerOffset <= segment.endAlongMm + 1
    )) || segments[segments.length - 1];
    if (!target) return;
    opening.wallId = target.wall.id;
    opening.centerOffsetMm = Math.round(centerOffset - target.startAlongMm);
    normalizeOpeningToWall(floor, opening);
    normalizeOpeningDirection(opening);
  });
}

function splitWallAtNodes(floor, wallId, cutNodeIds) {
  const wallIndex = floor.walls.findIndex((wall) => wall.id === wallId);
  const originalWall = floor.walls[wallIndex];
  if (wallIndex === -1 || !originalWall) return { sharedWallId: wallId, segmentIds: [wallId] };

  const wallLength = originalWall.lengthMm || distanceMm(
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
  const rectangleSnap = maybeSnapThirdWallForRectangle(floor, session, anchor, orthogonalPoint);
  const previewPoint = rectangleSnap.point;
  const previewLengthMm = distanceMm(anchor, previewPoint);
  const previewMeasurementSide = resolveBoundaryAlignedMeasurementSide(floor, session, anchor, previewPoint);

  session.state = 'wallPreview';
  session.previewPoint = previewPoint;
  session.previewLengthMm = previewLengthMm;
  session.previewAngleDeg = angleDeg(anchor, previewPoint);
  session.previewMeasurementSide = previewMeasurementSide;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = rectangleSnap.guide;

  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWallCount = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  if (activeStartNode && activeWallCount >= 2) {
    const sharedProjection = findSharedWallClosureProjection(floor, session, previewPoint);
    if (sharedProjection) {
      session.closeCandidatePoint = sharedProjection.point;
      session.closeCandidateType = 'shared-wall';
      session.closeCandidateSharedWallId = sharedProjection.wall.id;
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

function cancelPending(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
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

  let endPoint = pointFromLength(anchor, session.previewPoint, parsedLength);
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWallCountBeforeCommit = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  const canCloseWithSharedBoundary = activeWallCountBeforeCommit >= 2 ||
    (activeWallCountBeforeCommit >= 1 && !!session.activeSpaceSharedWallId);
  const sharedProjection = canCloseWithSharedBoundary
    ? findAnySharedWallClosureProjection(floor, session, endPoint)
    : null;
  const isClosingCurrentSpace = activeStartNode &&
    (activeWallCountBeforeCommit >= 2 || !!sharedProjection) &&
    (sharedProjection || distanceMm(endPoint, activeStartNode) <= CLOSE_TOLERANCE_MM);
  if (sharedProjection) {
    endPoint = sharedProjection.point;
  }
  const ignoredWallIds = isClosingCurrentSpace
    ? floor.walls.slice(0, session.activeSpaceStartWallIndex).map((wall) => wall.id)
    : [];
  if (findOverlappingWall(floor, anchor, endPoint, { ignoredWallIds })) {
    throw new Error('当前墙与已测墙重叠，请从光标转角继续测量');
  }

  const endNode = sharedProjection ? getOrCreateSnapNode(floor, sharedProjection) : addNode(floor, endPoint);
  const measurementSide = session.previewMeasurementSide ||
    resolveBoundaryAlignedMeasurementSide(floor, session, anchor, endNode);
  const wall = {
    id: nextId('wall'),
    startNodeId: anchor.id,
    endNodeId: endNode.id,
    mode: session.mode,
    lengthMm: distanceMm(anchor, endNode),
    angleDeg: angleDeg(anchor, endNode),
    thicknessMm: session.thicknessMm,
    measurementSide,
    inputSource: inputSource || 'manual',
    status: 'confirmed',
    measuredAt: nowIso()
  };

  floor.walls.push(wall);
  session.anchorNodeId = endNode.id;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;

  const activeWallCount = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  if (sharedProjection && activeWallCount >= 2) {
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
    const mergeCandidate = findMergeClosureCandidate(floor, session, endNode);
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

  if (session.state === 'mergeClosing') {
    const anchor = getNode(floor, session.anchorNodeId);
    const closeTargetNode = findMergeClosureCandidate(floor, session, anchor);
    if (!anchor || !closeTargetNode) {
      throw new Error('当前轮廓不能安全闭合，请继续补测墙体');
    }

    floor.walls.push({
      id: nextId('wall'),
      startNodeId: anchor.id,
      endNodeId: closeTargetNode.id,
      mode: session.mode,
      lengthMm: distanceMm(anchor, closeTargetNode),
      angleDeg: angleDeg(anchor, closeTargetNode),
      thicknessMm: session.thicknessMm,
      measurementSide: resolveBoundaryAlignedMeasurementSide(floor, session, anchor, closeTargetNode),
      inputSource: 'closure-merge',
      status: 'confirmed',
      measuredAt: nowIso()
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
  const closeCandidateSharedWallId = session.closeCandidateSharedWallId || session.activeSpaceSharedWallId;
  const hasSharedBoundary = !!(session.activeSpaceSharedWallId || closeCandidateSharedWallId);
  const minimumActiveWallCount = hasSharedBoundary ? 2 : 3;

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
      splitWallAtNodes(floor, wallId, [
        sharedStartNodeId,
        sharedCloseNodeId
      ]);
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
    source: 'prototype',
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
  const session = floor.session;
  const targetId = wallId || session.selectedWallId;
  const wall = getWall(floor, targetId);
  if (!wall) return next;

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
  session.pendingWallId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.closedFromNodeId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';

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

function snapCursorToWall(draft, point) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const projection = findWallSnapProjection(floor, point);
  const node = getOrCreateSnapNode(floor, projection);

  if (!node) return next;

  session.state = 'cursorPlaced';
  session.anchorNodeId = node.id;
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
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

  movingNode.xMm = Math.round(fixedNode.xMm + dx * parsedLength);
  movingNode.yMm = Math.round(fixedNode.yMm + dy * parsedLength);
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

  floor.session.measurementSide = targetSide;
  if (wall) {
    wall.measurementSide = targetSide;
  }

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
    session.activeSpaceSharedStartT = typeof session.lastWallSnapT === 'number' ? session.lastWallSnapT : pointAlongWall(floor, lastSnapWall, lastSnapNode.id) / Math.max(1, lastSnapWall.lengthMm || 1);
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

function calculateSpaceAreaMm2(draft) {
  const floor = getActiveFloor(draft);
  const closedSpace = floor.spaces.find((space) => space.closed);
  if (!closedSpace) return 0;

  const points = buildSpaceBoundaryPoints(floor, closedSpace.wallIds);

  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const nextPoint = points[(i + 1) % points.length];
    area += current.xMm * nextPoint.yMm - nextPoint.xMm * current.yMm;
  }
  return Math.round(Math.abs(area) / 2);
}

function buildSpaceBoundaryPoints(floor, wallIds) {
  if (!Array.isArray(wallIds) || !wallIds.length) return [];
  const firstWall = getWall(floor, wallIds[0]);
  if (!firstWall) return [];
  const firstStart = getNode(floor, firstWall.startNodeId);
  const firstEnd = getNode(floor, firstWall.endNodeId);
  if (!firstStart || !firstEnd) return [];

  const points = [firstStart, firstEnd];
  let currentNodeId = firstWall.endNodeId;

  for (let index = 1; index < wallIds.length; index += 1) {
    const wall = getWall(floor, wallIds[index]);
    if (!wall) continue;
    let nextNodeId = '';
    if (wall.startNodeId === currentNodeId) {
      nextNodeId = wall.endNodeId;
    } else if (wall.endNodeId === currentNodeId) {
      nextNodeId = wall.startNodeId;
    } else {
      const currentNode = getNode(floor, currentNodeId);
      const startNode = getNode(floor, wall.startNodeId);
      const endNode = getNode(floor, wall.endNodeId);
      nextNodeId = distanceMm(currentNode, startNode) <= distanceMm(currentNode, endNode)
        ? wall.endNodeId
        : wall.startNodeId;
    }
    const nextNode = getNode(floor, nextNodeId);
    if (nextNode) points.push(nextNode);
    currentNodeId = nextNodeId;
  }

  if (points.length > 1 && distanceMm(points[0], points[points.length - 1]) <= 1) {
    points.pop();
  }
  return points;
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
  distanceMm,
  angleDeg,
  buildWallSnapGeometry,
  buildWallRenderGeometry,
  buildWallJoinRenderGeometries,
  buildSpaceBoundaryPoints,
  calculateSpaceAreaMm2,
  setMode,
  placeCursor,
  startPreview,
  holdPreviewForInput,
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
  setThickness,
  resetCursor,
  updateViewport
};
