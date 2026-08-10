const surveyGraph = require('../../../utils/surveyWallGraph.js');
const dimensionLayout = require('./surveyDimensionPlan.js');
const wallSolidLayout = require('./surveyWallSolidPlan.js');

// The editor reference uses a fine, quiet drafting grid: one small square is
// 250mm at the default 0.05px/mm viewport (12.5px on a 390px canvas). Keeping
// this separate from the wall graph scale means the grid remains a visual aid,
// not a second measurement system.
const GRID_MINOR_MM = 250;
const GRID_MAJOR_MM = 1250;
const MIN_WALL_THICKNESS_PX = 1.5;
const WALL_STROKE_PX = 1.5;
const REDLINE_STROKE_PX = 2;
const GUIDE_STROKE_PX = 1.25;
// Blue coordinate, cursor, and snap guides need a denser cadence than the
// green closure cue so they remain easy to track across the full workspace.
const BLUE_GUIDE_DASH_PX = [8, 6];
const CLOSURE_GUIDE_DASH_PX = [12, 10];
const DIMENSION_LABEL_BACKGROUND = 'rgba(210, 210, 210, 0.96)';
const DIMENSION_LABEL_COLOR = '#0077d7';
const DIMENSION_LABEL_PADDING_X = 4;
const DIMENSION_LABEL_HEIGHT_PX = 18;
const DIMENSION_ENDPOINT_TICK_PX = 8;
// Keep dimension lines clear of the measured wall, with extension lines
// bridging the deliberate drafting gap from each wall end.
const DIMENSION_GAP_PX = 32;
const DIMENSION_OUTER_GAP_PX = 28;
const DIMENSION_COLLISION_GAP_PX = 6;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distancePx(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function boxesOverlap(first, second, padding) {
  const gap = padding || 0;
  return !(
    first.right + gap < second.left ||
    first.left - gap > second.right ||
    first.bottom + gap < second.top ||
    first.top - gap > second.bottom
  );
}

function normalizeAngleDiff(currentAngle, previousAngle) {
  const diff = Math.abs(((currentAngle - previousAngle + 540) % 360) - 180);
  return Math.round(diff);
}

function resolveViewport(viewport) {
  return Object.assign({
    scale: surveyGraph.DEFAULT_SCALE,
    offsetX: 0,
    offsetY: 0
  }, viewport || {});
}

function resolveRect(rect) {
  return Object.assign({ width: 0, height: 0 }, rect || {});
}

function createProjector(viewport, rect) {
  const vp = resolveViewport(viewport);
  const box = resolveRect(rect);
  return function project(point) {
    return {
      x: box.width / 2 + vp.offsetX + point.xMm * vp.scale,
      y: box.height / 2 + vp.offsetY + point.yMm * vp.scale
    };
  };
}

function getVisualThicknessPx(thicknessMm, scale) {
  // Wall faces, outer-edge snap points, cursor axes, and closure geometry all
  // describe the same millimetre coordinates. Keep the visible wall thickness
  // on that scale as well; a fixed pixel clamp makes the wall face drift away
  // from a correctly projected outer-edge snap as the viewport zoom changes.
  const rawThickness = (thicknessMm || surveyGraph.DEFAULT_THICKNESS_MM) * scale;
  return Math.max(MIN_WALL_THICKNESS_PX, rawThickness);
}

function buildRenderThicknessMmMap(floor, viewport) {
  const scale = viewport.scale || surveyGraph.DEFAULT_SCALE;
  const thicknessMap = {};
  (floor.walls || []).forEach((wall) => {
    thicknessMap[wall.id] = getVisualThicknessPx(wall.thicknessMm, scale) / scale;
  });
  return thicknessMap;
}

function localPointToCanvas(wall, x, y) {
  return {
    x: wall.startPoint.x + wall.direction.x * x + wall.localY.x * y,
    y: wall.startPoint.y + wall.direction.y * x + wall.localY.y * y
  };
}

function createBoundingBox(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min.apply(null, xs),
    right: Math.max.apply(null, xs),
    top: Math.min.apply(null, ys),
    bottom: Math.max.apply(null, ys)
  };
}

function createLabelBox(wall, y, label) {
  const width = Math.max(34, String(label).length * 8 + 16);
  const height = DIMENSION_LABEL_HEIGHT_PX;
  const centerX = wall.widthPx / 2;
  const corners = [
    { x: centerX - width / 2, y: y - height / 2 },
    { x: centerX + width / 2, y: y - height / 2 },
    { x: centerX + width / 2, y: y + height / 2 },
    { x: centerX - width / 2, y: y + height / 2 }
  ].map((point) => localPointToCanvas(wall, point.x, point.y));

  return Object.assign(createBoundingBox(corners), {
    width,
    height
  });
}

function createDimensionOptions(wall, priority) {
  const innerSign = wall.measurementSide === 'left' ? 1 : -1;
  const outerSign = typeof wall.closedOutsideSign === 'number'
    ? wall.closedOutsideSign
    : -innerSign;
  const innerLabel = `${Math.round(wall.lengthMm || 0)}`;
  const outerLabel = `${Math.round(wall.outerLengthMm || wall.lengthMm || 0)}`;
  
  const configs = [
    {
      kind: 'inner',
      placement: 'inside',
      offset: innerSign * DIMENSION_GAP_PX,
      label: innerLabel,
      startX: 0,
      endX: wall.widthPx,
      startY: 0,
      endY: 0
    },
    {
      kind: 'outer',
      placement: 'outside',
      offset: outerSign * (wall.thicknessPx + DIMENSION_OUTER_GAP_PX),
      label: outerLabel,
      startX: wall.outerStartAlongPx || 0,
      endX: wall.outerEndPx || wall.widthPx,
      startY: outerSign * wall.thicknessPx,
      endY: outerSign * wall.thicknessPx
    },
    {
      kind: 'inner',
      placement: 'inside',
      offset: innerSign * (DIMENSION_GAP_PX + DIMENSION_LABEL_HEIGHT_PX + 10),
      label: innerLabel,
      startX: 0,
      endX: wall.widthPx,
      startY: 0,
      endY: 0
    },
    {
      kind: 'outer',
      placement: 'outside',
      offset: outerSign * (wall.thicknessPx + DIMENSION_OUTER_GAP_PX + DIMENSION_LABEL_HEIGHT_PX + 10),
      label: outerLabel,
      startX: wall.outerStartAlongPx || 0,
      endX: wall.outerEndPx || wall.widthPx,
      startY: outerSign * wall.thicknessPx,
      endY: outerSign * wall.thicknessPx
    },
    // Once a room closes, both values move outside the wall: the measured
    // inside length stays nearer to the wall and the outline length sits beyond it.
    {
      kind: 'inner',
      placement: 'outside',
      offset: outerSign * (wall.thicknessPx + DIMENSION_OUTER_GAP_PX),
      label: innerLabel,
      startX: 0,
      endX: wall.widthPx,
      startY: 0,
      endY: 0
    },
    {
      kind: 'inner',
      placement: 'outside',
      offset: outerSign * (wall.thicknessPx + DIMENSION_OUTER_GAP_PX + (DIMENSION_LABEL_HEIGHT_PX + 10) * 2),
      label: innerLabel,
      startX: 0,
      endX: wall.widthPx,
      startY: 0,
      endY: 0
    },
    {
      kind: 'outer',
      placement: 'outside',
      offset: outerSign * (wall.thicknessPx + DIMENSION_OUTER_GAP_PX + DIMENSION_LABEL_HEIGHT_PX + 10),
      label: outerLabel,
      startX: wall.outerStartAlongPx || 0,
      endX: wall.outerEndPx || wall.widthPx,
      startY: outerSign * wall.thicknessPx,
      endY: outerSign * wall.thicknessPx
    },
    {
      kind: 'outer',
      placement: 'outside',
      offset: outerSign * (wall.thicknessPx + DIMENSION_OUTER_GAP_PX + (DIMENSION_LABEL_HEIGHT_PX + 10) * 3),
      label: outerLabel,
      startX: wall.outerStartAlongPx || 0,
      endX: wall.outerEndPx || wall.widthPx,
      startY: outerSign * wall.thicknessPx,
      endY: outerSign * wall.thicknessPx
    }
  ];

  return configs.map((cfg, index) => {
    const labelBox = createLabelBox(wall, cfg.offset, cfg.label);
    return {
      wall,
      kind: cfg.kind,
      placement: cfg.placement,
      label: cfg.label,
      offset: cfg.offset,
      startX: cfg.startX,
      endX: cfg.endX,
      startY: cfg.startY,
      endY: cfg.endY,
      priority: priority - index,
      labelBox
    };
  });
}

function createClosedDimensionPlan(walls, openings, sourceWalls) {
  const wallById = {};
  (sourceWalls || []).forEach((wall) => { wallById[wall.id] = wall; });
  const plan = dimensionLayout.createExteriorDimensionPlan({
    baseGap: DIMENSION_OUTER_GAP_PX,
    laneGap: DIMENSION_LABEL_HEIGHT_PX + 12,
    groupTolerance: 2,
    walls,
    openings: (openings || []).map((opening) => ({
      id: opening.id,
      wallId: opening.wall && opening.wall.id,
      type: opening.type,
      start: opening.startPx,
      end: opening.endPx
    }))
  });

  return plan.items.map((item) => ({
    id: item.id,
    wall: wallById[item.sourceWallId] || null,
    kind: item.kind,
    placement: 'outside',
    label: item.label,
    lane: item.lane,
    startPoint: item.start,
    endPoint: item.end,
    extensionStart: item.extensionStart,
    extensionEnd: item.extensionEnd
  }));
}

function resolveDimensions(walls, openings, exteriorBoundaryWalls) {
  const dimensions = [];
  const accepted = [];
  const activeWalls = walls.filter((wall) => !wall.lineOnly && wall.isActiveMeasurement && !wall.closed);

  function processGroup(groupOptions) {
    groupOptions.sort((first, second) => second.priority - first.priority);
    groupOptions.forEach((candidate) => {
      const selected = candidate.options.find((option) => {
        return !accepted.some((acceptedOption) => boxesOverlap(option.labelBox, acceptedOption.labelBox, DIMENSION_COLLISION_GAP_PX));
      }) || candidate.options[0];
      accepted.push(selected);
      dimensions.push(selected);
    });
  }

  const innerGroup = [];

  // While measuring, measured values describe only the inside edge. The exterior
  // length is useful only after the space is explicitly closed.
  activeWalls.forEach((wall, index) => {
    const priority = (wall.selected ? 900 : 0) + (index === activeWalls.length - 1 ? 500 : 0) + index;
    const allOptions = createDimensionOptions(wall, priority);
    innerGroup.push({
      wall,
      options: [allOptions[0], allOptions[2]],
      priority
    });
  });

  processGroup(innerGroup);
  dimensions.push(...createClosedDimensionPlan(
    exteriorBoundaryWalls,
    openings,
    walls
  ));

  return dimensions;
}

function buildWallScene(floor, wall, options) {
  const opts = options || {};
  const project = opts.project;
  const viewport = opts.viewport;
  const topologyStart = opts.startPoint || surveyGraph.getNode(floor, wall.startNodeId);
  const topologyEnd = opts.endPoint || surveyGraph.getNode(floor, wall.endNodeId);
  if (!topologyStart || !topologyEnd) return null;

  const geometryOptions = {
    startPoint: opts.startPoint,
    endPoint: opts.endPoint,
    renderThicknessMmMap: opts.renderThicknessMmMap
  };
  if (opts.useExplicitPrevious) {
    geometryOptions.previousWall = opts.previousWall || null;
  }
  if (opts.useExplicitNext) {
    geometryOptions.nextWall = opts.nextWall || null;
  }

  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall, geometryOptions);
  if (!geometry) return null;
  const start = geometry.start;
  const end = geometry.end;
  const startPoint = project(start);
  const endPoint = project(end);
  const widthPx = distancePx(startPoint, endPoint);
  if (!widthPx) return null;

  const direction = {
    x: (endPoint.x - startPoint.x) / widthPx,
    y: (endPoint.y - startPoint.y) / widthPx
  };
  const localY = { x: -direction.y, y: direction.x };
  const outerStart = project(geometry.outerStart);
  const outerEnd = project(geometry.outerEnd);
  const outerOffsetPx = (
    (outerStart.x - startPoint.x) * localY.x +
    (outerStart.y - startPoint.y) * localY.y
  );
  const previousWall = opts.relativePreviousWall || opts.previousWall || null;
  const relativeAngle = previousWall ? normalizeAngleDiff(wall.angleDeg, previousWall.angleDeg) : null;
  // The measurement UI works with the interior angle at a corner, not the
  // directional bearing delta between two wall vectors.
  const interiorAngleDeg = Number.isFinite(wall.angleInteriorDeg)
    ? Math.round(wall.angleInteriorDeg)
    : (relativeAngle === null ? null : 180 - relativeAngle);

  const outerStartAlongPx = geometry ? geometry.outerStartAlongMm * viewport.scale : 0;
  const outerEndPx = geometry ? geometry.outerEndAlongMm * viewport.scale : widthPx;
  const outerLengthMm = Math.round(surveyGraph.distanceMm(geometry.outerStart, geometry.outerEnd));
  const thicknessPx = Math.round(geometry.thicknessMm * viewport.scale);
  const rawOuterStart = {
    x: startPoint.x + localY.x * outerOffsetPx,
    y: startPoint.y + localY.y * outerOffsetPx
  };
  const rawOuterEnd = {
    x: endPoint.x + localY.x * outerOffsetPx,
    y: endPoint.y + localY.y * outerOffsetPx
  };
  const selectionStartPoint = {
    x: startPoint.x,
    y: startPoint.y
  };
  const selectionEndPoint = {
    x: endPoint.x,
    y: endPoint.y
  };
  const selectionOuterStart = {
    x: rawOuterStart.x,
    y: rawOuterStart.y
  };
  const selectionOuterEnd = {
    x: rawOuterEnd.x,
    y: rawOuterEnd.y
  };

  return {
    id: wall.id,
    wall,
    start,
    end,
    topologyStart,
    topologyEnd,
    startPoint,
    endPoint,
    outerStart,
    outerEnd,
    rawOuterStart,
    rawOuterEnd,
    outerStartAlongPx,
    outerEndPx,
    outerLengthMm,
    bodyPolygon: [startPoint, endPoint, outerEnd, outerStart],
    selectionPolygon: [selectionStartPoint, selectionEndPoint, selectionOuterEnd, selectionOuterStart],
    direction,
    localY,
    widthPx,
    angleDeg: geometry.angleDeg,
    angleRad: Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x),
    lengthMm: geometry.lengthMm,
    relativeAngle,
    interiorAngleDeg,
    measurementSide: wall.measurementSide,
    thicknessPx,
    // The measured wall path is the inside face (local y = 0).  Keep the
    // signed offset to its outside face so components can sit on the real
    // wall thickness instead of being drawn around an arbitrary centre line.
    outerOffsetPx,
    centerLineYPx: outerOffsetPx / 2,
    startOpen: geometry.startOpen,
    endOpen: geometry.endOpen,
    startJoined: geometry.startJoined,
    endJoined: geometry.endJoined,
    selected: opts.selectedWallId === wall.id,
    preview: !!opts.preview,
    lineOnly: !!opts.lineOnly
  };
}

function buildJoinFills(floor, renderThicknessMmMap, project, closedWallIds) {
  return surveyGraph.buildWallJoinRenderGeometries(floor, { renderThicknessMmMap })
    .map((join) => ({
      id: join.id,
      points: join.points.map(project),
      closed: !!(join.wallIds && join.wallIds.every((wallId) => closedWallIds[wallId]))
    }));
}

function buildPreviewWall(floor, session, options) {
  if (!session || !session.previewPoint || !session.anchorNodeId) return null;
  const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
  if (!anchor) return null;

  const previewWall = {
    id: 'preview-wall',
    mode: session.mode,
    lengthMm: session.previewLengthMm,
    angleDeg: session.previewAngleDeg,
    angleInteriorDeg: session.previewInteriorAngleDeg,
    thicknessMm: session.thicknessMm,
    measurementSide: session.previewMeasurementSide || session.measurementSide,
    measurementStartInsetMm: session.previewMeasurementStartInsetMm || 0,
    measurementEndInsetMm: session.previewMeasurementEndInsetMm || 0,
    status: 'preview'
  };
  const renderThicknessMmMap = Object.assign({}, options.renderThicknessMmMap, {
    [previewWall.id]: getVisualThicknessPx(previewWall.thicknessMm, options.viewport.scale) / options.viewport.scale
  });

  return buildWallScene(floor, previewWall, Object.assign({}, options, {
    startPoint: anchor,
    endPoint: session.previewPoint,
    previousWall: (floor.walls || [])[floor.walls.length - 1] || null,
    nextWall: null,
    renderThicknessMmMap,
    useExplicitPrevious: true,
    useExplicitNext: true,
    preview: true,
    lineOnly: session.state === 'wallPreview'
  }));
}

function buildClosureGuide(floor, session, project) {
  if (!session || (!session.closeCandidateNodeId && !session.closeCandidatePoint) || (!session.previewPoint && !session.anchorNodeId)) {
    return null;
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  const previewCountsAsWall = !!session.previewPoint;
  const minimumActiveWallCount = surveyGraph.getMinimumClosureSuggestionWallCount(floor, session);
  if (activeWallCount + (previewCountsAsWall ? 1 : 0) < minimumActiveWallCount) {
    return null;
  }

  const closurePath = surveyGraph.getClosurePath(floor, session);
  if (closurePath.length < 2) return null;
  const points = closurePath.map(project);

  return {
    points,
    startPoint: points[0],
    endPoint: points[points.length - 1],
    active: session.state === 'closing' || session.state === 'mergeClosing'
  };
}

function buildAlignmentSnapGuide(session, project) {
  const guide = session && session.alignmentSnapGuide;
  if (!guide || !guide.snappedPoint) {
    return null;
  }

  if (guide.type === 'previous-diagonal-direction' && guide.anchorPoint) {
    return {
      startPoint: project(guide.anchorPoint),
      endPoint: project(guide.snappedPoint)
    };
  }

  if (guide.type !== 'rectangle-third-wall' || !guide.referencePoint) {
    return null;
  }

  return {
    type: guide.type,
    direction: guide.direction,
    snapLine: guide.snapLine || '',
    startPoint: project(guide.referencePoint),
    endPoint: project(guide.snappedPoint)
  };
}

function shouldCloseWholeWallPath(floor, previewWall) {
  if (previewWall) return false;
  const walls = floor.walls || [];
  const closedSpaces = (floor.spaces || []).filter((space) => space.closed && Array.isArray(space.wallIds));
  if (!walls.length || closedSpaces.length !== 1) return false;

  const closedWallIds = closedSpaces[0].wallIds || [];
  if (closedWallIds.length !== walls.length || walls.length < 3) return false;
  return walls.every((wall, index) => wall.id === closedWallIds[index]);
}

function buildOpeningScene(opening, wallScene, session) {
  if (!opening || !wallScene || !wallScene.lengthMm) return null;
  const scale = wallScene.widthPx / wallScene.lengthMm;
  const widthPx = Math.max(10, (opening.widthMm || 0) * scale);
  const centerPx = (opening.centerOffsetMm || 0) * scale;
  const startPx = clamp(centerPx - widthPx / 2, 0, wallScene.widthPx);
  const endPx = clamp(centerPx + widthPx / 2, 0, wallScene.widthPx);
  const centerYPx = wallScene.centerLineYPx || 0;
  const hitHalfHeight = Math.max(18, wallScene.thicknessPx);
  const center = localPointToCanvas(wallScene, centerPx, centerYPx);
  const hitPoints = [
    localPointToCanvas(wallScene, startPx, centerYPx - hitHalfHeight),
    localPointToCanvas(wallScene, endPx, centerYPx - hitHalfHeight),
    localPointToCanvas(wallScene, endPx, centerYPx + hitHalfHeight),
    localPointToCanvas(wallScene, startPx, centerYPx + hitHalfHeight)
  ];

  return {
    id: opening.id,
    opening,
    wall: wallScene,
    type: opening.type,
    startPx,
    endPx,
    centerPx,
    centerYPx,
    widthPx: Math.max(1, endPx - startPx),
    center,
    selected: session && session.selectedOpeningId === opening.id,
    hitPolygon: hitPoints,
    label: opening.type === 'window' ? 'W' : 'D'
  };
}

function buildOpeningScenes(floor, walls, session) {
  const wallMap = {};
  walls.forEach((wall) => {
    wallMap[wall.id] = wall;
  });
  return (floor.openings || [])
    .map((opening) => buildOpeningScene(opening, wallMap[opening.wallId], session))
    .filter(Boolean);
}

function buildCursor(floor, session, project) {
  if (
    !session ||
    !session.anchorNodeId ||
    session.state === 'spaceClosed' ||
    session.state === 'wallSelected' ||
    session.state === 'remeasureAwaitingInput'
  ) {
    return null;
  }

  const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
  if (!anchor) return null;
  return {
    point: project(session.previewPoint || anchor)
  };
}

function buildActiveSegment(walls, previewWall, session) {
  if (!session || session.state === 'spaceClosed') return null;
  if (previewWall) return previewWall;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? Math.max(0, session.activeSpaceStartWallIndex)
    : 0;
  const activeWalls = (walls || []).slice(startWallIndex);
  return activeWalls[activeWalls.length - 1] || null;
}

function calculatePolygonCentroid(points) {
  if (!points || points.length < 3) return null;

  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.xMm * next.yMm - next.xMm * current.yMm;
    area += cross;
    cx += (current.xMm + next.xMm) * cross;
    cy += (current.yMm + next.yMm) * cross;
  }
  area = area / 2;
  if (!area) return null;
  return {
    xMm: cx / (6 * area),
    yMm: cy / (6 * area)
  };
}

function getRoomDetailScale(viewport) {
  const currentScale = (viewport && viewport.scale) || surveyGraph.DEFAULT_SCALE;
  const relativeScale = currentScale / surveyGraph.DEFAULT_SCALE;
  // A square-root curve keeps the room card readable while still making its
  // text and spacing visibly follow pinch zoom.
  return clamp(Math.sqrt(relativeScale), 0.8, 1.45);
}

function buildClosedSpaceLabels(floor, project, viewport) {
  const closedSpaces = (floor.spaces || []).filter((space) => space.closed && Array.isArray(space.wallIds));
  if (!closedSpaces.length) return [];
  const detailScale = getRoomDetailScale(viewport);
  const detailViewportScale = (viewport && viewport.scale) || surveyGraph.DEFAULT_SCALE;

  return closedSpaces.map((space) => {
    const boundaryPoints = surveyGraph.buildSpaceBoundaryPoints(floor, space.wallIds);
    if (!boundaryPoints || boundaryPoints.length < 3) return null;

    const centroidMm = calculatePolygonCentroid(boundaryPoints);
    if (!centroidMm) return null;
    const centroid = project(centroidMm);
    let area = 0;
    for (let index = 0; index < boundaryPoints.length; index += 1) {
      const current = boundaryPoints[index];
      const next = boundaryPoints[(index + 1) % boundaryPoints.length];
      area += current.xMm * next.yMm - next.xMm * current.yMm;
    }
    area = area / 2;

    // Inner dimensions come from the same measured wall lengths shown inside
    // the room. Boundary points can sit on the outside corner after wall joins.
    const walls = space.wallIds
      .map((id) => surveyGraph.getWall(floor, id))
      .filter(Boolean);
    const hWalls = walls.filter((wall) => {
      const angle = Math.abs(wall.angleDeg || 0);
      return angle < 45 || angle > 135;
    });
    const vWalls = walls.filter((wall) => {
      const angle = Math.abs(wall.angleDeg || 0);
      return angle >= 45 && angle <= 135;
    });
    const fallbackWidthMm = Math.round(Math.max.apply(null, boundaryPoints.map((p) => p.xMm)) -
      Math.min.apply(null, boundaryPoints.map((p) => p.xMm)));
    const fallbackHeightMm = Math.round(Math.max.apply(null, boundaryPoints.map((p) => p.yMm)) -
      Math.min.apply(null, boundaryPoints.map((p) => p.yMm)));
    const widthMm = hWalls.length
      ? Math.round(Math.max.apply(null, hWalls.map((wall) => wall.lengthMm || 0)))
      : fallbackWidthMm;
    const heightMm = vWalls.length
      ? Math.round(Math.max.apply(null, vWalls.map((wall) => wall.lengthMm || 0)))
      : fallbackHeightMm;
    const areaM2 = (widthMm && heightMm
      ? widthMm * heightMm / 1000000
      : Math.abs(area) / 1000000).toFixed(1);

    return {
      centroid,
      roomName: space.name || '\u623f\u95f41',
      widthMm,
      heightMm,
      ceilingHeightMm: Math.round(Number(floor.ceilingHeightMm || 2800)),
      areaM2,
      detailScale,
      detailMaxWidthPx: Math.max(0, widthMm * detailViewportScale - 16),
      detailMaxHeightPx: Math.max(0, heightMm * detailViewportScale - 16)
    };
  }).filter(Boolean);
}

function buildClosedSpaceFills(floor, project) {
  return (floor.spaces || []).filter((space) => space.closed && Array.isArray(space.wallIds))
    .map((space) => {
      const boundaryPoints = surveyGraph.buildSpaceBoundaryPoints(floor, space.wallIds);
      if (!boundaryPoints || boundaryPoints.length < 3) return null;
      return {
        id: space.id,
        points: boundaryPoints.map(project)
      };
    })
    .filter(Boolean);
}

function createSurveyRenderScene(input) {
  const floor = input.floor || { walls: [], nodes: [], spaces: [] };
  const session = input.session || floor.session || {};
  const viewport = resolveViewport(input.viewport);
  const rect = resolveRect(input.rect);
  const project = createProjector(viewport, rect);
  const renderThicknessMmMap = buildRenderThicknessMmMap(floor, viewport);
  const closedWallIds = {};
  const closedWallSpaceCounts = {};
  const closedWallCentroids = {};
  (floor.spaces || []).filter((space) => space.closed && Array.isArray(space.wallIds)).forEach((space) => {
    const boundaryPoints = surveyGraph.buildSpaceBoundaryPoints(floor, space.wallIds);
    const centroid = calculatePolygonCentroid(boundaryPoints);
    space.wallIds.forEach((wallId) => {
      closedWallIds[wallId] = true;
      closedWallSpaceCounts[wallId] = (closedWallSpaceCounts[wallId] || 0) + 1;
      if (centroid && !closedWallCentroids[wallId]) {
        closedWallCentroids[wallId] = project(centroid);
      }
    });
  });
  const activeWallStartIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? Math.max(0, Math.min(session.activeSpaceStartWallIndex, (floor.walls || []).length))
    : 0;
  const walls = (floor.walls || []).map((wall, index) => buildWallScene(floor, wall, {
    project,
    viewport,
    renderThicknessMmMap,
    relativePreviousWall: index > 0 ? floor.walls[index - 1] : null,
    selectedWallId: session.selectedWallId
  })).filter(Boolean).map((wall) => {
    const centroid = closedWallCentroids[wall.id];
    const midpoint = {
      x: (wall.startPoint.x + wall.endPoint.x) / 2,
      y: (wall.startPoint.y + wall.endPoint.y) / 2
    };
    const centerOffset = centroid
      ? (centroid.x - midpoint.x) * wall.localY.x + (centroid.y - midpoint.y) * wall.localY.y
      : 0;
    const closedOutsideSign = centroid
      ? (centerOffset >= 0 ? -1 : 1)
      : null;

    return Object.assign(wall, {
      closed: !!closedWallIds[wall.id],
      closedOutsideSign,
      isExteriorBoundary: closedWallSpaceCounts[wall.id] === 1,
      isActiveMeasurement: (floor.walls || []).indexOf(wall.wall) >= activeWallStartIndex && !closedWallIds[wall.id]
    });
  });
  const previewWall = buildPreviewWall(floor, session, {
    project,
    viewport,
    renderThicknessMmMap,
    selectedWallId: session.selectedWallId
  });
  const solidWalls = walls.concat(previewWall && !previewWall.lineOnly ? [previewWall] : []);
  const createSolidPlan = (items) => wallSolidLayout.createWallSolidPlan({
    walls: items.map((wall) => ({
      id: wall.id,
      start: wall.startPoint,
      end: wall.endPoint,
      outerStart: wall.rawOuterStart,
      outerEnd: wall.rawOuterEnd,
      thickness: wall.thicknessPx,
      polygon: [wall.startPoint, wall.endPoint, wall.rawOuterEnd, wall.rawOuterStart]
    }))
  });
  const wallSolidPlan = createSolidPlan(solidWalls);
  const wallSolidPlans = {
    closed: createSolidPlan(solidWalls.filter((wall) => wall.closed)),
    open: createSolidPlan(solidWalls.filter((wall) => !wall.closed))
  };
  const openings = buildOpeningScenes(floor, walls, session);
  const exteriorBoundaryWalls = dimensionLayout.createExteriorBoundarySegments({
    tolerance: 2,
    walls: walls.filter((wall) => !wall.lineOnly && wall.closed).map((wall) => ({
      id: wall.id,
      start: wall.startPoint,
      end: wall.endPoint,
      coordinateLength: wall.widthPx,
      measurementLength: wall.lengthMm,
      thickness: wall.thicknessPx,
      outerStart: wall.outerStart,
      outerEnd: wall.outerEnd
    })),
    spaces: (floor.spaces || []).filter((space) => space.closed)
  });
  const exteriorSourceWallIds = {};
  exteriorBoundaryWalls.forEach((wall) => { exteriorSourceWallIds[wall.sourceWallId] = true; });
  walls.forEach((wall) => { wall.isExteriorBoundary = !!exteriorSourceWallIds[wall.id]; });
  const dimensions = resolveDimensions(walls, openings, exteriorBoundaryWalls);

  return {
    rect,
    viewport,
    walls,
    openings,
    previewWall,
    dimensions,
    activeMeasurementWallIds: walls
      .filter((wall) => wall.isActiveMeasurement)
      .map((wall) => wall.id),
    joinFills: buildJoinFills(floor, renderThicknessMmMap, project, closedWallIds),
    wallSolidPlan,
    wallSolidPlans,
    closureGuide: buildClosureGuide(floor, session, project),
    alignmentSnapGuide: buildAlignmentSnapGuide(session, project),
    cursor: buildCursor(floor, session, project),
    closedSpaceFills: buildClosedSpaceFills(floor, project),
    closedSpaceLabels: buildClosedSpaceLabels(floor, project, viewport),
    activeSegment: buildActiveSegment(walls, previewWall, session),
    closed: shouldCloseWholeWallPath(floor, previewWall),
    session
  };
}

function drawPolygon(ctx, points, fillStyle) {
  if (!points || points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawGrid(ctx, scene) {
  const rect = scene.rect;
  const viewport = scene.viewport;
  const originX = rect.width / 2 + viewport.offsetX;
  const originY = rect.height / 2 + viewport.offsetY;
  const minorStep = Math.max(10, GRID_MINOR_MM * viewport.scale);
  const majorStep = Math.max(minorStep * 4, GRID_MAJOR_MM * viewport.scale);

  ctx.fillStyle = '#fcfffc';
  ctx.fillRect(0, 0, rect.width, rect.height);

  function drawLines(step, color, width) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;

    let x = originX % step;
    if (x < 0) x += step;
    for (; x <= rect.width; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, rect.height);
    }

    let y = originY % step;
    if (y < 0) y += step;
    for (; y <= rect.height; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(rect.width, Math.round(y) + 0.5);
    }

    ctx.stroke();
  }

  drawLines(minorStep, 'rgba(186, 202, 190, 0.12)', 1);
  drawLines(majorStep, 'rgba(161, 177, 166, 0.14)', 1);
}

function drawAxes(ctx, scene) {
  const segment = scene.activeSegment;
  // The cursor owns the active crosshair whenever it is visible. Inset
  // measurement endpoints can intentionally differ from the topology target,
  // so drawing both crosshairs would make the apparent snap drift with zoom.
  if (!segment || !scene.walls.length || (scene.cursor && scene.cursor.point)) return;
  const point = segment.endPoint;

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 126, 220, 0.92)';
  ctx.lineWidth = GUIDE_STROKE_PX;
  if (ctx.setLineDash) ctx.setLineDash(BLUE_GUIDE_DASH_PX);
  ctx.beginPath();
  ctx.moveTo(0, point.y);
  ctx.lineTo(scene.rect.width, point.y);
  ctx.moveTo(point.x, 0);
  ctx.lineTo(point.x, scene.rect.height);
  ctx.stroke();
  if (ctx.setLineDash) ctx.setLineDash([]);
  ctx.restore();
}

function drawClosedSpaceFills(ctx, scene) {
  (scene.closedSpaceFills || []).forEach((space) => {
    drawPolygon(ctx, space.points, 'rgba(209, 209, 207, 0.86)');
  });
}

function drawWallBodies(ctx, scene) {
  const solids = scene.wallSolidPlans || {};
  drawCompoundRings(ctx, solids.closed && solids.closed.rings, '#8e8e8c');
  drawCompoundRings(ctx, solids.open && solids.open.rings, '#e2e2e0');
  scene.walls.forEach((wall) => {
    if (wall.selected) {
      drawPolygon(ctx, wall.selectionPolygon, 'rgba(226, 73, 79, 0.92)');
    }
  });
  if (scene.previewWall && !scene.previewWall.lineOnly &&
      !(scene.wallSolidPlan && scene.wallSolidPlan.rings && scene.wallSolidPlan.rings.length)) {
    drawPolygon(ctx, scene.previewWall.bodyPolygon, 'rgba(226, 226, 224, 0.86)');
  }
}

function drawOuterPath(ctx, walls, closed) {
  const visibleWalls = walls.filter((wall) => !wall.lineOnly);
  if (!visibleWalls.length) return;

  ctx.beginPath();
  visibleWalls.forEach((wall, index) => {
    if (index === 0) {
      ctx.moveTo(wall.outerStart.x, wall.outerStart.y);
    } else {
      const previous = visibleWalls[index - 1];
      if (distancePx(previous.outerEnd, wall.outerStart) > 1.5) {
        ctx.moveTo(wall.outerStart.x, wall.outerStart.y);
      } else {
        ctx.lineTo(wall.outerStart.x, wall.outerStart.y);
      }
    }
    ctx.lineTo(wall.outerEnd.x, wall.outerEnd.y);
  });
  if (closed && visibleWalls.length > 2) {
    ctx.closePath();
  }
  ctx.stroke();
}

function drawWallOutlines(ctx, scene) {
  ctx.save();
  ctx.strokeStyle = '#1f1f1f';
  ctx.lineWidth = WALL_STROKE_PX;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  drawCompoundRings(ctx, scene.wallSolidPlan && scene.wallSolidPlan.rings, null, '#1f1f1f', WALL_STROKE_PX);
  if (scene.previewWall && scene.previewWall.lineOnly) {
    ctx.beginPath();
    ctx.moveTo(scene.previewWall.startPoint.x, scene.previewWall.startPoint.y);
    ctx.lineTo(scene.previewWall.endPoint.x, scene.previewWall.endPoint.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRedlinePath(ctx, walls, color, closed) {
  if (!walls.length) return;
  ctx.beginPath();
  walls.forEach((wall, index) => {
    if (index === 0) {
      ctx.moveTo(wall.startPoint.x, wall.startPoint.y);
    } else {
      const previous = walls[index - 1];
      if (distancePx(previous.endPoint, wall.startPoint) > 1.5) {
        ctx.moveTo(wall.startPoint.x, wall.startPoint.y);
      } else {
        ctx.lineTo(wall.startPoint.x, wall.startPoint.y);
      }
    }
    ctx.lineTo(wall.endPoint.x, wall.endPoint.y);
  });
  if (closed && walls.length > 2) {
    ctx.closePath();
  }
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawRedlines(ctx, scene) {
  ctx.save();
  ctx.lineWidth = REDLINE_STROKE_PX;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 2;
  const measuringWalls = scene.walls.filter((wall) => wall.isActiveMeasurement);
  drawRedlinePath(ctx, measuringWalls, '#d71920', false);

  if (scene.previewWall) {
    drawRedlinePath(ctx, [scene.previewWall], scene.previewWall.lineOnly ? '#f07a21' : '#d71920');
  }
  ctx.restore();
}

function drawSelectedWallHighlight(ctx, scene) {
  const selectedWall = (scene.walls || []).find((wall) => wall.selected);
  if (!selectedWall) return;

  ctx.save();
  ctx.strokeStyle = '#2f2f2f';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(selectedWall.selectionPolygon[0].x, selectedWall.selectionPolygon[0].y);
  ctx.lineTo(selectedWall.selectionPolygon[1].x, selectedWall.selectionPolygon[1].y);
  ctx.moveTo(selectedWall.selectionPolygon[3].x, selectedWall.selectionPolygon[3].y);
  ctx.lineTo(selectedWall.selectionPolygon[2].x, selectedWall.selectionPolygon[2].y);
  ctx.stroke();
  ctx.restore();
}

function drawOpeningSegment(ctx, startX, startY, endX, endY) {
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

function getOpeningWallFaces(opening) {
  const wall = opening.wall || {};
  const outerY = Number.isFinite(wall.outerOffsetPx)
    ? wall.outerOffsetPx
    : (wall.measurementSide === 'left' ? -wall.thicknessPx : wall.thicknessPx);
  const innerY = 0;
  return {
    innerY,
    outerY,
    minY: Math.min(innerY, outerY),
    maxY: Math.max(innerY, outerY)
  };
}

function getDoorSwingSign(opening, faces) {
  const opensOutside = opening.opening && opening.opening.openDirection === 'outside';
  const outsideSign = faces.outerY < 0 ? -1 : 1;
  return opensOutside ? outsideSign : -outsideSign;
}

function getDoorFrameDepth(opening) {
  return Math.min(
    // Scene coordinates are logical Canvas pixels and are multiplied by DPR
    // during painting. A 4px logical stop is already about 12px on the phone,
    // which is the reference glyph's visible double-line gap. Wider spacing
    // turns the casing into the oversized stepped break seen on-device.
    Math.max(3.5, opening.wall.thicknessPx * 0.2),
    Math.max(3.5, opening.widthPx * 0.1)
  );
}

function getDoorFrameStripFace(opening, faces) {
  const opensOutside = opening.opening && opening.opening.openDirection === 'outside';
  // The closed-position frame strip belongs on the wall face opposite the
  // swing area. Keeping it on the swing face mirrors the CAD symbol even when
  // the inside/outside direction itself is correct.
  return opensOutside ? faces.innerY : faces.outerY;
}

function getDoorLeafSeat(opening, faces) {
  const faceY = getDoorFrameStripFace(opening, faces);
  const towardOtherFace = faces.outerY === faceY
    ? Math.sign(faces.innerY - faces.outerY)
    : Math.sign(faces.outerY - faces.innerY);
  const wallWidth = Math.abs(faces.outerY - faces.innerY);
  // The reference's visible jamb is a narrow, independent post inside the
  // wall thickness—not the wall outline itself.  This offset prevents the
  // post from being visually swallowed by the room-fill/wall boundary.
  const inset = Math.min(
    Math.max(1.5, wallWidth * 0.12),
    Math.max(1.5, wallWidth / 2 - 1)
  );
  return faceY + towardOtherFace * inset;
}

function drawOpeningJamb(ctx, x, faces) {
  drawOpeningSegment(ctx, x, faces.outerY, x, faces.innerY);
}

// A hinged-door casing is a small rectangular sleeve at each end of the
// opening. Drawing only its two cross-wall stop lines leaves the faces open,
// so it reads as a broken wall rather than the paired door-frame rectangles
// in a construction plan. Keep all four edges explicit.
function drawDoorCasing(ctx, outerX, innerX, faces) {
  // One closed mitered path keeps the four corners square. Four independent
  // strokes leave anti-aliased end caps that look rounded on the native
  // high-DPR Canvas.
  ctx.beginPath();
  ctx.moveTo(outerX, faces.outerY);
  ctx.lineTo(innerX, faces.outerY);
  ctx.lineTo(innerX, faces.innerY);
  ctx.lineTo(outerX, faces.innerY);
  ctx.closePath();
  ctx.stroke();
}

// Draw the open door leaf as a narrow outlined slab rather than one construction
// line. `endOnRight` selects both the opposing jamb and the side on which the
// slab gains its thickness, so paired leaves grow toward the clear opening.
function drawDoorLeaf(ctx, hingeX, seatY, radius, thickness, swingSign, endOnRight) {
  const leafAngle = swingSign < 0 ? -Math.PI / 2 : Math.PI / 2;
  const endAngle = endOnRight ? 0 : Math.PI;
  const anticlockwise = (swingSign > 0 && endOnRight) || (swingSign < 0 && !endOnRight);
  const leafTipY = seatY + swingSign * radius;
  const secondLeafX = hingeX + (endOnRight ? thickness : -thickness);

  ctx.beginPath();
  ctx.moveTo(hingeX, seatY);
  ctx.lineTo(hingeX, leafTipY);
  ctx.lineTo(secondLeafX, leafTipY);
  ctx.lineTo(secondLeafX, seatY);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hingeX, seatY, radius, leafAngle, endAngle, anticlockwise);
  ctx.stroke();
}

// The inner door-frame strip is a final, global-coordinate overlay. Native
// Canvas can retain a transformed opening path together with the wall-mask fill
// on some devices; drawing the complete outlined strip after the local opening
// restore keeps both long edges visible and closes them into the two casing
// rectangles. A single construction line here loses the narrow rectangular
// layer used by the CAD reference.
function drawDoorInnerFrameStrip(ctx, opening) {
  const category = opening.opening && opening.opening.modelCategory;
  if (category === 'sliding-door') return;
  const faces = getOpeningWallFaces(opening);
  const frameDepth = getDoorFrameDepth(opening);
  const hingeX = opening.startPx + frameDepth;
  const oppositeJambX = opening.endPx - frameDepth;
  const leafFrameFaceY = getDoorFrameStripFace(opening, faces);
  const leafSeatY = getDoorLeafSeat(opening, faces);
  const wall = opening.wall;
  const faceStart = localPointToCanvas(wall, hingeX, leafFrameFaceY);
  const faceEnd = localPointToCanvas(wall, oppositeJambX, leafFrameFaceY);
  const seatEnd = localPointToCanvas(wall, oppositeJambX, leafSeatY);
  const seatStart = localPointToCanvas(wall, hingeX, leafSeatY);

  ctx.save();
  ctx.strokeStyle = opening.selected ? '#f07a21' : '#111827';
  ctx.lineWidth = opening.selected ? 2.5 : WALL_STROKE_PX;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(faceStart.x, faceStart.y);
  ctx.lineTo(faceEnd.x, faceEnd.y);
  ctx.lineTo(seatEnd.x, seatEnd.y);
  ctx.lineTo(seatStart.x, seatStart.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawSlidingDoorOpening(ctx, opening, faces) {
  const panelInset = Math.min(
    Math.max(1.25, opening.wall.thicknessPx * 0.18),
    Math.max(1.25, Math.abs(faces.outerY - faces.innerY) / 2 - 1)
  );
  const firstRailY = faces.outerY < faces.innerY
    ? faces.outerY + panelInset
    : faces.outerY - panelInset;
  const secondRailY = faces.innerY < faces.outerY
    ? faces.innerY + panelInset
    : faces.innerY - panelInset;
  const centerX = (opening.startPx + opening.endPx) / 2;

  // Two panels use the physical wall faces as their rails, so the symbol stays
  // aligned when wall thickness or viewport scale changes.
  drawOpeningSegment(ctx, opening.startPx, firstRailY, centerX, firstRailY);
  drawOpeningSegment(ctx, centerX, secondRailY, opening.endPx, secondRailY);
  drawOpeningJamb(ctx, opening.startPx, faces);
  drawOpeningSegment(ctx, centerX, firstRailY, centerX, secondRailY);
  drawOpeningJamb(ctx, opening.endPx, faces);
}

function drawDoorOpening(ctx, opening) {
  const category = opening.opening && opening.opening.modelCategory;
  const faces = getOpeningWallFaces(opening);
  const swingSign = getDoorSwingSign(opening, faces);
  const frameDepth = getDoorFrameDepth(opening);
  const hingeX = opening.startPx + frameDepth;
  const oppositeJambX = opening.endPx - frameDepth;
  const leafSeatY = getDoorLeafSeat(opening, faces);
  const leafThickness = Math.abs(getDoorFrameStripFace(opening, faces) - leafSeatY);
  const color = opening.selected ? '#f07a21' : '#111827';

  ctx.strokeStyle = color;
  // Match the wall-outline weight so the squared casing does not visually
  // bulge at its corners.
  ctx.lineWidth = opening.selected ? 2.5 : WALL_STROKE_PX;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  if (category === 'sliding-door') {
    drawSlidingDoorOpening(ctx, opening, faces);
    return;
  }

  const drawFrameCasings = () => {
    // The upper and lower (or left and right) sleeves close the four visible
    // edges of the two door jambs. Their inner corners are the actual hinge
    // and arc-stop positions used below.
    drawDoorCasing(ctx, opening.startPx, hingeX, faces);
    drawDoorCasing(ctx, oppositeJambX, opening.endPx, faces);
  };

  // The leaf uses the measured clear opening between the two door-stop lines,
  // so the arc meets the opposing frame instead of the raw wall opening.
  if (category === 'double-door') {
    const leafWidth = (oppositeJambX - hingeX) / 2;
    drawDoorLeaf(ctx, hingeX, leafSeatY, leafWidth, leafThickness, swingSign, true);
    drawDoorLeaf(ctx, oppositeJambX, leafSeatY, leafWidth, leafThickness, swingSign, false);
  } else {
    drawDoorLeaf(
      ctx,
      hingeX,
      leafSeatY,
      oppositeJambX - hingeX,
      leafThickness,
      swingSign,
      true
    );
  }
  // Keep the complete rectangular casings above the leaf. This final pass
  // preserves both stop lines and their face connectors where the leaf meets
  // the frame.
  drawFrameCasings();
}

function drawWindowOpening(ctx, opening) {
  const faces = getOpeningWallFaces(opening);
  // The outside and inside window rails reuse the wall's already-rendered
  // faces verbatim. Do not derive an inset from opening depth or a visual
  // percentage: either produces a different line after wall zoom/thickness
  // normalization and inevitably leaves a visible alignment error.
  const outerRailY = faces.outerY;
  const innerRailY = faces.innerY;
  const middleRailY = (outerRailY + innerRailY) / 2;
  const centerX = (opening.startPx + opening.endPx) / 2;
  const color = opening.selected ? '#f07a21' : '#2f2f2f';

  // CAD windows are a framed break in the wall. The rails sit across its true
  // thickness, with a third centre rail and mullions for the denser symbol.
  ctx.strokeStyle = color;
  ctx.lineWidth = opening.selected ? 3 : 1.5;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  drawOpeningSegment(ctx, opening.startPx, outerRailY, opening.endPx, outerRailY);
  drawOpeningSegment(ctx, opening.startPx, middleRailY, opening.endPx, middleRailY);
  drawOpeningSegment(ctx, opening.startPx, innerRailY, opening.endPx, innerRailY);
  drawOpeningJamb(ctx, opening.startPx, faces);
  drawOpeningJamb(ctx, opening.endPx, faces);

  if (opening.widthPx >= 36) {
    drawOpeningSegment(ctx, centerX, outerRailY, centerX, innerRailY);
  }
  if (opening.opening && opening.opening.modelCategory === 'sliding-window' && opening.widthPx >= 72) {
    const quarterWidth = opening.widthPx / 4;
    drawOpeningSegment(ctx, centerX - quarterWidth, outerRailY, centerX - quarterWidth, innerRailY);
    drawOpeningSegment(ctx, centerX + quarterWidth, outerRailY, centerX + quarterWidth, innerRailY);
  }
}

function drawOpenings(ctx, scene) {
  (scene.openings || []).forEach((opening) => {
    const wall = opening.wall;
    ctx.save();
    ctx.translate(wall.startPoint.x, wall.startPoint.y);
    ctx.rotate(wall.angleRad);

    const faces = getOpeningWallFaces(opening);
    const maskInsetY = WALL_STROKE_PX + 1;
    // Do not widen the clear opening along the wall. The casing must meet the
    // wall segments exactly, otherwise the narrow white seams seen at either
    // side of a window make it read as a floating overlay.
    const maskInsetX = 0.5;
    ctx.fillStyle = '#f8f8f8';
    ctx.beginPath();
    ctx.rect(
      opening.startPx - maskInsetX,
      faces.minY - maskInsetY,
      opening.widthPx + maskInsetX * 2,
      faces.maxY - faces.minY + maskInsetY * 2
    );
    ctx.fill();

    if (opening.selected) {
      ctx.strokeStyle = 'rgba(240, 122, 33, 0.18)';
      ctx.lineWidth = Math.max(16, wall.thicknessPx + 10);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(opening.startPx, opening.centerYPx);
      ctx.lineTo(opening.endPx, opening.centerYPx);
      ctx.stroke();
    }

    if (opening.type === 'window') {
      drawWindowOpening(ctx, opening);
    } else {
      drawDoorOpening(ctx, opening);
    }

    if (opening.selected) {
      ctx.fillStyle = '#f07a21';
      ctx.beginPath();
      ctx.arc(opening.startPx, opening.centerYPx, 5, 0, Math.PI * 2);
      ctx.arc(opening.endPx, opening.centerYPx, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (opening.type === 'door') {
      drawDoorInnerFrameStrip(ctx, opening);
    }
  });
}

function drawArrow(ctx, x, y, direction, size) {
  const arrowSize = size || 8;
  const half = arrowSize * 0.62;
  ctx.beginPath();
  ctx.moveTo(x + direction * arrowSize, y);
  ctx.lineTo(x, y - half);
  ctx.lineTo(x, y + half);
  ctx.closePath();
  ctx.fill();
}

function drawCompoundRings(ctx, rings, fillStyle, strokeStyle, lineWidth) {
  if (!rings || !rings.length) return;
  ctx.beginPath();
  rings.forEach((ring) => {
    if (!ring || ring.length < 3) return;
    ctx.moveTo(ring[0].x, ring[0].y);
    for (let index = 1; index < ring.length; index += 1) {
      ctx.lineTo(ring[index].x, ring[index].y);
    }
    ctx.closePath();
  });
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }
}

function drawPlannedDimension(ctx, dimension) {
  const start = dimension.startPoint;
  const end = dimension.endPoint;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const flipLabel = Math.atan2(dy, dx) > Math.PI / 2 || Math.atan2(dy, dx) <= -Math.PI / 2;

  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.strokeStyle = '#4b5563';
  ctx.fillStyle = '#374151';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -DIMENSION_ENDPOINT_TICK_PX);
  ctx.lineTo(0, DIMENSION_ENDPOINT_TICK_PX);
  ctx.moveTo(length, -DIMENSION_ENDPOINT_TICK_PX);
  ctx.lineTo(length, DIMENSION_ENDPOINT_TICK_PX);
  ctx.moveTo(0, 0);
  ctx.lineTo(length, 0);
  ctx.stroke();
  drawArrow(ctx, 4.5, 0, -1, 4.5);
  drawArrow(ctx, length - 4.5, 0, 1, 4.5);
  ctx.save();
  ctx.translate(length / 2, 0);
  if (flipLabel) ctx.rotate(Math.PI);
  const fontWeight = dimension.kind === 'chain-total' ? '700' : '600';
  ctx.font = `${fontWeight} 14px sans-serif`;
  const labelWidth = ctx.measureText(dimension.label).width;
  ctx.fillStyle = DIMENSION_LABEL_BACKGROUND;
  ctx.fillRect(
    -labelWidth / 2 - DIMENSION_LABEL_PADDING_X,
    -DIMENSION_LABEL_HEIGHT_PX / 2,
    labelWidth + DIMENSION_LABEL_PADDING_X * 2,
    DIMENSION_LABEL_HEIGHT_PX
  );
  ctx.fillStyle = DIMENSION_LABEL_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(dimension.label, 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawDimension(ctx, dimension) {
  if (dimension.startPoint && dimension.endPoint) {
    drawPlannedDimension(ctx, dimension);
    return;
  }
  const wall = dimension.wall;
  const y = dimension.offset;
  const width = wall.widthPx;
  const flipLabel = wall.angleDeg > 90 || wall.angleDeg <= -90;

  const startX = typeof dimension.startX === 'number' ? dimension.startX : 0;
  const endX = typeof dimension.endX === 'number' ? dimension.endX : width;
  const startY = typeof dimension.startY === 'number' ? dimension.startY : 0;
  const endY = typeof dimension.endY === 'number' ? dimension.endY : 0;

  ctx.save();
  ctx.translate(wall.startPoint.x, wall.startPoint.y);
  ctx.rotate(wall.angleRad);
  ctx.strokeStyle = '#333333';
  ctx.fillStyle = '#333333';
  ctx.lineWidth = 1;

  // Floating endpoint ticks keep the dimension clear of the wall instead of
  // connecting the annotation back to the wall face.
  ctx.beginPath();
  ctx.moveTo(startX, y - DIMENSION_ENDPOINT_TICK_PX);
  ctx.lineTo(startX, y + DIMENSION_ENDPOINT_TICK_PX);
  ctx.moveTo(endX, y - DIMENSION_ENDPOINT_TICK_PX);
  ctx.lineTo(endX, y + DIMENSION_ENDPOINT_TICK_PX);
  ctx.stroke();

  // Dimension endpoints meet the extension lines; only arrowheads extend into
  // the dimension line, so the drawing stays compact at small scales.
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(endX, y);
  ctx.stroke();

  // The outward-facing tips align with the dimension endpoints; their bodies
  // sit inside the line rather than extending beyond it.
  drawArrow(ctx, startX + 6, y, -1, 6);
  drawArrow(ctx, endX - 6, y, 1, 6);

  // Draw value label
  ctx.save();
  ctx.translate((startX + endX) / 2, y);
  if (flipLabel) ctx.rotate(Math.PI);
  ctx.font = '600 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelWidth = ctx.measureText(dimension.label).width;
  ctx.fillStyle = DIMENSION_LABEL_BACKGROUND;
  ctx.fillRect(
    -labelWidth / 2 - DIMENSION_LABEL_PADDING_X,
    -DIMENSION_LABEL_HEIGHT_PX / 2,
    labelWidth + DIMENSION_LABEL_PADDING_X * 2,
    DIMENSION_LABEL_HEIGHT_PX
  );
  ctx.fillStyle = DIMENSION_LABEL_COLOR;
  ctx.fillText(dimension.label, 0, 0);
  ctx.restore();

  ctx.restore();
}

function drawDimensions(ctx, scene) {
  scene.dimensions.forEach((dimension) => drawDimension(ctx, dimension));
}

function drawClosureGuide(ctx, scene) {
  const guide = scene.closureGuide;
  if (!guide) return;
  ctx.save();
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = GUIDE_STROKE_PX;
  if (ctx.setLineDash) ctx.setLineDash(CLOSURE_GUIDE_DASH_PX);
  ctx.beginPath();
  const points = guide.points && guide.points.length >= 2
    ? guide.points
    : [guide.startPoint, guide.endPoint];
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();
  if (ctx.setLineDash) ctx.setLineDash([]);
  ctx.restore();
}

function drawAlignmentSnapGuide(ctx, scene) {
  const guide = scene.alignmentSnapGuide;
  if (!guide || !guide.startPoint || !guide.endPoint) return;

  const dx = guide.endPoint.x - guide.startPoint.x;
  const dy = guide.endPoint.y - guide.startPoint.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!length) return;

  const extend = 18;
  const ux = dx / length;
  const uy = dy / length;
  const startPoint = {
    x: guide.startPoint.x - ux * extend,
    y: guide.startPoint.y - uy * extend
  };
  const endPoint = {
    x: guide.endPoint.x + ux * extend,
    y: guide.endPoint.y + uy * extend
  };

  ctx.save();
  ctx.strokeStyle = '#2875b4';
  ctx.lineWidth = GUIDE_STROKE_PX;
  if (ctx.setLineDash) ctx.setLineDash(BLUE_GUIDE_DASH_PX);
  ctx.beginPath();
  ctx.moveTo(startPoint.x, startPoint.y);
  ctx.lineTo(endPoint.x, endPoint.y);
  ctx.stroke();
  if (ctx.setLineDash) ctx.setLineDash([]);
  ctx.restore();
}

function drawCursor(ctx, scene) {
  if (!scene.cursor || !scene.cursor.point) return;
  const point = scene.cursor.point;
  const half = 16;
  const core = 14;

  ctx.save();
  ctx.strokeStyle = 'rgba(22, 119, 255, 0.92)';
  ctx.lineWidth = GUIDE_STROKE_PX;
  if (ctx.setLineDash) ctx.setLineDash(BLUE_GUIDE_DASH_PX);
  ctx.beginPath();
  ctx.moveTo(0, point.y);
  ctx.lineTo(scene.rect.width, point.y);
  ctx.moveTo(point.x, 0);
  ctx.lineTo(point.x, scene.rect.height);
  ctx.stroke();
  if (ctx.setLineDash) ctx.setLineDash([]);

  ctx.strokeStyle = '#f07a21';
  ctx.fillStyle = 'rgba(240, 122, 33, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.moveTo(point.x - half, point.y);
  ctx.lineTo(point.x + half, point.y);
  ctx.moveTo(point.x, point.y - half);
  ctx.lineTo(point.x, point.y + half);
  ctx.stroke();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#f07a21';
  ctx.fillRect(point.x - core / 2, point.y - core / 2, core, core);
  ctx.strokeRect(point.x - core / 2, point.y - core / 2, core, core);
  ctx.restore();
}

function resolveViewportInteractionTransform(baseViewport, viewport, rect) {
  const base = resolveViewport(baseViewport);
  const target = resolveViewport(viewport);
  const box = resolveRect(rect);
  const scale = target.scale / base.scale;
  const centerX = box.width / 2;
  const centerY = box.height / 2;

  return {
    scale,
    translateX: centerX + target.offsetX - scale * (centerX + base.offsetX),
    translateY: centerY + target.offsetY - scale * (centerY + base.offsetY)
  };
}

function projectInteractionPoint(point, transform) {
  if (!point) return point;
  return {
    x: point.x * transform.scale + transform.translateX,
    y: point.y * transform.scale + transform.translateY
  };
}

function projectInteractionPoints(points, transform) {
  return (points || []).map((point) => projectInteractionPoint(point, transform));
}

function projectInteractionWall(wall, transform) {
  if (!wall) return wall;
  const projected = Object.assign({}, wall);
  [
    'startPoint',
    'endPoint',
    'outerStart',
    'outerEnd',
    'rawOuterStart',
    'rawOuterEnd'
  ].forEach((key) => {
    projected[key] = projectInteractionPoint(wall[key], transform);
  });
  ['bodyPolygon', 'selectionPolygon'].forEach((key) => {
    projected[key] = projectInteractionPoints(wall[key], transform);
  });
  [
    'widthPx',
    'thicknessPx',
    'outerOffsetPx',
    'centerLineYPx',
    'outerStartAlongPx',
    'outerEndPx'
  ].forEach((key) => {
    if (typeof wall[key] === 'number') {
      projected[key] = wall[key] * transform.scale;
    }
  });
  return projected;
}

function projectInteractionSolidPlan(plan, transform) {
  if (!plan) return plan;
  return Object.assign({}, plan, {
    rings: (plan.rings || []).map((ring) => projectInteractionPoints(ring, transform))
  });
}

// Some Mini Program Canvas versions render transformed compound fills
// differently from a formal redraw. Project only the already-built paths for
// gesture frames so fills, solids, and outlines share the target coordinates.
function createViewportInteractionScene(scene, viewport) {
  const transform = resolveViewportInteractionTransform(scene.viewport, viewport, scene.rect);
  const projectedWallsById = {};
  const walls = (scene.walls || []).map((wall) => {
    const projected = projectInteractionWall(wall, transform);
    projectedWallsById[projected.id] = projected;
    return projected;
  });
  const previewWall = projectInteractionWall(scene.previewWall, transform);
  if (previewWall) {
    projectedWallsById[previewWall.id] = previewWall;
  }

  return Object.assign({}, scene, {
    viewport: resolveViewport(viewport),
    walls,
    previewWall,
    closedSpaceFills: (scene.closedSpaceFills || []).map((space) => Object.assign({}, space, {
      points: projectInteractionPoints(space.points, transform)
    })),
    wallSolidPlan: projectInteractionSolidPlan(scene.wallSolidPlan, transform),
    wallSolidPlans: Object.keys(scene.wallSolidPlans || {}).reduce((plans, key) => {
      plans[key] = projectInteractionSolidPlan(scene.wallSolidPlans[key], transform);
      return plans;
    }, {}),
    openings: (scene.openings || []).map((opening) => {
      const projected = Object.assign({}, opening, {
        wall: opening.wall && projectedWallsById[opening.wall.id],
        center: projectInteractionPoint(opening.center, transform),
        hitPolygon: projectInteractionPoints(opening.hitPolygon, transform)
      });
      ['startPx', 'endPx', 'centerPx', 'centerYPx', 'widthPx'].forEach((key) => {
        if (typeof opening[key] === 'number') {
          projected[key] = opening[key] * transform.scale;
        }
      });
      return projected;
    })
  });
}

function createSurveyLensScene(input) {
  const opts = input || {};
  const centerPoint = opts.centerPoint || { xMm: 0, yMm: 0 };
  const size = opts.size || 180;
  const scale = opts.scale || 0.12;

  return createSurveyRenderScene({
    floor: opts.floor,
    session: opts.session,
    rect: { width: size, height: size },
    viewport: {
      scale,
      offsetX: -centerPoint.xMm * scale,
      offsetY: -centerPoint.yMm * scale
    }
  });
}

/**
 * Draws the lightweight viewport gesture frame from an already-built scene.
 * The formal scene remains untouched while pan/pinch events only update the
 * viewport matrix. Expensive dimensions, labels, guides, and controls return
 * when the gesture commits and the full scene is rebuilt once.
 */
function drawSurveyInteractionScene(ctx, scene, options) {
  if (!ctx || !scene || !scene.rect.width || !scene.rect.height) return;
  const opts = options || {};
  const dpr = opts.dpr || 1;
  const viewport = resolveViewport(opts.viewport || scene.viewport);
  const baseScene = opts.baseViewport && opts.baseViewport !== scene.viewport
    ? Object.assign({}, scene, { viewport: resolveViewport(opts.baseViewport) })
    : scene;
  const interactionScene = createViewportInteractionScene(baseScene, viewport);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.rect.width, scene.rect.height);
  drawGrid(ctx, interactionScene);
  drawClosedSpaceFills(ctx, interactionScene);
  drawWallBodies(ctx, interactionScene);
  drawWallOutlines(ctx, interactionScene);
  drawRedlines(ctx, interactionScene);
  drawOpenings(ctx, interactionScene);
}

function clearDraggingCursor(ctx, rect, options) {
  if (!ctx || !rect || !rect.width || !rect.height) return;
  const dpr = (options && options.dpr) || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.restore();
}

function drawRoundedRectPath(ctx, left, top, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(left + safeRadius, top);
  ctx.lineTo(left + width - safeRadius, top);
  ctx.quadraticCurveTo(left + width, top, left + width, top + safeRadius);
  ctx.lineTo(left + width, top + height - safeRadius);
  ctx.quadraticCurveTo(left + width, top + height, left + width - safeRadius, top + height);
  ctx.lineTo(left + safeRadius, top + height);
  ctx.quadraticCurveTo(left, top + height, left, top + height - safeRadius);
  ctx.lineTo(left, top + safeRadius);
  ctx.quadraticCurveTo(left, top, left + safeRadius, top);
  ctx.closePath();
}

function drawCursorLensScene(ctx, scene, lensRect) {
  if (!scene || !lensRect) return;
  const left = lensRect.left || 0;
  const top = lensRect.top || 0;
  const size = lensRect.size || scene.rect.width || 180;
  const panelPadding = 8;
  const panelMetaHeight = 40;
  const panelLeft = left - panelPadding;
  const panelTop = top - panelPadding;
  const panelWidth = size + panelPadding * 2;
  const panelHeight = size + panelPadding * 2 + panelMetaHeight;

  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.24)';
  ctx.shadowBlur = 17;
  ctx.shadowOffsetY = 6;
  drawRoundedRectPath(ctx, panelLeft, panelTop, panelWidth, panelHeight, 11);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedRectPath(ctx, left, top, size, size, 8);
  ctx.clip();
  ctx.translate(left, top);
  drawGrid(ctx, scene);
  drawClosedSpaceFills(ctx, scene);
  drawWallBodies(ctx, scene);
  drawWallOutlines(ctx, scene);
  drawRedlines(ctx, scene);
  drawSelectedWallHighlight(ctx, scene);
  drawOpenings(ctx, scene);
  ctx.restore();

  ctx.save();
  drawRoundedRectPath(ctx, left, top, size, size, 8);
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/**
 * Lightweight drag-only canvas renderer. It avoids redrawing the full survey
 * viewport; the optional magnifier draws only a clipped formal structural scene.
 */
function drawDraggingCursor(ctx, rect, point, options) {
  if (!ctx || !rect || !rect.width || !rect.height || !point) return;
  const dpr = (options && options.dpr) || 1;
  clearDraggingCursor(ctx, rect, { dpr });

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(22, 119, 255, 0.92)';
  ctx.lineWidth = GUIDE_STROKE_PX;
  if (ctx.setLineDash) ctx.setLineDash(BLUE_GUIDE_DASH_PX);
  ctx.beginPath();
  ctx.moveTo(0, point.y);
  ctx.lineTo(rect.width, point.y);
  ctx.moveTo(point.x, 0);
  ctx.lineTo(point.x, rect.height);
  ctx.stroke();
  if (ctx.setLineDash) ctx.setLineDash([]);

  const outerSize = 52;
  const crossHalf = 36;
  const coreSize = 14;
  ctx.fillStyle = 'rgba(240, 122, 33, 0.16)';
  ctx.strokeStyle = 'rgba(240, 122, 33, 0.56)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(point.x - outerSize / 2, point.y - outerSize / 2, outerSize, outerSize);
  ctx.strokeRect(point.x - outerSize / 2, point.y - outerSize / 2, outerSize, outerSize);

  ctx.strokeStyle = '#f07a21';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(point.x - crossHalf, point.y);
  ctx.lineTo(point.x + crossHalf, point.y);
  ctx.moveTo(point.x, point.y - crossHalf);
  ctx.lineTo(point.x, point.y + crossHalf);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.strokeStyle = '#f07a21';
  ctx.lineWidth = 1.5;
  ctx.fillRect(point.x - coreSize / 2, point.y - coreSize / 2, coreSize, coreSize);
  ctx.strokeRect(point.x - coreSize / 2, point.y - coreSize / 2, coreSize, coreSize);

  drawCursorLensScene(ctx, options && options.lensScene, options && options.lensRect);
  ctx.restore();
}

function drawLockIcon(ctx, cx, cy, isLocked) {
  ctx.save();
  // Draw background circle
  ctx.fillStyle = isLocked ? '#ef4444' : '#9ca3af';
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fill();

  // Draw lock body
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 5, cy - 2, 10, 8);

  // Draw lock shackle
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (isLocked) {
    // Closed shackle
    ctx.arc(cx, cy - 2, 4, Math.PI, 0);
  } else {
    // Open shackle
    ctx.arc(cx - 2, cy - 2, 4, Math.PI, -Math.PI / 4);
  }
  ctx.stroke();
  ctx.restore();
}

function drawLockHandles(ctx, scene) {
  const session = scene.session;
  if (!session || session.state !== 'remeasureAwaitingInput') return;

  const selectedWall = (scene.walls || []).find((wall) => wall.id === session.selectedWallId);
  if (!selectedWall) return;

  const startPt = selectedWall.startPoint;
  const endPt = selectedWall.endPoint;
  const fixedNodeId = session.fixedNodeId || selectedWall.wall.startNodeId;

  const startLocked = fixedNodeId === selectedWall.wall.startNodeId;
  const endLocked = fixedNodeId === selectedWall.wall.endNodeId;

  drawLockIcon(ctx, startPt.x, startPt.y, startLocked);
  drawLockIcon(ctx, endPt.x, endPt.y, endLocked);
}

function drawClosedSpaceLabel(ctx, scene) {
  const labels = scene.closedSpaceLabels;
  if (!labels || !labels.length) return;

  labels.forEach((label) => {
    if (!label || !label.centroid) return;

    const { centroid, roomName, ceilingHeightMm, areaM2 } = label;
    const detailScale = label.detailScale || 1;
    const cx = centroid.x;
    const cy = centroid.y;

    ctx.save();

    const titleText = String(roomName);
    const heightText = `H=${ceilingHeightMm}mm`;
    const areaText = `S≈${areaM2}m²`;
    const titleFontSize = 12 * detailScale;
    const metricFontSize = 9 * detailScale;
    const horizontalPadding = 12 * detailScale;
    const cardHeight = 52 * detailScale;
    const titleOffset = 12 * detailScale;
    const heightOffset = 34 * detailScale;
    const areaOffset = 46 * detailScale;

    ctx.font = `bold ${titleFontSize}px sans-serif`;
    const titleWidth = ctx.measureText(titleText).width;
    ctx.font = `${metricFontSize}px sans-serif`;
    const metricWidth = Math.max(
      ctx.measureText(heightText).width,
      ctx.measureText(areaText).width
    );

    // Background card with compact content-fit sizing
    const cardW = Math.ceil(Math.max(titleWidth, metricWidth) + horizontalPadding * 2);
    const cardH = cardHeight;
    const cardX = cx - cardW / 2;
    const cardY = cy - cardH / 2;
    const radius = 8 * detailScale;
    const widthFit = label.detailMaxWidthPx ? label.detailMaxWidthPx / cardW : 1;
    const heightFit = label.detailMaxHeightPx ? label.detailMaxHeightPx / cardH : 1;
    const fitScale = Math.min(1, widthFit, heightFit);

    if (fitScale < 1) {
      ctx.translate(cx, cy);
      ctx.scale(fitScale, fitScale);
      ctx.translate(-cx, -cy);
    }

    ctx.beginPath();
    ctx.moveTo(cardX + radius, cardY);
    ctx.lineTo(cardX + cardW - radius, cardY);
    ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + radius);
    ctx.lineTo(cardX + cardW, cardY + cardH - radius);
    ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - radius, cardY + cardH);
    ctx.lineTo(cardX + radius, cardY + cardH);
    ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - radius);
    ctx.lineTo(cardX, cardY + radius);
    ctx.quadraticCurveTo(cardX, cardY, cardX + radius, cardY);
    ctx.closePath();
    ctx.fillStyle = 'transparent';
    ctx.fill();

    // Room name
    ctx.fillStyle = '#111111';
    ctx.font = `bold ${titleFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(titleText, cx, cardY + titleOffset);

    ctx.font = `${metricFontSize}px sans-serif`;
    ctx.fillStyle = '#555555';
    ctx.fillText(heightText, cx, cardY + heightOffset);
    ctx.fillText(areaText, cx, cardY + areaOffset);

    ctx.restore();
  });
}

function drawSurveyScene(ctx, scene, options) {
  if (!ctx || !scene || !scene.rect.width || !scene.rect.height) return;
  const dpr = (options && options.dpr) || 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.rect.width, scene.rect.height);

  drawGrid(ctx, scene);
  drawAxes(ctx, scene);
  drawClosedSpaceFills(ctx, scene);
  drawWallBodies(ctx, scene);
  drawWallOutlines(ctx, scene);
  drawSelectedWallHighlight(ctx, scene);
  drawOpenings(ctx, scene);
  drawDimensions(ctx, scene);
  drawClosedSpaceLabel(ctx, scene);
  drawLockHandles(ctx, scene);
  drawAlignmentSnapGuide(ctx, scene);
  drawClosureGuide(ctx, scene);
  drawCursor(ctx, scene);
  // The active measuring edge must remain visible above every dashed guide.
  drawRedlines(ctx, scene);
}

function pointLineDistance(point, start, end) {
  const length = distancePx(start, end);
  if (!length) return distancePx(point, start);
  const t = clamp(
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length),
    0,
    1
  );
  return distancePx(point, {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  });
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    const intersects = ((current.y > point.y) !== (previous.y > point.y)) &&
      (point.x < (previous.x - current.x) * (point.y - current.y) / ((previous.y - current.y) || 1) + current.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function hitTestSurveyWall(scene, canvasPoint) {
  if (!scene || !canvasPoint) return null;
  let nearest = null;

  scene.walls.forEach((wall) => {
    const distance = pointLineDistance(canvasPoint, wall.startPoint, wall.endPoint);
    const inside = pointInPolygon(canvasPoint, wall.bodyPolygon);
    const threshold = Math.max(16, wall.thicknessPx + 8);
    if (!inside && distance > threshold) return;

    if (!nearest || distance < nearest.distance) {
      nearest = { wallId: wall.id, distance };
    }
  });

  return nearest;
}

function hitTestSurveyOpening(scene, canvasPoint) {
  if (!scene || !canvasPoint) return null;
  let nearest = null;

  (scene.openings || []).forEach((opening) => {
    if (!pointInPolygon(canvasPoint, opening.hitPolygon)) return;
    const distance = distancePx(canvasPoint, opening.center);
    if (!nearest || distance < nearest.distance) {
      nearest = { openingId: opening.id, wallId: opening.opening.wallId, distance };
    }
  });

  return nearest;
}

module.exports = {
  createSurveyRenderScene,
  createSurveyLensScene,
  drawSurveyScene,
  drawSurveyInteractionScene,
  drawDraggingCursor,
  clearDraggingCursor,
  resolveViewportInteractionTransform,
  createViewportInteractionScene,
  hitTestSurveyWall,
  hitTestSurveyOpening
};
