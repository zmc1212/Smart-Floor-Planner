const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const GENERATED_ENTITY_ID = /\b(floor|node|wall|opening|space)-[0-9a-z]{6,}-\d+\b/g;
const VOLATILE_TIMESTAMP_FIELDS = new Set([
  'createdAt',
  'measuredAt',
  'timestamp',
  'updatedAt'
]);
const UNORDERED_ENTITY_COLLECTIONS = new Set(['nodes', 'openings']);
const SESSION_NODE_FIELDS = [
  'anchorNodeId',
  'closeCandidateNodeId',
  'activeSpaceStartNodeId',
  'lastWallSnapNodeId',
  'fixedNodeId'
];
const SESSION_WALL_FIELDS = [
  'pendingWallId',
  'selectedWallId',
  'closeCandidateSharedWallId',
  'activeSpaceSharedWallId',
  'lastWallSnapWallId',
  'previewOuterFaceWallId'
];
const SESSION_SPACE_FIELDS = ['selectedSpaceId', 'partitionSourceSpaceId'];

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNumber(value) {
  return Object.is(value, -0) ? 0 : value;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stripForIdentity(value, omittedFields) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripForIdentity(entry, omittedFields));
  }
  if (!isObject(value)) return normalizeNumber(value);
  const output = {};
  Object.keys(value).sort().forEach((key) => {
    if (omittedFields.has(key) || VOLATILE_TIMESTAMP_FIELDS.has(key)) return;
    output[key] = stripForIdentity(value[key], omittedFields);
  });
  return output;
}

function replaceKnownIds(value, idMap) {
  if (typeof value !== 'string') return value;
  if (idMap.has(value)) return idMap.get(value);
  let output = value;
  [...idMap.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .forEach(([sourceId, targetId]) => {
      if (output.includes(sourceId)) output = output.split(sourceId).join(targetId);
    });
  return output;
}

function entityIdentityKey(entity, kind, idMap) {
  const omitted = new Set(['id']);
  if (kind === 'wall') omitted.add('topologySourceWallId');
  const source = stripForIdentity(entity, omitted);
  const replace = (value) => {
    if (Array.isArray(value)) return value.map(replace);
    if (isObject(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [
        replaceKnownIds(key, idMap),
        replace(value[key])
      ]));
    }
    return replaceKnownIds(value, idMap);
  };
  return stableSerialize(replace(source));
}

function mapEntitiesByIdentity(values, prefix, floorIndex, idMap) {
  const entries = (Array.isArray(values) ? values : [])
    .map((value, sourceIndex) => ({
      value,
      sourceIndex,
      key: entityIdentityKey(value, prefix, idMap)
    }))
    .sort((left, right) => (
      left.key.localeCompare(right.key) || left.sourceIndex - right.sourceIndex
    ));
  entries.forEach(({ value }, entityIndex) => {
    if (value && typeof value.id === 'string' && value.id) {
      idMap.set(value.id, `${prefix}-${floorIndex + 1}-${entityIndex + 1}`);
    }
  });
}

function createCanonicalIdMap(draft) {
  const idMap = new Map();
  const floors = draft && Array.isArray(draft.floors) ? draft.floors : [];
  floors.forEach((floor, floorIndex) => {
    if (floor && typeof floor.id === 'string' && floor.id) {
      idMap.set(floor.id, `floor-${floorIndex + 1}`);
    }
  });
  floors.forEach((floor, floorIndex) => {
    mapEntitiesByIdentity(floor && floor.nodes, 'node', floorIndex, idMap);
    mapEntitiesByIdentity(floor && floor.walls, 'wall', floorIndex, idMap);
    mapEntitiesByIdentity(floor && floor.openings, 'opening', floorIndex, idMap);
    mapEntitiesByIdentity(floor && floor.spaces, 'space', floorIndex, idMap);
  });
  return idMap;
}

function matchesIgnoredPath(pathParts, ignoredPaths) {
  if (!ignoredPaths || !ignoredPaths.length) return false;
  const path = pathParts.join('.');
  return ignoredPaths.some((pattern) => {
    const escaped = String(pattern)
      .split('.')
      .map((part) => part === '*' ? '[^.]+': part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\.');
    return new RegExp(`^${escaped}$`).test(path);
  });
}

function createNormalizationContext(draft, options) {
  return {
    idMap: createCanonicalIdMap(draft),
    nextRuntimeId: { floor: 0, node: 0, wall: 0, opening: 0, space: 0 },
    ignoredPaths: options && Array.isArray(options.ignoredPaths) ? options.ignoredPaths : []
  };
}

function normalizeString(value, context) {
  let normalized = replaceKnownIds(value, context.idMap);
  normalized = normalized.replace(GENERATED_ENTITY_ID, (generatedId, prefix) => {
    if (!context.idMap.has(generatedId)) {
      context.nextRuntimeId[prefix] += 1;
      context.idMap.set(generatedId, `${prefix}-runtime-${context.nextRuntimeId[prefix]}`);
    }
    return context.idMap.get(generatedId);
  });
  return normalized;
}

function normalizeValue(value, context, key, pathParts) {
  if (typeof value === 'number') return normalizeNumber(value);
  if (typeof value === 'string') {
    if (VOLATILE_TIMESTAMP_FIELDS.has(key) && ISO_TIMESTAMP.test(value)) {
      return '<timestamp>';
    }
    return normalizeString(value, context);
  }
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => (
      normalizeValue(entry, context, key, pathParts.concat('*'))
    ));
    if (UNORDERED_ENTITY_COLLECTIONS.has(key)) {
      normalized.sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right)));
    }
    return normalized;
  }
  if (!isObject(value)) return value;

  const output = {};
  Object.keys(value).sort().forEach((rawKey) => {
    if (typeof value[rawKey] === 'undefined') return;
    const childPath = pathParts.concat(rawKey);
    if (matchesIgnoredPath(childPath, context.ignoredPaths)) return;
    const normalizedKey = context.idMap.get(rawKey) || rawKey;
    output[normalizedKey] = normalizeValue(value[rawKey], context, rawKey, childPath);
  });
  return output;
}

function canonicalizeSurveyValue(value, draft, options) {
  const context = createNormalizationContext(draft || value, options);
  return normalizeValue(value, context, '', []);
}

function canonicalizeSurveyDraft(draft, options) {
  return canonicalizeSurveyValue(draft, draft, options);
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function childPath(parentPath, key) {
  return parentPath ? `${parentPath}.${key}` : key;
}

function arrayItemPath(parentPath, expected, actual, index) {
  const item = isObject(expected) ? expected : actual;
  if (item && typeof item.id === 'string' && item.id) return `${parentPath}[${item.id}]`;
  return `${parentPath}[${index}]`;
}

function compareCanonicalValues(expected, actual, options, path, differences) {
  if (Object.is(expected, actual)) return;
  const requestedTolerance = Number(options && options.numericTolerance);
  const tolerance = Number.isFinite(requestedTolerance) ? Math.max(0, requestedTolerance) : 0;
  if (typeof expected === 'number' && typeof actual === 'number') {
    const delta = Math.abs(expected - actual);
    if (Number.isFinite(delta) && delta <= tolerance) return;
    differences.push({
      path: path || '<root>',
      kind: 'number',
      expected,
      actual,
      delta,
      tolerance
    });
    return;
  }
  if (valueType(expected) !== valueType(actual)) {
    differences.push({
      path: path || '<root>',
      kind: 'type',
      expectedType: valueType(expected),
      actualType: valueType(actual),
      expected,
      actual
    });
    return;
  }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) {
      differences.push({
        path: path || '<root>',
        kind: 'length',
        expected: expected.length,
        actual: actual.length
      });
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const itemPath = arrayItemPath(path || '<root>', expected[index], actual[index], index);
      if (index >= expected.length) {
        differences.push({ path: itemPath, kind: 'unexpected', actual: actual[index] });
      } else if (index >= actual.length) {
        differences.push({ path: itemPath, kind: 'missing', expected: expected[index] });
      } else {
        compareCanonicalValues(expected[index], actual[index], options, itemPath, differences);
      }
    }
    return;
  }
  if (isObject(expected)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    keys.forEach((key) => {
      const nextPath = childPath(path, key);
      if (!Object.prototype.hasOwnProperty.call(expected, key)) {
        differences.push({ path: nextPath, kind: 'unexpected', actual: actual[key] });
      } else if (!Object.prototype.hasOwnProperty.call(actual, key)) {
        differences.push({ path: nextPath, kind: 'missing', expected: expected[key] });
      } else {
        compareCanonicalValues(expected[key], actual[key], options, nextPath, differences);
      }
    });
    return;
  }
  differences.push({ path: path || '<root>', kind: 'value', expected, actual });
}

function compareSurveyValues(expected, actual, options) {
  const differences = [];
  compareCanonicalValues(expected, actual, options || {}, '', differences);
  return { equal: differences.length === 0, differences };
}

function compareSurveyDrafts(expected, actual, options) {
  const expectedCanonical = canonicalizeSurveyDraft(expected, options);
  const actualCanonical = canonicalizeSurveyDraft(actual, options);
  return Object.assign(
    compareSurveyValues(expectedCanonical, actualCanonical, { numericTolerance: 0 }),
    { expectedCanonical, actualCanonical }
  );
}

function pushDuplicateIssues(values, collection, floorPath, issues) {
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value, index) => {
    const id = value && value.id;
    const path = `${floorPath}.${collection}[${index}].id`;
    if (typeof id !== 'string' || !id) {
      issues.push({ code: 'MISSING_ID', path, id: id || null });
    } else if (seen.has(id)) {
      issues.push({ code: 'DUPLICATE_ID', path, id });
    } else {
      seen.add(id);
    }
  });
  return seen;
}

function inspectSurveyReferences(draft) {
  const issues = [];
  const floors = draft && Array.isArray(draft.floors) ? draft.floors : [];
  const floorIds = pushDuplicateIssues(floors, 'floors', 'draft', issues);
  if (draft && draft.activeFloorId && !floorIds.has(draft.activeFloorId)) {
    issues.push({ code: 'MISSING_ACTIVE_FLOOR', path: 'activeFloorId', id: draft.activeFloorId });
  }
  floors.forEach((floor, floorIndex) => {
    const floorPath = `floors[${floorIndex}]`;
    const nodeIds = pushDuplicateIssues(floor && floor.nodes, 'nodes', floorPath, issues);
    const wallIds = pushDuplicateIssues(floor && floor.walls, 'walls', floorPath, issues);
    const openingIds = pushDuplicateIssues(floor && floor.openings, 'openings', floorPath, issues);
    const spaceIds = pushDuplicateIssues(floor && floor.spaces, 'spaces', floorPath, issues);
    ((floor && floor.walls) || []).forEach((wall, wallIndex) => {
      ['startNodeId', 'endNodeId'].forEach((field) => {
        if (!nodeIds.has(wall && wall[field])) {
          issues.push({
            code: 'MISSING_WALL_NODE',
            path: `${floorPath}.walls[${wallIndex}].${field}`,
            id: wall && wall[field]
          });
        }
      });
    });
    ((floor && floor.openings) || []).forEach((opening, openingIndex) => {
      if (!wallIds.has(opening && opening.wallId)) {
        issues.push({
          code: 'MISSING_OPENING_WALL',
          path: `${floorPath}.openings[${openingIndex}].wallId`,
          id: opening && opening.wallId
        });
      }
    });
    ((floor && floor.spaces) || []).forEach((space, spaceIndex) => {
      (Array.isArray(space && space.wallIds) ? space.wallIds : []).forEach((wallId, wallIndex) => {
        if (!wallIds.has(wallId)) {
          issues.push({
            code: 'MISSING_SPACE_WALL',
            path: `${floorPath}.spaces[${spaceIndex}].wallIds[${wallIndex}]`,
            id: wallId
          });
        }
      });
      Object.keys((space && space.wallFaceOverrides) || {}).forEach((wallId) => {
        if (!wallIds.has(wallId)) {
          issues.push({
            code: 'MISSING_SPACE_FACE_WALL',
            path: `${floorPath}.spaces[${spaceIndex}].wallFaceOverrides.${wallId}`,
            id: wallId
          });
        }
      });
    });
    const session = (floor && floor.session) || {};
    SESSION_NODE_FIELDS.forEach((field) => {
      if (session[field] && !nodeIds.has(session[field])) {
        issues.push({ code: 'MISSING_SESSION_NODE', path: `${floorPath}.session.${field}`, id: session[field] });
      }
    });
    SESSION_WALL_FIELDS.forEach((field) => {
      if (session[field] && !wallIds.has(session[field])) {
        issues.push({ code: 'MISSING_SESSION_WALL', path: `${floorPath}.session.${field}`, id: session[field] });
      }
    });
    if (session.selectedOpeningId && !openingIds.has(session.selectedOpeningId)) {
      issues.push({
        code: 'MISSING_SESSION_OPENING',
        path: `${floorPath}.session.selectedOpeningId`,
        id: session.selectedOpeningId
      });
    }
    SESSION_SPACE_FIELDS.forEach((field) => {
      if (session[field] && !spaceIds.has(session[field])) {
        issues.push({
          code: 'MISSING_SESSION_SPACE',
          path: `${floorPath}.session.${field}`,
          id: session[field]
        });
      }
    });
  });
  return issues;
}

function shortValue(value) {
  const serialized = stableSerialize(value);
  const text = typeof serialized === 'string' ? serialized : String(serialized);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function formatSurveyDifferences(differences, options) {
  const limit = Number(options && options.limit) || 20;
  const entries = (differences || []).slice(0, limit).map((difference) => {
    if (difference.kind === 'number') {
      return `${difference.path}: expected ${difference.expected}, actual ${difference.actual} ` +
        `(delta ${difference.delta}, tolerance ${difference.tolerance})`;
    }
    if (difference.kind === 'type') {
      return `${difference.path}: expected ${difference.expectedType}, actual ${difference.actualType}`;
    }
    return `${difference.path}: ${difference.kind}; expected ${shortValue(difference.expected)}, ` +
      `actual ${shortValue(difference.actual)}`;
  });
  if ((differences || []).length > limit) {
    entries.push(`... ${(differences || []).length - limit} more difference(s)`);
  }
  return entries.join('\n');
}

module.exports = {
  VOLATILE_TIMESTAMP_FIELDS,
  canonicalizeSurveyDraft,
  canonicalizeSurveyValue,
  compareSurveyDrafts,
  compareSurveyValues,
  createCanonicalIdMap,
  formatSurveyDifferences,
  inspectSurveyReferences,
  stableSerialize
};
