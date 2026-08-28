const spaceDomain = require('../domain/space.js');
const polygon = require('../geometry/polygon.js');
const { extractFaces } = require('./face-extractor.js');

function boundaryKey(wallIds) {
  return (wallIds || []).slice().sort().join('|');
}

function compareClosedSpacesToFaces(floor, options) {
  const stopOnCountMismatch = !options || options.stopOnCountMismatch !== false;
  const faceResult = extractFaces(floor);
  const closedSpaces = (floor.spaces || []).filter((space) => space && space.closed);
  const mismatches = [];

  if (faceResult.faces.length !== closedSpaces.length) {
    mismatches.push({
      code: 'FACE_SPACE_MISMATCH',
      path: 'spaces',
      message: `半边诊断得到 ${faceResult.faces.length} 个有界面，但墙图保存了 ${closedSpaces.length} 个闭合空间`,
      details: {
        faceCount: faceResult.faces.length,
        spaceCount: closedSpaces.length
      }
    });
    if (stopOnCountMismatch) {
      return summarize(faceResult, closedSpaces, mismatches);
    }
  }

  const availableFaces = faceResult.faces.slice();
  closedSpaces.forEach((space) => {
    const key = boundaryKey(space.wallIds);
    const faceIndex = availableFaces.findIndex((face) => boundaryKey(face.wallIds) === key);
    if (faceIndex < 0) {
      mismatches.push({
        code: 'FACE_BOUNDARY_MISMATCH',
        path: `spaces.${space.id}.wallIds`,
        message: `空间 ${space.id} 的边界与 Face shadow 不一致`,
        details: {
          spaceWallIds: (space.wallIds || []).slice(),
          remainingFaceKeys: availableFaces.map((face) => boundaryKey(face.wallIds))
        }
      });
      return;
    }
    const face = availableFaces.splice(faceIndex, 1)[0];
    const nodeCycle = spaceDomain.buildSpaceNodeCycle(space, faceResult.index);
    const points = nodeCycle.map((nodeId) => faceResult.index.nodesById.get(nodeId)).filter(Boolean);
    const spaceAreaMm2 = polygon.area(points);
    if (Math.abs(spaceAreaMm2 - face.areaMm2) > 1) {
      mismatches.push({
        code: 'FACE_AREA_MISMATCH',
        path: `spaces.${space.id}`,
        message: `空间 ${space.id} 的拓扑面积与 Face shadow 不一致`,
        details: {
          spaceAreaMm2,
          faceAreaMm2: face.areaMm2
        }
      });
    }
  });

  return summarize(faceResult, closedSpaces, mismatches);
}

function summarize(faceResult, closedSpaces, mismatches) {
  return {
    ok: mismatches.length === 0,
    faceCount: faceResult.faces.length,
    spaceCount: closedSpaces.length,
    mismatches,
    dangles: faceResult.dangles || [],
    faces: faceResult.faces,
    spaces: closedSpaces
  };
}

function inspectDraftFaceShadow(draft, options) {
  const floors = draft && Array.isArray(draft.floors) ? draft.floors : [];
  const floorsShadow = floors.map((floor, floorIndex) => {
    const shadow = compareClosedSpacesToFaces(floor, options);
    return Object.assign({ floorIndex }, shadow);
  });
  const mismatches = floorsShadow.flatMap((floorShadow) => (
    floorShadow.mismatches.map((mismatch) => Object.assign({
      floorIndex: floorShadow.floorIndex
    }, mismatch))
  ));
  return {
    ok: mismatches.length === 0,
    floors: floorsShadow,
    mismatches
  };
}

module.exports = {
  compareClosedSpacesToFaces,
  inspectDraftFaceShadow
};
