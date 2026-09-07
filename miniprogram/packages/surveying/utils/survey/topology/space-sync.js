const { buildSpaceBoundaryPoints } = require('./closed-boundary.js');
const polygon = require('../geometry/polygon.js');
const { extractFaces } = require('./face-extractor.js');

// Canonical coordinate order, invariant under cycle reversal/rotation and IDs.
function geometryKey(points) {
  if (!points.length) return '';
  const tokens = points.map(p => [p.xMm, p.yMm]);
  const compare = (a, b) => {
    for (let i = 0; i < a.length; i += 1) {
      const delta = a[i][0] - b[i][0] || a[i][1] - b[i][1];
      if (delta) return delta;
    }
    return 0;
  };
  const cycles = [];
  for (const order of [tokens, tokens.slice().reverse()]) {
    for (let i = 0; i < order.length; i += 1) cycles.push(order.slice(i).concat(order.slice(0, i)));
  }
  return cycles.sort(compare)[0];
}
function compareGeometry(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const delta = a[i][0] - b[i][0] || a[i][1] - b[i][1];
    if (delta) return delta;
  }
  return a.length - b.length;
}
function captureSpaceIdentity(floor) {
  const identities = new Map();
  (floor.spaces || []).filter(space => space && space.closed).forEach(space => {
    const points = buildSpaceBoundaryPoints(floor, space.wallIds);
    identities.set(space.id, { area: polygon.area(points), key: geometryKey(points) });
  });
  return identities;
}

function wallSet(wallIds) {
  return new Set(Array.isArray(wallIds) ? wallIds : []);
}

function overlapCount(faceWallIds, spaceWallIds) {
  const space = wallSet(spaceWallIds);
  let count = 0;
  (faceWallIds || []).forEach((wallId) => {
    if (space.has(wallId)) count += 1;
  });
  return count;
}

function nextRoomName(spaces, usedNames) {
  const taken = new Set(usedNames || []);
  (spaces || []).forEach((space) => {
    if (space && space.name) taken.add(space.name);
  });
  let max = 0;
  taken.forEach((name) => {
    const match = typeof name === 'string' && name.match(/^房间(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  let index = max + 1;
  while (taken.has(`房间${index}`)) index += 1;
  return `房间${index}`;
}

function orientWallIds(faceWallIds, previousWallIds) {
  const ids = (faceWallIds || []).slice();
  if (ids.length < 2 || !Array.isArray(previousWallIds) || previousWallIds.length < 2) return ids;
  const previousPairs = new Set();
  previousWallIds.forEach((wallId, index) => {
    previousPairs.add(`${wallId}>${previousWallIds[(index + 1) % previousWallIds.length]}`);
  });
  function pairScore(order) {
    let score = 0;
    order.forEach((wallId, index) => {
      if (previousPairs.has(`${wallId}>${order[(index + 1) % order.length]}`)) score += 1;
    });
    return score;
  }
  function rotateTo(order, startId) {
    const index = order.indexOf(startId);
    if (index <= 0) return order.slice();
    return order.slice(index).concat(order.slice(0, index));
  }
  const startId = previousWallIds.find((wallId) => ids.indexOf(wallId) !== -1) || ids[0];
  const candidates = [ids, ids.slice().reverse()].map((order) => rotateTo(order, startId));
  return candidates.sort((left, right) => pairScore(right) - pairScore(left))[0];
}

function copyOverrides(previous, wallIds) {
  const allowed = wallSet(wallIds);
  const next = {};
  Object.entries((previous && previous.wallFaceOverrides) || {}).forEach(([wallId, face]) => {
    if (allowed.has(wallId) && (face === 'topology' || face === 'offset')) {
      next[wallId] = face;
    }
  });
  return next;
}

function applyInheritOverrides(spaces, inheritOverrides) {
  if (!inheritOverrides || !Array.isArray(inheritOverrides.wallIds) || !inheritOverrides.wallIds.length) {
    return;
  }
  const face = inheritOverrides.face === 'topology' ? 'topology' : 'offset';
  const prefer = wallSet(inheritOverrides.preferWallIds);
  let best = null;
  let bestScore = -1;
  spaces.forEach((space) => {
    const hasShared = inheritOverrides.wallIds.some((wallId) => space.wallIds.indexOf(wallId) !== -1);
    if (!hasShared) return;
    const preferScore = inheritOverrides.preferWallIds
      ? inheritOverrides.preferWallIds.filter((wallId) => space.wallIds.indexOf(wallId) !== -1).length
      : 0;
    if (preferScore > bestScore || (preferScore === bestScore && prefer.size && preferScore > 0)) {
      best = space;
      bestScore = preferScore;
    }
  });
  if (!best) return;
  const overrides = Object.assign({}, best.wallFaceOverrides || {});
  inheritOverrides.wallIds.forEach((wallId) => {
    if (best.wallIds.indexOf(wallId) !== -1) overrides[wallId] = face;
  });
  if (Object.keys(overrides).length) best.wallFaceOverrides = overrides;
}

function syncClosedSpacesFromFaces(floor, options) {
  const opts = options || {};
  if (typeof opts.nextId !== 'function') {
    throw new TypeError('syncClosedSpacesFromFaces 需要 nextId');
  }
  const faceResult = extractFaces(floor);
  const identities = opts.previousIdentity || captureSpaceIdentity(floor);
  const existingClosed = (floor.spaces || []).filter((space) => space && space.closed);
  const openSpaces = (floor.spaces || []).filter((space) => space && !space.closed);
  const pairs = [];
  faceResult.faces.forEach((face, faceIndex) => {
    existingClosed.forEach((space, spaceIndex) => {
      const overlap = overlapCount(face.wallIds, space.wallIds);
      if (!overlap) return;
      pairs.push({
        faceIndex,
        spaceIndex,
        overlap,
        delta: Math.abs((face.wallIds || []).length - (space.wallIds || []).length)
      });
    });
  });
  pairs.sort((left, right) => {
    const leftFace = faceResult.faces[left.faceIndex];
    const rightFace = faceResult.faces[right.faceIndex];
    const leftOld = identities.get(existingClosed[left.spaceIndex].id);
    const rightOld = identities.get(existingClosed[right.spaceIndex].id);
    const exact = pair => pair.overlap === faceResult.faces[pair.faceIndex].wallIds.length &&
      pair.overlap === existingClosed[pair.spaceIndex].wallIds.length;
    return Number(exact(right)) - Number(exact(left)) || rightFace.areaMm2 - leftFace.areaMm2 ||
      ((rightOld && rightOld.area) || 0) - ((leftOld && leftOld.area) || 0) ||
      compareGeometry(geometryKey(leftFace.points), geometryKey(rightFace.points)) ||
      compareGeometry((leftOld && leftOld.key) || [], (rightOld && rightOld.key) || []) ||
      existingClosed[left.spaceIndex].id.localeCompare(existingClosed[right.spaceIndex].id);
  });

  const faceToSpace = new Map();
  const usedFaces = new Set();
  const usedSpaces = new Set();
  pairs.forEach((pair) => {
    if (usedFaces.has(pair.faceIndex) || usedSpaces.has(pair.spaceIndex)) return;
    usedFaces.add(pair.faceIndex);
    usedSpaces.add(pair.spaceIndex);
    faceToSpace.set(pair.faceIndex, existingClosed[pair.spaceIndex]);
  });

  const usedNames = [];
  const reused = [];
  const created = [];
  faceResult.faces.forEach((face, faceIndex) => {
    const previous = faceToSpace.get(faceIndex) || null;
    const name = previous && previous.name
      ? previous.name
      : nextRoomName(existingClosed.concat(openSpaces).concat(reused).concat(created), usedNames);
    usedNames.push(name);
    const orientationSource = previous && previous.wallIds
      ? previous.wallIds
      : (opts.inheritOverrides && opts.inheritOverrides.preferWallIds);
    const space = {
      id: previous ? previous.id : opts.nextId('space'),
      name,
      wallIds: orientWallIds(face.wallIds, orientationSource),
      closed: true,
      source: previous && previous.source ? previous.source : 'measured'
    };
    const overrides = copyOverrides(previous, space.wallIds);
    if (Object.keys(overrides).length) space.wallFaceOverrides = overrides;
    if (previous) reused.push(space);
    else created.push(space);
  });
  // Keep existing owners in their previous order. Inferred shared-wall bodies
  // must not flip merely because the Face extractor enumerated a new first face.
  reused.sort((a, b) => existingClosed.findIndex(s => s.id === a.id) - existingClosed.findIndex(s => s.id === b.id));
  const nextClosed = reused.concat(created);

  applyInheritOverrides(nextClosed, opts.inheritOverrides);
  floor.spaces = openSpaces.concat(nextClosed);
  return {
    faces: faceResult.faces,
    dangles: faceResult.dangles,
    spaces: nextClosed
  };
}

module.exports = {
  captureSpaceIdentity,
  syncClosedSpacesFromFaces,
  overlapCount
};
