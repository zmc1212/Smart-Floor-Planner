const DEFAULT_THICKNESS_MM = 200;
const DEFAULT_SCALE = 0.08;
const CLOSE_TOLERANCE_MM = 200;
const MIN_WALL_LENGTH_MM = 100;
const MIN_THICKNESS_MM = 50;

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
    measurementSide: 'right',
    pendingWallId: '',
    selectedWallId: '',
    closeCandidateNodeId: ''
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

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return Math.round(normalized * 10) / 10;
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
  const session = floor.session;

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
  session.closeCandidateNodeId = '';
  return touchDraft(next);
}

function startPreview(draft, rawPoint) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor.session;
  let anchor = getNode(floor, session.anchorNodeId);

  if (!anchor) {
    anchor = addNode(floor, rawPoint);
    session.anchorNodeId = anchor.id;
  }

  const previewPoint = snapPreviewPoint(anchor, rawPoint, session.mode);
  const previewLengthMm = distanceMm(anchor, previewPoint);

  session.state = 'wallPreview';
  session.previewPoint = previewPoint;
  session.previewLengthMm = previewLengthMm;
  session.previewAngleDeg = angleDeg(anchor, previewPoint);
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.closeCandidateNodeId = '';

  if (floor.walls.length >= 2) {
    const firstNode = getFirstNode(floor);
    if (distanceMm(previewPoint, firstNode) <= CLOSE_TOLERANCE_MM) {
      session.closeCandidateNodeId = firstNode.id;
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
  const session = floor.session;

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.pendingWallId = '';
  session.closeCandidateNodeId = '';
  session.selectedWallId = '';

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
  const session = floor.session;
  const anchor = getNode(floor, session.anchorNodeId);

  if (!anchor || !session.previewPoint || (session.state !== 'awaitingLength' && session.state !== 'wallPreview')) {
    throw new Error('请先拖出待确认墙体');
  }

  const endPoint = pointFromLength(anchor, session.previewPoint, parsedLength);
  const endNode = addNode(floor, endPoint);
  const wall = {
    id: nextId('wall'),
    startNodeId: anchor.id,
    endNodeId: endNode.id,
    mode: session.mode,
    lengthMm: distanceMm(anchor, endNode),
    angleDeg: angleDeg(anchor, endNode),
    thicknessMm: session.thicknessMm,
    measurementSide: session.measurementSide,
    inputSource: inputSource || 'manual',
    status: 'confirmed',
    measuredAt: nowIso()
  };

  floor.walls.push(wall);
  session.anchorNodeId = endNode.id;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.closeCandidateNodeId = '';

  const firstNode = getFirstNode(floor);
  if (floor.walls.length >= 3 && distanceMm(endNode, firstNode) <= CLOSE_TOLERANCE_MM) {
    session.state = 'closing';
    session.closeCandidateNodeId = firstNode.id;
  } else {
    session.state = 'wallCommitted';
  }

  return touchDraft(next);
}

function confirmClosure(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor.session;

  if (session.state !== 'closing' || !session.closeCandidateNodeId || floor.walls.length < 3) {
    return next;
  }

  const lastWall = getLastWall(floor);
  const oldEndNodeId = lastWall.endNodeId;
  lastWall.endNodeId = session.closeCandidateNodeId;
  refreshWallMetrics(floor);

  if (!floor.spaces.some((space) => space.closed)) {
    floor.spaces.push({
      id: nextId('space'),
      name: '未命名空间',
      wallIds: floor.walls.map((wall) => wall.id),
      closed: true,
      source: 'measured'
    });
  }

  session.state = 'spaceClosed';
  session.anchorNodeId = '';
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.closeCandidateNodeId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.closedFromNodeId = oldEndNodeId;
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
  floor.session.previewPoint = null;
  floor.session.previewLengthMm = 0;
  floor.session.previewAngleDeg = 0;
  floor.session.closeCandidateNodeId = '';
  return touchDraft(next);
}

function startRemeasure(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  if (!floor.session.selectedWallId || !getWall(floor, floor.session.selectedWallId)) {
    return next;
  }

  floor.session.state = 'remeasureAwaitingInput';
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

  const startNode = getNode(floor, wall.startNodeId);
  const endNode = getNode(floor, wall.endNodeId);
  const currentLength = distanceMm(startNode, endNode);
  const safeLength = currentLength || 1;
  const dx = (endNode.xMm - startNode.xMm) / safeLength;
  const dy = (endNode.yMm - startNode.yMm) / safeLength;

  endNode.xMm = Math.round(startNode.xMm + dx * parsedLength);
  endNode.yMm = Math.round(startNode.yMm + dy * parsedLength);
  wall.inputSource = inputSource || 'manual';
  wall.measuredAt = nowIso();

  refreshWallMetrics(floor);

  if (floor.spaces.some((space) => space.closed)) {
    session.state = 'spaceClosed';
  } else {
    const lastEnd = getLastEndNode(floor);
    session.state = 'wallCommitted';
    session.anchorNodeId = lastEnd ? lastEnd.id : '';
  }

  session.selectedWallId = wall.id;
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
  const session = floor.session;

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.pendingWallId = '';
  session.closeCandidateNodeId = '';
  session.selectedWallId = '';

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

  const points = closedSpace.wallIds.map((wallId) => {
    const wall = getWall(floor, wallId);
    return wall ? getNode(floor, wall.startNodeId) : null;
  }).filter(Boolean);

  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const nextPoint = points[(i + 1) % points.length];
    area += current.xMm * nextPoint.yMm - nextPoint.xMm * current.yMm;
  }
  return Math.round(Math.abs(area) / 2);
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
  distanceMm,
  angleDeg,
  calculateSpaceAreaMm2,
  setMode,
  placeCursor,
  startPreview,
  holdPreviewForInput,
  cancelPending,
  commitPreviewLength,
  confirmClosure,
  selectWall,
  startRemeasure,
  remeasureSelectedWall,
  setMeasurementSide,
  setThickness,
  resetCursor,
  updateViewport
};
