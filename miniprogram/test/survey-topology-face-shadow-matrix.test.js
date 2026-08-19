const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');
const { inspectDraftFaceShadow } = require('../utils/survey/topology/face-shadow.js');
const { createScenarioCatalog } = require('../../surveying-h5/src/scenarios.js');

const catalog = createScenarioCatalog(surveyGraph);

function findSharedWallId(floor) {
  const closedSpaces = (floor.spaces || []).filter((space) => space && space.closed);
  if (closedSpaces.length < 2) return '';
  const counts = new Map();
  closedSpaces.forEach((space) => {
    (space.wallIds || []).forEach((wallId) => {
      counts.set(wallId, (counts.get(wallId) || 0) + 1);
    });
  });
  const shared = [...counts.entries()].find((entry) => entry[1] === 2);
  return shared ? shared[0] : '';
}

function summarizeRow(scenario, operation, draft) {
  const shadow = inspectDraftFaceShadow(draft, { stopOnCountMismatch: false });
  const floor = surveyGraph.getActiveFloor(draft);
  return {
    key: scenario.key,
    label: scenario.label,
    operation,
    ok: shadow.ok,
    faceCount: shadow.floors[0] ? shadow.floors[0].faceCount : 0,
    spaceCount: shadow.floors[0] ? shadow.floors[0].spaceCount : 0,
    dangleCount: shadow.floors[0] ? shadow.floors[0].dangles.length : 0,
    wallCount: (floor.walls || []).length,
    codes: shadow.mismatches.map((mismatch) => mismatch.code)
  };
}

function formatMatrix(rows) {
  return rows.map((row) => (
    `${row.key} [${row.operation}] faces=${row.faceCount} spaces=${row.spaceCount} ` +
    `walls=${row.wallCount} dangles=${row.dangleCount} ${row.codes.join(',') || 'ok'}`
  )).join('\n');
}

function summarizeThrown(scenario, operation, error) {
  return {
    key: scenario.key,
    label: scenario.label,
    operation,
    ok: false,
    faceCount: -1,
    spaceCount: -1,
    dangleCount: -1,
    wallCount: -1,
    codes: [error && error.code ? error.code : error.name || 'ERROR'].concat(
      error && error.validation && error.validation.errors
        ? error.validation.errors.map((item) => item.code)
        : [error && error.message ? error.message : 'unknown']
    )
  };
}

function collectMatrix() {
  const rows = [];
  catalog.forEach((scenario) => {
    let draft;
    try {
      draft = scenario.build();
      rows.push(summarizeRow(scenario, 'build', draft));
    } catch (error) {
      rows.push(summarizeThrown(scenario, 'build', error));
      return;
    }
    const sharedWallId = findSharedWallId(surveyGraph.getActiveFloor(draft));
    if (!sharedWallId) return;
    try {
      const merged = surveyGraph.deleteWall(draft, sharedWallId);
      rows.push(summarizeRow(scenario, 'delete-shared', merged));
    } catch (error) {
      rows.push(summarizeThrown(scenario, 'delete-shared', error));
    }
  });
  return rows;
}

test('H5 catalog closure and shared-wall deletion stay aligned with half-edge faces', () => {
  const rows = collectMatrix();
  const mismatches = rows.filter((row) => !row.ok);
  assert.equal(
    mismatches.length,
    0,
    `${mismatches.length}/${rows.length} face-shadow holes:\n${formatMatrix(mismatches)}`
  );
});
