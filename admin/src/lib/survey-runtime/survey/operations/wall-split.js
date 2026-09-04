const { nextId, nowIso } = require('../core/runtime-id.js');
const { findClosedSpacesForWall } = require('../topology/closed-boundary.js');
const { buildBaseWallSegment } = require('../read-model/wall-geometry.js');
const { getNode, getWall } = require('../core/graph-query.js');
const { ensureOpenings, normalizeOpeningToWall, refreshWallMetrics, syncFloorSpaces } = require('./wall-mutation-helpers.js');
const { createSurveyDomainError, SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES } = require('../domain/errors.js');
const { getActiveFloor } = require('../core/draft.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');
const { wrapOperation } = require('./transaction.js');

const vector2 = require('../geometry/vector2.js');

const wallDomain = require('../domain/wall.js');
const normalForMeasurementSide = wallDomain.normalForMeasurementSide;
const dot = vector2.dot;

const segmentGeometry = require('../geometry/segment.js');
const projectPointToWallSegment = segmentGeometry.projectPointToSegment;
const distanceMm = vector2.distanceMm;

const getWallMeasurementInsets = wallDomain.measurementInsets;
const normalizeMeasurementExtension = wallDomain.normalizeMeasurementAdjustment;

const openingDomain = require('../domain/opening.js');
const normalizeOpeningDirection = openingDomain.normalizeOpeningDirection;

function cloneWallSegment(sourceWall, startNodeId, endNodeId, id) {
  return {
    id: id || nextId('wall'),
    topologySourceWallId: sourceWall.topologySourceWallId || sourceWall.id,
    startNodeId,
    endNodeId,
    mode: sourceWall.mode,
    lengthMm: sourceWall.lengthMm,
    angleDeg: sourceWall.angleDeg,
    thicknessMm: sourceWall.thicknessMm,
    measurementSide: sourceWall.measurementSide,
    bodyNormalSide: sourceWall.bodyNormalSide || '',
    measurementStartInsetMm: 0,
    measurementStartExtensionMm: 0,
    measurementEndInsetMm: 0,
    inputSource: sourceWall.inputSource || 'manual',
    angleSource: sourceWall.angleSource || '',
    angleInteriorDeg: Number.isFinite(sourceWall.angleInteriorDeg) ? sourceWall.angleInteriorDeg : null,
    status: sourceWall.status || 'confirmed',
    measuredAt: sourceWall.measuredAt || nowIso()
  };
}

function preserveSharedWallBodyNormalSide(floor, wall) {
  if (!floor || !wall || wall.bodyNormalSide === 'left' || wall.bodyNormalSide === 'right') {
    return wall;
  }
  if (findClosedSpacesForWall(floor, wall.id).length < 2) return wall;

  const segment = buildBaseWallSegment(floor, wall);
  const leftNormal = segment && normalForMeasurementSide(segment.start, segment.end, 'left');
  const rightNormal = segment && normalForMeasurementSide(segment.start, segment.end, 'right');
  if (!segment || !leftNormal || !rightNormal) return wall;

  // A shared wall with no explicit body side currently derives its physical
  // side from the first closed Space that references it. After a split, each
  // replacement segment can have a different first Space, which flips one
  // half of the same wall by a full thickness. Freeze the pre-split rendered
  // normal once so every clone preserves the already visible wall body.
  wall.bodyNormalSide = dot(segment.normal, leftNormal) >= dot(segment.normal, rightNormal)
    ? 'left'
    : 'right';
  return wall;
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

function orderReplacementWallIdsForSpace(floor, wallIds, wallId, replacementIds) {
  const index = wallIds.indexOf(wallId);
  if (index < 0 || !replacementIds.length) return replacementIds.slice();
  const previousWall = getWall(floor, wallIds[(index - 1 + wallIds.length) % wallIds.length]);
  const nextWall = getWall(floor, wallIds[(index + 1) % wallIds.length]);
  const previousNodeIds = previousWall
    ? [previousWall.startNodeId, previousWall.endNodeId]
    : [];
  const nextNodeIds = nextWall
    ? [nextWall.startNodeId, nextWall.endNodeId]
    : [];
  const first = getWall(floor, replacementIds[0]);
  const last = getWall(floor, replacementIds[replacementIds.length - 1]);
  if (!first || !last) return replacementIds.slice();

  const forwardConnects = previousNodeIds.includes(first.startNodeId) &&
    nextNodeIds.includes(last.endNodeId);
  const reverseConnects = previousNodeIds.includes(last.endNodeId) &&
    nextNodeIds.includes(first.startNodeId);
  return reverseConnects && !forwardConnects
    ? replacementIds.slice().reverse()
    : replacementIds.slice();
}

function replaceWallInSpaces(floor, wallId, replacementIds) {
  floor.spaces = (floor.spaces || []).map((space) => {
    if (!Array.isArray(space.wallIds) || space.wallIds.indexOf(wallId) === -1) return space;
    const wallIds = [];
    const orderedReplacementIds = orderReplacementWallIdsForSpace(
      floor,
      space.wallIds,
      wallId,
      replacementIds
    );
    space.wallIds.forEach((id) => {
      if (id === wallId) {
        orderedReplacementIds.forEach((replacementId) => wallIds.push(replacementId));
      } else {
        wallIds.push(id);
      }
    });
    const wallFaceOverrides = Object.assign({}, space.wallFaceOverrides || {});
    if (wallFaceOverrides[wallId]) {
      const face = wallFaceOverrides[wallId];
      delete wallFaceOverrides[wallId];
      orderedReplacementIds.forEach((replacementId) => {
        wallFaceOverrides[replacementId] = face;
      });
    }
    const nextSpace = Object.assign({}, space, { wallIds });
    if (Object.keys(wallFaceOverrides).length) {
      nextSpace.wallFaceOverrides = wallFaceOverrides;
    } else {
      delete nextSpace.wallFaceOverrides;
    }
    return nextSpace;
  });
}

function remapOpeningsForSplitWall(floor, originalWall, segments) {
  const originalStartAlongMm = getWallMeasurementInsets(originalWall).start -
    normalizeMeasurementExtension(originalWall.measurementStartExtensionMm);
  ensureOpenings(floor).forEach((opening) => {
    if (opening.wallId !== originalWall.id) return;
    const centerOffset = (opening.centerOffsetMm || 0) + originalStartAlongMm;
    const target = segments.find((segment) => (
      centerOffset >= segment.startAlongMm - 1 &&
      centerOffset <= segment.endAlongMm + 1
    )) || segments[segments.length - 1];
    if (!target) return;
    opening.wallId = target.wall.id;
    const targetStartAlongMm = getWallMeasurementInsets(target.wall).start -
      normalizeMeasurementExtension(target.wall.measurementStartExtensionMm);
    opening.centerOffsetMm = Math.round(
      centerOffset -
      target.startAlongMm -
      targetStartAlongMm
    );
    normalizeOpeningToWall(floor, opening);
    normalizeOpeningDirection(opening);
  });
}

function resolveOpeningSplitClearanceMm(floor, originalWall, cutNode) {
  const sourceId = originalWall.topologySourceWallId || originalWall.id;
  const incidentThicknesses = (floor.walls || [])
    .filter((wall) => (
      wall &&
      wall.id !== originalWall.id &&
      (wall.topologySourceWallId || wall.id) !== sourceId &&
      cutNode &&
      (wall.startNodeId === cutNode.id || wall.endNodeId === cutNode.id)
    ))
    .map((wall) => Number(wall.thicknessMm) || 0);
  return Math.max(
    0,
    Number(floor.session && floor.session.thicknessMm) || 0,
    ...incidentThicknesses
  );
}

function assertSplitCutsAvoidOpenings(floor, originalWall, cutItems, wallLength) {
  const openings = (Array.isArray(floor.openings) ? floor.openings : []).filter((opening) => (
    opening && opening.wallId === originalWall.id
  ));
  if (!openings.length) return;

  const openingOriginAlongMm = getWallMeasurementInsets(originalWall).start -
    normalizeMeasurementExtension(originalWall.measurementStartExtensionMm);
  const interiorCuts = (cutItems || []).filter((item) => (
    item && item.node && item.alongMm > 1 && item.alongMm < wallLength - 1
  ));
  if (!interiorCuts.length) return;

  for (let openingIndex = 0; openingIndex < openings.length; openingIndex += 1) {
    const opening = openings[openingIndex];
    const range = openingDomain.getOpeningRange(opening);
    const openingStartAlongMm = openingOriginAlongMm + range.startMm;
    const openingEndAlongMm = openingOriginAlongMm + range.endMm;
    for (let cutIndex = 0; cutIndex < interiorCuts.length; cutIndex += 1) {
      const cut = interiorCuts[cutIndex];
      const clearanceMm = resolveOpeningSplitClearanceMm(floor, originalWall, cut.node);
      if (
        openingEndAlongMm < cut.alongMm - clearanceMm ||
        openingStartAlongMm > cut.alongMm + clearanceMm
      ) {
        continue;
      }
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.OPENING_SPLIT_CONFLICT, {
        wallId: originalWall.id,
        openingId: opening.id,
        cutAlongMm: cut.alongMm,
        clearanceMm
      });
    }
  }
}

// Plans own detached replacement walls. No graph/session writes occur until apply.
function planWallSplit(floor, wallId, cutNodeIds) {
  const wallIndex = floor.walls.findIndex((wall) => wall.id === wallId);
  const sourceWall = floor.walls[wallIndex];
  if (wallIndex === -1 || !sourceWall) {
    return { kind: 'split-wall', floorId: floor.id, wallId, noop: true };
  }
  const originalWall = Object.assign({}, sourceWall);

  const originalAdjustmentMetadata = {
    hasRaw: Object.prototype.hasOwnProperty.call(originalWall, 'rawMeasuredLengthMm'),
    hasAdjustment: Object.prototype.hasOwnProperty.call(originalWall, 'closureAdjustmentMm'),
    rawMeasuredLengthMm: originalWall.rawMeasuredLengthMm,
    closureAdjustmentMm: originalWall.closureAdjustmentMm,
    adjustmentSource: originalWall.adjustmentSource,
    hasComplete: Object.prototype.hasOwnProperty.call(originalWall, 'rawMeasuredLengthMm') &&
      Object.prototype.hasOwnProperty.call(originalWall, 'closureAdjustmentMm') &&
      Number.isFinite(Number(originalWall.rawMeasuredLengthMm)) &&
      Number.isFinite(Number(originalWall.closureAdjustmentMm))
  };

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
  assertSplitCutsAvoidOpenings(floor, originalWall, cutItems, wallLength);
  if (cutItems.length > 2) {
    preserveSharedWallBodyNormalSide(floor, originalWall);
  }

  const segmentRecords = [];
  for (let index = 0; index < cutItems.length - 1; index += 1) {
    const current = cutItems[index];
    const next = cutItems[index + 1];
    if (!current.node || !next.node || Math.abs(next.alongMm - current.alongMm) <= 1) {
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

  if (!segmentRecords.length) {
    return { kind: 'split-wall', floorId: floor.id, wallId, noop: true, normalizeOpenings: true };
  }
  const originalInsets = getWallMeasurementInsets(originalWall);
  const originalStartExtension = normalizeMeasurementExtension(originalWall.measurementStartExtensionMm);
  segmentRecords[0].wall.measurementStartInsetMm = originalInsets.start;
  segmentRecords[0].wall.measurementStartExtensionMm = originalStartExtension;
  segmentRecords[segmentRecords.length - 1].wall.measurementEndInsetMm = originalInsets.end;
  refreshWallMetrics({ nodes: floor.nodes, walls: segmentRecords.map((record) => record.wall) });
  if (originalAdjustmentMetadata.hasComplete) {
    // Preserve the aggregate audit pair across a split without copying the
    // whole reading to every clone. Allocate the raw reading by each segment's
    // effective measured span; the final segment receives the rounding tail so
    // raw readings and adjustments still sum exactly to the original pair.
    const rawTotal = Math.max(0, Math.round(Number(originalAdjustmentMetadata.rawMeasuredLengthMm)));
    const totalMeasuredLength = segmentRecords.reduce(
      (total, record) => total + Math.max(0, Number(record.wall.lengthMm) || 0),
      0
    );
    let allocatedRaw = 0;
    segmentRecords.forEach((record, index) => {
      const rawMeasuredLengthMm = index === segmentRecords.length - 1
        ? rawTotal - allocatedRaw
        : (totalMeasuredLength > 0
          ? Math.floor(rawTotal * Math.max(0, Number(record.wall.lengthMm) || 0) / totalMeasuredLength)
          : 0);
      allocatedRaw += rawMeasuredLengthMm;
      record.wall.rawMeasuredLengthMm = rawMeasuredLengthMm;
      record.wall.closureAdjustmentMm = Math.round(record.wall.lengthMm - rawMeasuredLengthMm);
      if (originalAdjustmentMetadata.adjustmentSource) {
        record.wall.adjustmentSource = originalAdjustmentMetadata.adjustmentSource;
      }
    });
  } else {
    // Incomplete source metadata cannot be allocated safely. Keep the split
    // geometrically valid and require an explicit remeasure for new readings.
    segmentRecords.forEach((record) => {
      delete record.wall.rawMeasuredLengthMm;
      delete record.wall.closureAdjustmentMm;
      delete record.wall.adjustmentSource;
    });
  }
  return { kind: 'split-wall', floorId: floor.id, wallId, wallIndex, originalWall, segmentRecords };
}

function applyWallSplitPlan(floor, plan) {
  if (!plan || plan.kind !== 'split-wall' || plan.floorId !== floor.id) {
    throw new TypeError('墙体分裂计划与当前楼层不匹配');
  }
  if (plan.noop) {
    if (plan.normalizeOpenings) ensureOpenings(floor);
    return { changed: false, kind: plan.kind, sharedWallId: plan.wallId, segmentIds: [plan.wallId] };
  }
  // Do not alias the plan into the graph: it can be frozen and replayed in tests.
  const segmentRecords = plan.segmentRecords.map(record => ({ ...record, wall: { ...record.wall } }));
  floor.walls.splice(plan.wallIndex, 1, ...segmentRecords.map(record => record.wall));
  refreshWallMetrics(floor);
  replaceWallInSpaces(floor, plan.wallId, segmentRecords.map(record => record.wall.id));
  remapOpeningsForSplitWall(floor, plan.originalWall, segmentRecords);

  return {
    changed: true,
    kind: plan.kind,
    segmentIds: segmentRecords.map((record) => record.wall.id),
    getSegmentBetween(nodeAId, nodeBId) {
      return segmentRecords.find((record) => (
        (record.wall.startNodeId === nodeAId && record.wall.endNodeId === nodeBId) ||
        (record.wall.startNodeId === nodeBId && record.wall.endNodeId === nodeAId)
      ));
    }
  };
}

// Composable internal step: the enclosing commit/closure transaction owns the
// final face sync and full validation, after all divider cuts have been applied.
function splitWallAtNodes(floor, wallId, cutNodeIds) {
  const result = applyWallSplitPlan(floor, planWallSplit(floor, wallId, cutNodeIds));
  // Preserve the historical internal result shape for callers in closure code.
  const { changed, kind, ...legacyResult } = result;
  return legacyResult;
}

// Standalone transaction for this operation family, not a new public facade export.
const splitWall = wrapOperation('splitWallAtNodes', adaptLegacySurveyOperation((draft, wallId, cutNodeIds) => {
  const floor = getActiveFloor(draft, { requireFloorList: true });
  splitWallAtNodes(floor, wallId, cutNodeIds);
  syncFloorSpaces(floor);
  return draft;
}), { mode: 'full' });

module.exports = {
  cloneWallSegment,
  preserveSharedWallBodyNormalSide,
  pointAlongWall,
  uniqueCutNodesByAlong,
  orderReplacementWallIdsForSpace,
  replaceWallInSpaces,
  remapOpeningsForSplitWall,
  resolveOpeningSplitClearanceMm,
  assertSplitCutsAvoidOpenings,
  splitWallAtNodes,
  planWallSplit,
  applyWallSplitPlan,
  splitWall
};
