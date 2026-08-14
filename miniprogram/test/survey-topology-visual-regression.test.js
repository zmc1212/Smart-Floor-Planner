const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVisualCases } = require('./helpers/surveyTopologyVisualCases.js');

function pointOnSegment(point, start, end, tolerance) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance;
  const t = Math.max(0, Math.min(1, (
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y)
  ) / lengthSquared));
  const projected = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  };
  return Math.hypot(point.x - projected.x, point.y - projected.y) <= tolerance;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(point, start, end, 0.0001)) return true;
    const intersects = ((end.y > point.y) !== (start.y > point.y)) &&
      point.x < (start.x - end.x) * (point.y - end.y) / ((start.y - end.y) || 1) + end.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInRings(point, rings) {
  if ((rings || []).some((ring) => ring.some((end, index) => (
    pointOnSegment(point, ring[(index - 1 + ring.length) % ring.length], end, 0.001)
  )))) return true;
  return (rings || []).reduce((inside, ring) => (
    pointInPolygon(point, ring) ? !inside : inside
  ), false);
}

function pointInAnyWallBody(point, walls) {
  return (walls || []).some((wall) => pointInPolygon(point, wall.bodyPolygon));
}

function countMissingBodyPixels(caseItem) {
  const radius = 28;
  const samplesPerPixel = 4;
  const missingByCanvasPixel = new Map();
  const missingPoints = [];
  let expected = 0;
  for (let y = -radius * samplesPerPixel; y <= radius * samplesPerPixel; y += 1) {
    for (let x = -radius * samplesPerPixel; x <= radius * samplesPerPixel; x += 1) {
      const point = {
        x: caseItem.junctionPx.x + x / samplesPerPixel,
        y: caseItem.junctionPx.y + y / samplesPerPixel
      };
      if (!pointInAnyWallBody(point, caseItem.scene.walls)) continue;
      expected += 1;
      if (!pointInRings(point, caseItem.scene.wallSolidPlan.rings)) {
        const pixelKey = `${Math.floor(point.x)}:${Math.floor(point.y)}`;
        missingByCanvasPixel.set(pixelKey, (missingByCanvasPixel.get(pixelKey) || 0) + 1);
        missingPoints.push(point);
      }
    }
  }
  return {
    missing: missingPoints.length,
    fullyMissingCanvasPixels: Array.from(missingByCanvasPixel.values())
      .filter((count) => count >= samplesPerPixel * samplesPerPixel).length,
    missingPoints,
    expected
  };
}

function findInternalOutlineSegments(caseItem) {
  return (caseItem.scene.wallSolidPlan.segments || []).filter((segment) => {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.05) return true;
    const midpoint = {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2
    };
    if (Math.hypot(
      midpoint.x - caseItem.junctionPx.x,
      midpoint.y - caseItem.junctionPx.y
    ) > 28) return false;
    const normal = { x: -dy / length, y: dx / length };
    const left = { x: midpoint.x + normal.x * 0.2, y: midpoint.y + normal.y * 0.2 };
    const right = { x: midpoint.x - normal.x * 0.2, y: midpoint.y - normal.y * 0.2 };
    return pointInAnyWallBody(left, caseItem.scene.walls) &&
      pointInAnyWallBody(right, caseItem.scene.walls);
  });
}

test('representative topology scenes have no visible background holes at wall junctions', () => {
  buildVisualCases().forEach((caseItem) => {
    assert.ok(caseItem.scene.wallSolidPlan.rings.length > 0, `${caseItem.name}: solid outline is open`);
    const coverage = countMissingBodyPixels(caseItem);
    assert.ok(coverage.expected > 0, `${caseItem.name}: no wall pixels were sampled`);
    assert.equal(
      coverage.fullyMissingCanvasPixels,
      0,
      `${caseItem.name}: ${coverage.fullyMissingCanvasPixels} full visible pixels contain ` +
        `${coverage.missing}/${coverage.expected} missing subpixel samples; ` +
        `first=${JSON.stringify(coverage.missingPoints.slice(0, 3))}`
    );
  });
});

test('representative topology scenes have no internal cap or seam in the visible junction', () => {
  buildVisualCases().forEach((caseItem) => {
    const internalSegments = findInternalOutlineSegments(caseItem);
    assert.deepEqual(
      internalSegments,
      [],
      `${caseItem.name}: ${internalSegments.length} internal outline segments would be drawn black`
    );
  });
});
