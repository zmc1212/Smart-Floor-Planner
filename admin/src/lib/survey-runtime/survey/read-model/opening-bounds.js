const { buildBaseWallSegment, buildResolvedSegment } = require('./wall-geometry.js');

// Clip an incident wall body to the host thickness strip before projecting it.
// Projecting its whole polygon would over-reserve space at diagonal corners.
function clipY(points, boundary, sign) {
  const result = [];
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const inside = sign * (point.y - boundary) >= -1e-7;
    const previousInside = sign * (previous.y - boundary) >= -1e-7;
    if (inside !== previousInside) {
      const t = (boundary - previous.y) / (point.y - previous.y);
      result.push({ x: previous.x + t * (point.x - previous.x), y: boundary });
    }
    if (inside) result.push(point);
  });
  return result;
}

function getOpeningHostBounds(floor, wall) {
  const bounds = { startMm: 0, endMm: Number(wall && wall.lengthMm) || 0 };
  if (!floor || !wall) return bounds;
  const host = buildResolvedSegment(floor, wall);
  if (!host || !host.lengthMm) return bounds;
  bounds.endMm = Math.min(bounds.endMm, host.lengthMm);
  const scale = 1;
  const local = (point) => {
    const x = point.xMm - host.start.xMm;
    const y = point.yMm - host.start.yMm;
    return { x: x * host.direction.x + y * host.direction.y,
      y: x * host.normal.x + y * host.normal.y };
  };
  (floor.walls || []).forEach((other) => {
    if (other.id === wall.id) return;
    const atStart = other.startNodeId === wall.startNodeId || other.endNodeId === wall.startNodeId;
    const atEnd = other.startNodeId === wall.endNodeId || other.endNodeId === wall.endNodeId;
    if (!atStart && !atEnd) return;
    const body = buildBaseWallSegment(floor, other);
    if (!body || Math.abs(host.direction.x * body.direction.y - host.direction.y * body.direction.x) < 1e-7) return;
    let polygon = [body.start, body.end, body.outerEnd, body.outerStart].map(local);
    polygon = clipY(clipY(polygon, 0, 1), host.thicknessMm, -1);
    if (polygon.length < 3) return;
    const area = Math.abs(polygon.reduce((sum, p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0));
    if (area < 1e-7) return;
    const low = Math.min(...polygon.map(p => p.x));
    const high = Math.max(...polygon.map(p => p.x));
    if (atStart) bounds.startMm = Math.max(bounds.startMm, Math.ceil(high * scale - 1e-7));
    if (atEnd) bounds.endMm = Math.min(bounds.endMm, Math.floor(low * scale + 1e-7));
  });
  return bounds;
}

module.exports = { getOpeningHostBounds };
