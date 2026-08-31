const { normalizeDeg, shortestArcDeg } = require('./surveyDeviceOrientation.js');

const DEFAULT_ACTIVATE_DEG = 12;
const DEFAULT_SWITCH_DEG = 15;
const DEFAULT_EXCLUDE_TOLERANCE_DEG = 5;
const DEFAULT_ARROW_LENGTH_MM = 800;

const ORTHOGONAL_DIRECTIONS = [
  { key: 'east', bearingDeg: 0, unitVector: { x: 1, y: 0 } },
  { key: 'south', bearingDeg: 90, unitVector: { x: 0, y: 1 } },
  { key: 'west', bearingDeg: 180, unitVector: { x: -1, y: 0 } },
  { key: 'north', bearingDeg: -90, unitVector: { x: 0, y: -1 } }
];

function rotateVector(x, y, rotationRad) {
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos
  };
}

function getIncomingWallAtAnchor(floor, anchorNodeId, session) {
  if (!floor || !anchorNodeId || !Array.isArray(floor.walls)) return null;
  const activeStartIndex = session && Number.isInteger(session.activeSpaceStartWallIndex)
    ? Math.max(0, Math.min(floor.walls.length, session.activeSpaceStartWallIndex))
    : 0;
  for (let index = floor.walls.length - 1; index >= activeStartIndex; index -= 1) {
    const wall = floor.walls[index];
    if (wall.endNodeId === anchorNodeId) return wall;
  }
  for (let index = floor.walls.length - 1; index >= activeStartIndex; index -= 1) {
    const wall = floor.walls[index];
    if (wall.startNodeId === anchorNodeId) return wall;
  }
  return null;
}

function angleDeg(a, b) {
  if (!a || !b) return 0;
  const radians = Math.atan2(b.yMm - a.yMm, b.xMm - a.xMm);
  let degrees = radians * 180 / Math.PI;
  while (degrees <= -180) degrees += 360;
  while (degrees > 180) degrees -= 360;
  return Math.round(degrees * 10) / 10;
}

function getIncomingBearingAtAnchor(floor, wall, anchorNodeId) {
  if (!wall || !floor || !anchorNodeId) return null;
  const start = floor.nodes && floor.nodes.find((node) => node.id === wall.startNodeId);
  const end = floor.nodes && floor.nodes.find((node) => node.id === wall.endNodeId);
  if (!start || !end) return null;
  return wall.endNodeId === anchorNodeId
    ? angleDeg(start, end)
    : angleDeg(end, start);
}

function isBacktrackBearing(bearingDeg, incomingBearingDeg, toleranceDeg) {
  if (incomingBearingDeg === null || incomingBearingDeg === undefined) return false;
  const backtrackDeg = normalizeDeg(incomingBearingDeg + 180);
  return Math.abs(shortestArcDeg(bearingDeg - backtrackDeg)) <= toleranceDeg;
}

function projectTipToScreen(tipPointMm, viewport, rect) {
  if (!tipPointMm || !viewport || !rect) return null;
  const scale = Number(viewport.scale);
  const resolvedScale = Number.isFinite(scale) && scale > 0 ? scale : 0.05;
  const offsetX = Number(viewport.offsetX) || 0;
  const offsetY = Number(viewport.offsetY) || 0;
  const rotationRad = Number(viewport.rotationRad) || 0;
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  const rotated = rotateVector(
    tipPointMm.xMm * resolvedScale,
    tipPointMm.yMm * resolvedScale,
    rotationRad
  );
  return {
    x: width / 2 + offsetX + rotated.x,
    y: height / 2 + offsetY + rotated.y
  };
}

function buildBleDirectionOptions(params) {
  const options = params || {};
  const anchor = options.anchor;
  const floor = options.floor;
  const session = options.session;
  const viewport = options.viewport;
  const rect = options.rect;
  const projectPoint = options.projectPoint;
  const arrowLengthMm = Number.isFinite(Number(options.arrowLengthMm))
    ? Math.max(1, Math.round(Number(options.arrowLengthMm)))
    : DEFAULT_ARROW_LENGTH_MM;
  const excludeToleranceDeg = Number.isFinite(Number(options.excludeToleranceDeg))
    ? Number(options.excludeToleranceDeg)
    : DEFAULT_EXCLUDE_TOLERANCE_DEG;

  if (!anchor || !session || session.mode !== 'straight') {
    return [];
  }

  const incomingWall = getIncomingWallAtAnchor(floor, session.anchorNodeId, session);
  const incomingBearingDeg = getIncomingBearingAtAnchor(floor, incomingWall, session.anchorNodeId);

  return ORTHOGONAL_DIRECTIONS
    .filter((direction) => (
      !isBacktrackBearing(direction.bearingDeg, incomingBearingDeg, excludeToleranceDeg)
    ))
    .map((direction) => {
      const tipPointMm = {
        xMm: Math.round(anchor.xMm + direction.unitVector.x * arrowLengthMm),
        yMm: Math.round(anchor.yMm + direction.unitVector.y * arrowLengthMm)
      };
      const screenPoint = typeof projectPoint === 'function'
        ? projectPoint(tipPointMm)
        : projectTipToScreen(tipPointMm, viewport, rect);

      return {
        key: direction.key,
        bearingDeg: direction.bearingDeg,
        unitVector: { x: direction.unitVector.x, y: direction.unitVector.y },
        tipPointMm,
        screenPoint
      };
    });
}

function mapDeviceHeadingToWorldBearing(deviceAlphaDeg, viewRotationDeg, baselineOffsetDeg) {
  const alpha = Number(deviceAlphaDeg);
  const rotation = Number(viewRotationDeg) || 0;
  const offset = Number(baselineOffsetDeg) || 0;
  if (!Number.isFinite(alpha)) return null;
  // Compass direction is 0=north and grows clockwise. The shared heading hub
  // exposes its compatible alpha as 360-direction, while survey bearings use
  // 0=east and grow clockwise on the y-down canvas. Convert to screen bearing
  // first, then remove the current view-only rotation to recover graph bearing.
  return normalizeDeg(-alpha - 90 - rotation + offset);
}

function angularDistanceDeg(aDeg, bDeg) {
  return Math.abs(shortestArcDeg(Number(aDeg) - Number(bDeg)));
}

function pickDirectionWithHysteresis(candidates, headingDeg, previousKey, options) {
  const opts = options || {};
  const activateDeg = Number.isFinite(Number(opts.activateDeg))
    ? Number(opts.activateDeg)
    : DEFAULT_ACTIVATE_DEG;
  const switchDeg = Number.isFinite(Number(opts.switchDeg))
    ? Number(opts.switchDeg)
    : DEFAULT_SWITCH_DEG;
  const parsedHeading = Number(headingDeg);

  if (!Array.isArray(candidates) || !candidates.length || !Number.isFinite(parsedHeading)) {
    return null;
  }

  const scored = candidates.map((candidate) => ({
    candidate,
    delta: angularDistanceDeg(candidate.bearingDeg, parsedHeading)
  })).sort((left, right) => left.delta - right.delta);

  const best = scored[0];
  if (!best) return null;

  if (!previousKey) {
    return best.delta <= activateDeg ? best.candidate.key : null;
  }

  const current = candidates.find((candidate) => candidate.key === previousKey);
  if (!current) {
    return best.delta <= activateDeg ? best.candidate.key : null;
  }

  if (best.candidate.key === previousKey) {
    return previousKey;
  }

  const currentDelta = angularDistanceDeg(current.bearingDeg, parsedHeading);
  if (currentDelta - best.delta >= switchDeg) {
    return best.candidate.key;
  }

  return previousKey;
}

module.exports = {
  DEFAULT_ACTIVATE_DEG,
  DEFAULT_SWITCH_DEG,
  DEFAULT_EXCLUDE_TOLERANCE_DEG,
  DEFAULT_ARROW_LENGTH_MM,
  ORTHOGONAL_DIRECTIONS,
  getIncomingWallAtAnchor,
  getIncomingBearingAtAnchor,
  isBacktrackBearing,
  buildBleDirectionOptions,
  mapDeviceHeadingToWorldBearing,
  angularDistanceDeg,
  pickDirectionWithHysteresis,
  projectTipToScreen
};
