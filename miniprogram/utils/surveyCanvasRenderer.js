const surveyGraph = require('./surveyWallGraph.js');

const GRID_MINOR_MM = 500;
const GRID_MAJOR_MM = 2500;
const WALL_VISUAL_SCALE = 0.56;
const MIN_WALL_THICKNESS_PX = 10;
const MAX_WALL_THICKNESS_PX = 22;
const WALL_STROKE_PX = 2;
const REDLINE_STROKE_PX = 3;
const DIMENSION_GAP_PX = 24;
const DIMENSION_OUTER_GAP_PX = 14;
const DIMENSION_LABEL_HEIGHT_PX = 20;
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
  const rawThickness = (thicknessMm || surveyGraph.DEFAULT_THICKNESS_MM) * scale * WALL_VISUAL_SCALE;
  return Math.round(clamp(rawThickness, MIN_WALL_THICKNESS_PX, MAX_WALL_THICKNESS_PX));
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
  const outerSign = -innerSign;
  const label = `${Math.round(wall.lengthMm || 0)}`;
  const offsets = [
    innerSign * DIMENSION_GAP_PX,
    outerSign * (wall.thicknessPx + DIMENSION_OUTER_GAP_PX),
    innerSign * (DIMENSION_GAP_PX + DIMENSION_LABEL_HEIGHT_PX + 10),
    outerSign * (wall.thicknessPx + DIMENSION_OUTER_GAP_PX + DIMENSION_LABEL_HEIGHT_PX + 10)
  ];

  return offsets.map((offset, index) => {
    const labelBox = createLabelBox(wall, offset, label);
    return {
      wall,
      label,
      offset,
      priority: priority - index,
      labelBox
    };
  });
}

function resolveDimensions(walls, previewWall) {
  const candidates = [];
  const renderWalls = walls.filter((wall) => !wall.lineOnly);
  renderWalls.forEach((wall, index) => {
    const priority = (wall.selected ? 900 : 0) + (index === renderWalls.length - 1 ? 500 : 0) + index;
    candidates.push({
      wall,
      options: createDimensionOptions(wall, priority),
      priority
    });
  });

  if (previewWall && !previewWall.lineOnly) {
    candidates.push({
      wall: previewWall,
      options: createDimensionOptions(previewWall, 1000),
      priority: 1000
    });
  }

  candidates.sort((first, second) => second.priority - first.priority);
  const accepted = [];
  const dimensions = [];

  candidates.forEach((candidate) => {
    const selected = candidate.options.find((option) => {
      return !accepted.some((acceptedOption) => boxesOverlap(option.labelBox, acceptedOption.labelBox, DIMENSION_COLLISION_GAP_PX));
    }) || candidate.options[0];

    accepted.push(selected);
    dimensions.push(selected);
  });

  return dimensions;
}

function buildWallScene(floor, wall, options) {
  const opts = options || {};
  const project = opts.project;
  const viewport = opts.viewport;
  const start = opts.startPoint || surveyGraph.getNode(floor, wall.startNodeId);
  const end = opts.endPoint || surveyGraph.getNode(floor, wall.endNodeId);
  if (!start || !end) return null;

  const startPoint = project(start);
  const endPoint = project(end);
  const widthPx = distancePx(startPoint, endPoint);
  if (!widthPx) return null;

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

  return {
    id: wall.id,
    wall,
    start,
    end,
    startPoint,
    endPoint,
    outerStart,
    outerEnd,
    bodyPolygon: [startPoint, endPoint, outerEnd, outerStart],
    direction,
    localY,
    widthPx,
    angleDeg: geometry.angleDeg,
    angleRad: Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x),
    lengthMm: geometry.lengthMm,
    relativeAngle: previousWall ? normalizeAngleDiff(wall.angleDeg, previousWall.angleDeg) : null,
    measurementSide: wall.measurementSide,
    thicknessPx: Math.round(geometry.thicknessMm * viewport.scale),
    centerLineYPx: outerOffsetPx / 2,
    startOpen: geometry.startOpen,
    endOpen: geometry.endOpen,
    selected: opts.selectedWallId === wall.id,
    preview: !!opts.preview,
    lineOnly: !!opts.lineOnly
  };
}

function buildJoinFills(floor, renderThicknessMmMap, project) {
  return surveyGraph.buildWallJoinRenderGeometries(floor, { renderThicknessMmMap })
    .map((join) => ({
      id: join.id,
      points: join.points.map(project)
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
    thicknessMm: session.thicknessMm,
    measurementSide: session.measurementSide,
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
  if (activeWallCount + (previewCountsAsWall ? 1 : 0) < 3) {
    return null;
  }

  const targetNode = session.closeCandidatePoint || surveyGraph.getNode(floor, session.closeCandidateNodeId);
  const currentNode = session.previewPoint || surveyGraph.getNode(floor, session.anchorNodeId);
  if (!targetNode || !currentNode) return null;

  return {
    startPoint: project(currentNode),
    endPoint: project(targetNode),
    active: session.state === 'closing'
  };
}

function buildAlignmentSnapGuide(session, project) {
  const guide = session && session.alignmentSnapGuide;
  if (!guide || guide.type !== 'rectangle-third-wall' || !guide.referencePoint || !guide.snappedPoint) {
    return null;
  }

  return {
    type: guide.type,
    direction: guide.direction,
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

function createSurveyRenderScene(input) {
  const floor = input.floor || { walls: [], nodes: [], spaces: [] };
  const session = input.session || floor.session || {};
  const viewport = resolveViewport(input.viewport);
  const rect = resolveRect(input.rect);
  const project = createProjector(viewport, rect);
  const renderThicknessMmMap = buildRenderThicknessMmMap(floor, viewport);
  const walls = (floor.walls || []).map((wall, index) => buildWallScene(floor, wall, {
    project,
    viewport,
    renderThicknessMmMap,
    relativePreviousWall: index > 0 ? floor.walls[index - 1] : null,
    selectedWallId: session.selectedWallId
  })).filter(Boolean);
  const previewWall = buildPreviewWall(floor, session, {
    project,
    viewport,
    renderThicknessMmMap,
    selectedWallId: session.selectedWallId
  });
  const dimensions = resolveDimensions(walls, previewWall);
  const openings = buildOpeningScenes(floor, walls, session);

  return {
    rect,
    viewport,
    walls,
    openings,
    previewWall,
    dimensions,
    joinFills: buildJoinFills(floor, renderThicknessMmMap, project),
    closureGuide: buildClosureGuide(floor, session, project),
    alignmentSnapGuide: buildAlignmentSnapGuide(session, project),
    cursor: buildCursor(floor, session, project),
    activeSegment: previewWall || walls[walls.length - 1] || null,
    closed: shouldCloseWholeWallPath(floor, previewWall)
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
  const minorStep = Math.max(24, GRID_MINOR_MM * viewport.scale);
  const majorStep = Math.max(minorStep * 4, GRID_MAJOR_MM * viewport.scale);

  ctx.fillStyle = '#f8f8f8';
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

  drawLines(minorStep, 'rgba(141, 148, 158, 0.25)', 1);
  drawLines(majorStep, 'rgba(111, 118, 128, 0.25)', 1.5);
}

function drawAxes(ctx, scene) {
  const segment = scene.activeSegment;
  if (!segment || !scene.walls.length) return;
  const point = segment.endPoint;

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 126, 220, 0.92)';
  ctx.lineWidth = 4;
  if (ctx.setLineDash) ctx.setLineDash([18, 14]);
  ctx.beginPath();
  ctx.moveTo(0, point.y);
  ctx.lineTo(scene.rect.width, point.y);
  ctx.moveTo(point.x, 0);
  ctx.lineTo(point.x, scene.rect.height);
  ctx.stroke();
  if (ctx.setLineDash) ctx.setLineDash([]);
  ctx.restore();
}

function drawWallBodies(ctx, scene) {
  scene.walls.forEach((wall) => {
    drawPolygon(ctx, wall.bodyPolygon, wall.selected ? 'rgba(187, 247, 208, 0.92)' : 'rgba(226, 226, 224, 0.94)');
  });
  scene.joinFills.forEach((join) => {
    drawPolygon(ctx, join.points, 'rgba(226, 226, 224, 0.94)');
  });
  if (scene.previewWall && !scene.previewWall.lineOnly) {
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
  const walls = scene.previewWall && !scene.previewWall.lineOnly
    ? scene.walls.concat(scene.previewWall)
    : scene.walls;

  ctx.save();
  ctx.strokeStyle = '#1f1f1f';
  ctx.lineWidth = WALL_STROKE_PX;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 2;
  drawOuterPath(ctx, walls, scene.closed && !scene.previewWall);

  walls.forEach((wall) => {
    if (wall.startOpen) {
      ctx.beginPath();
      ctx.moveTo(wall.startPoint.x, wall.startPoint.y);
      ctx.lineTo(wall.outerStart.x, wall.outerStart.y);
      ctx.stroke();
    }
    if (wall.endOpen) {
      ctx.beginPath();
      ctx.moveTo(wall.endPoint.x, wall.endPoint.y);
      ctx.lineTo(wall.outerEnd.x, wall.outerEnd.y);
      ctx.stroke();
    }
  });
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
  drawRedlinePath(ctx, scene.walls, '#d71920', scene.closed && !scene.previewWall);

  if (scene.previewWall) {
    drawRedlinePath(ctx, [scene.previewWall], scene.previewWall.lineOnly ? '#f07a21' : '#d71920');
  }
  ctx.restore();
}

function drawSelectedWallHighlight(ctx, scene) {
  const selectedWall = (scene.walls || []).find((wall) => wall.selected);
  if (!selectedWall) return;

  ctx.save();
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(selectedWall.bodyPolygon[0].x, selectedWall.bodyPolygon[0].y);
  for (let index = 1; index < selectedWall.bodyPolygon.length; index += 1) {
    ctx.lineTo(selectedWall.bodyPolygon[index].x, selectedWall.bodyPolygon[index].y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = '#f07a21';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(selectedWall.startPoint.x, selectedWall.startPoint.y);
  ctx.lineTo(selectedWall.endPoint.x, selectedWall.endPoint.y);
  ctx.stroke();
  ctx.restore();
}

function drawDoorOpening(ctx, opening) {
  const wall = opening.wall;
  const swing = Math.min(Math.max(opening.widthPx * 0.72, 16), 42);
  const centerY = opening.centerYPx || 0;
  const openDirection = opening.opening && opening.opening.openDirection === 'outside' ? 'outside' : 'inside';
  const swingSide = openDirection === 'outside'
    ? (wall.measurementSide === 'left' ? 'right' : 'left')
    : wall.measurementSide;
  const sideSign = swingSide === 'left' ? -1 : 1;
  const baseY = centerY + sideSign * 4;
  const swingY = centerY + sideSign * swing;
  const color = opening.selected ? '#f07a21' : '#111827';

  ctx.strokeStyle = color;
  ctx.lineWidth = opening.selected ? 4 : 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(opening.startPx, baseY);
  ctx.lineTo(opening.startPx, swingY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(opening.startPx, baseY, swing, swingSide === 'left' ? -Math.PI / 2 : 0, swingSide === 'left' ? 0 : Math.PI / 2);
  ctx.stroke();
}

function drawWindowOpening(ctx, opening) {
  const y = opening.centerYPx || 0;
  const color = opening.selected ? '#f07a21' : '#0ea5e9';
  ctx.strokeStyle = color;
  ctx.lineWidth = opening.selected ? 6 : 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(opening.startPx, y);
  ctx.lineTo(opening.endPx, y);
  ctx.stroke();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(opening.startPx + 4, y);
  ctx.lineTo(opening.endPx - 4, y);
  ctx.stroke();
}

function drawOpenings(ctx, scene) {
  (scene.openings || []).forEach((opening) => {
    const wall = opening.wall;
    ctx.save();
    ctx.translate(wall.startPoint.x, wall.startPoint.y);
    ctx.rotate(wall.angleRad);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(8, wall.thicknessPx + 4);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(opening.startPx, opening.centerYPx);
    ctx.lineTo(opening.endPx, opening.centerYPx);
    ctx.stroke();

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

function drawDimension(ctx, dimension) {
  const wall = dimension.wall;
  const y = dimension.offset;
  const width = wall.widthPx;
  const arrowSize = clamp(width / 7, 5, 8);
  const inset = Math.min(Math.max(10, arrowSize + 4), Math.max(10, width / 3));
  const labelWidth = Math.max(34, String(dimension.label).length * 8 + 16);
  const labelHeight = DIMENSION_LABEL_HEIGHT_PX;
  const flipLabel = wall.angleDeg > 90 || wall.angleDeg <= -90;

  ctx.save();
  ctx.translate(wall.startPoint.x, wall.startPoint.y);
  ctx.rotate(wall.angleRad);
  ctx.strokeStyle = '#111111';
  ctx.fillStyle = '#111111';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, y);
  ctx.moveTo(width, 0);
  ctx.lineTo(width, y);
  ctx.moveTo(inset, y);
  ctx.lineTo(Math.max(inset, width - inset), y);
  ctx.stroke();

  drawArrow(ctx, inset, y, 1, arrowSize);
  drawArrow(ctx, width - inset, y, -1, arrowSize);

  ctx.save();
  ctx.translate(width / 2, y);
  if (flipLabel) ctx.rotate(Math.PI);
  ctx.fillStyle = 'rgba(196, 210, 222, 0.96)';
  ctx.fillRect(-labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight);
  ctx.fillStyle = '#2875b4';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(dimension.label, 0, 0.5);
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
  ctx.strokeStyle = '#f07a21';
  ctx.lineWidth = 2;
  if (ctx.setLineDash) ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(guide.startPoint.x, guide.startPoint.y);
  ctx.lineTo(guide.endPoint.x, guide.endPoint.y);
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
  ctx.lineWidth = 2;
  if (ctx.setLineDash) ctx.setLineDash([6, 6]);
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
  const half = 24;
  const core = 20;

  ctx.save();
  ctx.strokeStyle = '#f07a21';
  ctx.fillStyle = 'rgba(240, 122, 33, 0.16)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.moveTo(point.x - half, point.y);
  ctx.lineTo(point.x + half, point.y);
  ctx.moveTo(point.x, point.y - half);
  ctx.lineTo(point.x, point.y + half);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f07a21';
  ctx.fillRect(point.x - core / 2, point.y - core / 2, core, core);
  ctx.strokeRect(point.x - core / 2, point.y - core / 2, core, core);
  ctx.restore();
}

function drawSurveyScene(ctx, scene, options) {
  if (!ctx || !scene || !scene.rect.width || !scene.rect.height) return;
  const dpr = (options && options.dpr) || 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.rect.width, scene.rect.height);

  drawGrid(ctx, scene);
  drawAxes(ctx, scene);
  drawWallBodies(ctx, scene);
  drawWallOutlines(ctx, scene);
  drawRedlines(ctx, scene);
  drawSelectedWallHighlight(ctx, scene);
  drawOpenings(ctx, scene);
  drawDimensions(ctx, scene);
  drawAlignmentSnapGuide(ctx, scene);
  drawClosureGuide(ctx, scene);
  drawCursor(ctx, scene);
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
  drawSurveyScene,
  hitTestSurveyWall,
  hitTestSurveyOpening
};
