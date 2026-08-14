const constants = require('../core/constants.js');
const { collectSessionReferences } = require('../core/session.js');
const wallDomain = require('../domain/wall.js');
const openingDomain = require('../domain/opening.js');
const spaceDomain = require('../domain/space.js');
const polygon = require('../geometry/polygon.js');
const segment = require('../geometry/segment.js');
const { createTopologyIndex } = require('../topology/topology-index.js');
const { extractFaces } = require('../topology/face-extractor.js');

function issue(code, path, message, details) {
  return Object.assign({ code, path, message }, details ? { details } : {});
}

function collectIdIssues(index, kind, errors) {
  index.missingIdIndexes[kind].forEach((itemIndex) => {
    errors.push(issue('MISSING_ID', `${kind}[${itemIndex}].id`, `${kind} 缺少有效 ID`));
  });
  index.duplicateIds[kind].forEach(({ id, index: itemIndex }) => {
    errors.push(issue('DUPLICATE_ID', `${kind}[${itemIndex}].id`, `${kind} 存在重复 ID：${id}`));
  });
}

function validateQuick(floor, index, errors, warnings) {
  collectIdIssues(index, 'nodes', errors);
  collectIdIssues(index, 'walls', errors);
  collectIdIssues(index, 'spaces', errors);
  collectIdIssues(index, 'openings', errors);

  floor.nodes.forEach((node, nodeIndex) => {
    if (!Number.isFinite(Number(node.xMm)) || !Number.isFinite(Number(node.yMm))) {
      errors.push(issue('INVALID_NODE_COORDINATE', `nodes[${nodeIndex}]`, `节点 ${node.id || nodeIndex} 坐标无效`));
    }
  });

  floor.walls.forEach((wall, wallIndex) => {
    const path = `walls[${wallIndex}]`;
    const start = index.nodesById.get(wall.startNodeId);
    const end = index.nodesById.get(wall.endNodeId);
    if (!start) errors.push(issue('MISSING_WALL_START_NODE', `${path}.startNodeId`, `墙体 ${wall.id} 的起点不存在`));
    if (!end) errors.push(issue('MISSING_WALL_END_NODE', `${path}.endNodeId`, `墙体 ${wall.id} 的终点不存在`));
    if (wall.startNodeId && wall.startNodeId === wall.endNodeId) {
      errors.push(issue('ZERO_LENGTH_WALL', path, `墙体 ${wall.id} 的起点和终点相同`));
    } else if (start && end && wallDomain.coordinateLength(floor, wall, index) < 0.5) {
      errors.push(issue('ZERO_LENGTH_WALL', path, `墙体 ${wall.id} 的坐标长度为零`));
    }
    if (!Number.isFinite(Number(wall.thicknessMm)) || Number(wall.thicknessMm) < constants.MIN_THICKNESS_MM) {
      errors.push(issue('INVALID_WALL_THICKNESS', `${path}.thicknessMm`, `墙体 ${wall.id} 的墙厚无效`));
    }
  });

  floor.spaces.forEach((space, spaceIndex) => {
    const path = `spaces[${spaceIndex}]`;
    const wallIds = Array.isArray(space.wallIds) ? space.wallIds : [];
    if (!Array.isArray(space.wallIds)) {
      errors.push(issue('INVALID_SPACE_WALLS', `${path}.wallIds`, `空间 ${space.id} 缺少墙体链`));
      return;
    }
    wallIds.forEach((wallId, wallIndex) => {
      if (!index.wallsById.has(wallId)) {
        errors.push(issue('MISSING_SPACE_WALL', `${path}.wallIds[${wallIndex}]`, `空间 ${space.id} 引用不存在的墙体 ${wallId}`));
      }
    });
    if (space.closed) {
      const nodeCycle = spaceDomain.buildSpaceNodeCycle(space, index);
      if (nodeCycle.length < 3) {
        errors.push(issue('BROKEN_SPACE_CYCLE', path, `闭合空间 ${space.id} 的墙体不能形成唯一闭环`));
      }
    }
    Object.entries(space.wallFaceOverrides || {}).forEach(([wallId, face]) => {
      if (!index.wallsById.has(wallId) || (face !== 'topology' && face !== 'offset')) {
        errors.push(issue('INVALID_WALL_FACE_OVERRIDE', `${path}.wallFaceOverrides.${wallId}`, `空间 ${space.id} 的墙面覆盖无效`));
      }
    });
  });

  floor.openings.forEach((opening, openingIndex) => {
    const path = `openings[${openingIndex}]`;
    const wall = index.wallsById.get(opening.wallId);
    if (!wall) {
      errors.push(issue('MISSING_OPENING_WALL', `${path}.wallId`, `门窗 ${opening.id} 的宿主墙不存在`));
      return;
    }
    const range = openingDomain.getOpeningRange(opening);
    if (!Number.isFinite(Number(opening.widthMm)) || Number(opening.widthMm) <= 0 ||
        range.startMm < -1 || range.endMm > Number(wall.lengthMm || 0) + 1) {
      errors.push(issue('OPENING_OUT_OF_RANGE', path, `门窗 ${opening.id} 超出宿主墙 ${wall.id} 的有效范围`));
    }
  });

  const references = collectSessionReferences(floor.session);
  references.nodeIds.forEach(({ field, id }) => {
    if (!index.nodesById.has(id)) errors.push(issue('MISSING_SESSION_NODE', `session.${field}`, `会话引用的节点 ${id} 不存在`));
  });
  references.wallIds.forEach(({ field, id }) => {
    if (!index.wallsById.has(id)) errors.push(issue('MISSING_SESSION_WALL', `session.${field}`, `会话引用的墙体 ${id} 不存在`));
  });
  references.openingIds.forEach(({ field, id }) => {
    if (!index.openingsById.has(id)) errors.push(issue('MISSING_SESSION_OPENING', `session.${field}`, `会话引用的门窗 ${id} 不存在`));
  });
  const activeIndex = floor.session && floor.session.activeSpaceStartWallIndex;
  if (Number.isInteger(activeIndex) && (activeIndex < 0 || activeIndex > floor.walls.length)) {
    errors.push(issue('INVALID_ACTIVE_WALL_INDEX', 'session.activeSpaceStartWallIndex', '当前空间的起始墙索引越界'));
  }

  const sessionNodeIds = new Set(references.nodeIds.map(({ id }) => id));
  floor.nodes.forEach((node, nodeIndex) => {
    if (!index.wallsByNodeId.has(node.id) && !sessionNodeIds.has(node.id)) {
      warnings.push(issue('ORPHAN_NODE', `nodes[${nodeIndex}]`, `节点 ${node.id} 未被墙体或当前会话引用`));
    }
  });
}

function validateFull(floor, index, errors, warnings) {
  const wallKeys = new Map();
  floor.walls.forEach((wall, wallIndex) => {
    const start = index.nodesById.get(wall.startNodeId);
    const end = index.nodesById.get(wall.endNodeId);
    const key = start && end
      ? [`${start.xMm},${start.yMm}`, `${end.xMm},${end.yMm}`].sort().join('|')
      : wallDomain.undirectedKey(wall);
    if (wallKeys.has(key)) {
      errors.push(issue('DUPLICATE_WALL', `walls[${wallIndex}]`, `墙体 ${wall.id} 与 ${wallKeys.get(key)} 重复`));
    } else {
      wallKeys.set(key, wall.id);
    }
  });

  for (let first = 0; first < floor.walls.length; first += 1) {
    const firstWall = floor.walls[first];
    const a1 = index.nodesById.get(firstWall.startNodeId);
    const a2 = index.nodesById.get(firstWall.endNodeId);
    if (!a1 || !a2) continue;
    for (let second = first + 1; second < floor.walls.length; second += 1) {
      const secondWall = floor.walls[second];
      if ([secondWall.startNodeId, secondWall.endNodeId].includes(firstWall.startNodeId) ||
          [secondWall.startNodeId, secondWall.endNodeId].includes(firstWall.endNodeId)) continue;
      const b1 = index.nodesById.get(secondWall.startNodeId);
      const b2 = index.nodesById.get(secondWall.endNodeId);
      if (b1 && b2 && segment.properIntersection(a1, a2, b1, b2)) {
        errors.push(issue('UNSPLIT_WALL_INTERSECTION', `walls[${second}]`, `墙体 ${firstWall.id} 与 ${secondWall.id} 在内部相交但未节点化`));
      }
    }
  }

  floor.spaces.filter((space) => space.closed).forEach((space) => {
    const nodeCycle = spaceDomain.buildSpaceNodeCycle(space, index);
    const points = nodeCycle.map((nodeId) => index.nodesById.get(nodeId));
    if (points.length >= 4 && polygon.hasSelfIntersection(points)) {
      errors.push(issue('SELF_INTERSECTING_SPACE', `spaces.${space.id}`, `闭合空间 ${space.id} 存在自交`));
    }
  });
  index.spacesByWallId.forEach((spaces, wallId) => {
    const closedSpaces = spaces.filter((space) => space.closed);
    if (closedSpaces.length > 2) {
      errors.push(issue('WALL_SHARED_BY_TOO_MANY_SPACES', `walls.${wallId}`, `墙体 ${wallId} 被 ${closedSpaces.length} 个闭合空间共享`));
    }
  });

  if (!errors.length) {
    const faceResult = extractFaces(floor);
    const closedSpaces = floor.spaces.filter((space) => space.closed);
    if (faceResult.faces.length !== closedSpaces.length) {
      errors.push(issue('FACE_SPACE_MISMATCH', 'spaces', `半边诊断得到 ${faceResult.faces.length} 个有界面，但墙图保存了 ${closedSpaces.length} 个闭合空间`, {
        faceCount: faceResult.faces.length,
        spaceCount: closedSpaces.length
      }));
    } else {
      const availableFaces = faceResult.faces.slice();
      closedSpaces.forEach((space) => {
        const boundaryKey = (space.wallIds || []).slice().sort().join('|');
        const faceIndex = availableFaces.findIndex((face) => face.wallIds.slice().sort().join('|') === boundaryKey);
        if (faceIndex < 0) {
          errors.push(issue('FACE_BOUNDARY_MISMATCH', `spaces.${space.id}.wallIds`, `空间 ${space.id} 的边界与 Face shadow 不一致`));
          return;
        }
        const face = availableFaces.splice(faceIndex, 1)[0];
        const nodeCycle = spaceDomain.buildSpaceNodeCycle(space, index);
        const spaceAreaMm2 = polygon.area(nodeCycle.map((nodeId) => index.nodesById.get(nodeId)));
        if (Math.abs(spaceAreaMm2 - face.areaMm2) > 1) {
          errors.push(issue('FACE_AREA_MISMATCH', `spaces.${space.id}`, `空间 ${space.id} 的拓扑面积与 Face shadow 不一致`, {
            spaceAreaMm2,
            faceAreaMm2: face.areaMm2
          }));
        }
      });
    }
    faceResult.dangles.forEach((dangle) => {
      warnings.push(issue('DANGLE_WALL', `walls.${dangle.wallId}`, `墙体 ${dangle.wallId} 未参与任何有界 Face`, dangle));
    });
  } else {
    warnings.push(issue('FACE_CHECK_SKIPPED', 'spaces', '基础拓扑无效，已跳过 Face shadow 对照'));
  }
}

function validateSurveyDraft(draft, options) {
  const mode = options && options.mode === 'full' ? 'full' : 'quick';
  const errors = [];
  const warnings = [];
  if (!draft || draft.kind !== 'survey-wall-graph' || !Array.isArray(draft.floors) || !draft.floors.length) {
    errors.push(issue('INVALID_SURVEY_DRAFT', '', '正式量房草稿结构无效'));
    return { valid: false, errors, warnings, stats: { mode, floors: 0, nodes: 0, walls: 0, spaces: 0, openings: 0 } };
  }
  const floorStats = { nodes: 0, walls: 0, spaces: 0, openings: 0 };
  draft.floors.forEach((floor, floorIndex) => {
    const floorStartError = errors.length;
    const floorStartWarning = warnings.length;
    if (!floor || !Array.isArray(floor.nodes) || !Array.isArray(floor.walls) ||
        !Array.isArray(floor.spaces) || !Array.isArray(floor.openings)) {
      errors.push(issue('INVALID_FLOOR_COLLECTIONS', `floors[${floorIndex}]`, '楼层墙图集合结构无效'));
      return;
    }
    floorStats.nodes += floor.nodes.length;
    floorStats.walls += floor.walls.length;
    floorStats.spaces += floor.spaces.filter((space) => space && space.closed).length;
    floorStats.openings += floor.openings.length;
    const index = createTopologyIndex(floor);
    validateQuick(floor, index, errors, warnings);
    if (mode === 'full') validateFull(floor, index, errors, warnings);
    errors.slice(floorStartError).forEach((error) => {
      error.path = error.path ? `floors[${floorIndex}].${error.path}` : `floors[${floorIndex}]`;
    });
    warnings.slice(floorStartWarning).forEach((warning) => {
      warning.path = warning.path ? `floors[${floorIndex}].${warning.path}` : `floors[${floorIndex}]`;
    });
  });
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      mode,
      floors: draft.floors.length,
      nodes: floorStats.nodes,
      walls: floorStats.walls,
      spaces: floorStats.spaces,
      openings: floorStats.openings
    }
  };
}

module.exports = { validateSurveyDraft };
