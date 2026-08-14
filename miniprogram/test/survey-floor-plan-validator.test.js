const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');
const { extractFaces } = require('../utils/survey/topology/face-extractor.js');

function makeDraft(nodes, walls, spaces, openings, sessionPatch) {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = nodes;
  floor.walls = walls.map((wall) => Object.assign({ thicknessMm: 200, lengthMm: 2000 }, wall));
  floor.spaces = spaces || [];
  floor.openings = openings || [];
  floor.session = Object.assign({}, floor.session, sessionPatch || {});
  return draft;
}

function rectangleDraft() {
  return makeDraft(
    [
      { id: 'n1', xMm: 0, yMm: 0 },
      { id: 'n2', xMm: 3000, yMm: 0 },
      { id: 'n3', xMm: 3000, yMm: 2000 },
      { id: 'n4', xMm: 0, yMm: 2000 }
    ],
    [
      { id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 3000 },
      { id: 'w2', startNodeId: 'n2', endNodeId: 'n3' },
      { id: 'w3', startNodeId: 'n3', endNodeId: 'n4', lengthMm: 3000 },
      { id: 'w4', startNodeId: 'n4', endNodeId: 'n1' }
    ],
    [{ id: 's1', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true }]
  );
}

function codes(validation) {
  return validation.errors.map((error) => error.code);
}

test('quick validator accepts a valid closed rectangle', () => {
  const result = surveyGraph.validateSurveyDraft(rectangleDraft(), { mode: 'quick' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.stats.spaces, 1);
});

test('quick validator reports stable structural error codes', () => {
  const missingEndpoint = rectangleDraft();
  surveyGraph.getActiveFloor(missingEndpoint).walls[0].startNodeId = 'missing';
  assert.ok(codes(surveyGraph.validateSurveyDraft(missingEndpoint)).includes('MISSING_WALL_START_NODE'));

  const duplicateId = rectangleDraft();
  surveyGraph.getActiveFloor(duplicateId).nodes[1].id = 'n1';
  assert.ok(codes(surveyGraph.validateSurveyDraft(duplicateId)).includes('DUPLICATE_ID'));

  const zeroLength = rectangleDraft();
  surveyGraph.getActiveFloor(zeroLength).walls[0].endNodeId = 'n1';
  assert.ok(codes(surveyGraph.validateSurveyDraft(zeroLength)).includes('ZERO_LENGTH_WALL'));

  const brokenSpace = rectangleDraft();
  surveyGraph.getActiveFloor(brokenSpace).spaces[0].wallIds.pop();
  assert.ok(codes(surveyGraph.validateSurveyDraft(brokenSpace)).includes('BROKEN_SPACE_CYCLE'));
});

test('quick validator covers opening, override, session and orphan references', () => {
  const draft = rectangleDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.openings.push({ id: 'o1', wallId: 'w1', widthMm: 1200, centerOffsetMm: 2800 });
  floor.spaces[0].wallFaceOverrides = { missing: 'offset' };
  floor.session.selectedWallId = 'missing';
  floor.nodes.push({ id: 'orphan', xMm: 9000, yMm: 9000 });
  const result = surveyGraph.validateSurveyDraft(draft, { mode: 'quick' });
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes('OPENING_OUT_OF_RANGE'));
  assert.ok(codes(result).includes('INVALID_WALL_FACE_OVERRIDE'));
  assert.ok(codes(result).includes('MISSING_SESSION_WALL'));
  assert.ok(result.warnings.some((warning) => warning.code === 'ORPHAN_NODE'));
});

test('full validator detects duplicate walls and unsplit intersections', () => {
  const draft = makeDraft(
    [
      { id: 'a', xMm: 0, yMm: 0 },
      { id: 'b', xMm: 2000, yMm: 2000 },
      { id: 'c', xMm: 0, yMm: 2000 },
      { id: 'd', xMm: 2000, yMm: 0 },
      { id: 'a2', xMm: 0, yMm: 0 },
      { id: 'b2', xMm: 2000, yMm: 2000 }
    ],
    [
      { id: 'cross-a', startNodeId: 'a', endNodeId: 'b' },
      { id: 'cross-b', startNodeId: 'c', endNodeId: 'd' },
      { id: 'duplicate', startNodeId: 'a2', endNodeId: 'b2' }
    ]
  );
  const result = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
  assert.ok(codes(result).includes('DUPLICATE_WALL'));
  assert.ok(codes(result).includes('UNSPLIT_WALL_INTERSECTION'));
});

test('full validator detects self-intersecting spaces and over-shared walls', () => {
  const bowTie = makeDraft(
    [
      { id: 'n1', xMm: 0, yMm: 0 }, { id: 'n2', xMm: 2000, yMm: 2000 },
      { id: 'n3', xMm: 0, yMm: 2000 }, { id: 'n4', xMm: 2000, yMm: 0 }
    ],
    [
      { id: 'w1', startNodeId: 'n1', endNodeId: 'n2' },
      { id: 'w2', startNodeId: 'n2', endNodeId: 'n3' },
      { id: 'w3', startNodeId: 'n3', endNodeId: 'n4' },
      { id: 'w4', startNodeId: 'n4', endNodeId: 'n1' }
    ],
    [{ id: 'bow-tie', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true }]
  );
  assert.ok(codes(surveyGraph.validateSurveyDraft(bowTie, { mode: 'full' })).includes('SELF_INTERSECTING_SPACE'));

  const overShared = rectangleDraft();
  const floor = surveyGraph.getActiveFloor(overShared);
  floor.spaces.push(
    { id: 's2', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true },
    { id: 's3', wallIds: ['w1', 'w2', 'w3', 'w4'], closed: true }
  );
  assert.ok(codes(surveyGraph.validateSurveyDraft(overShared, { mode: 'full' })).includes('WALL_SHARED_BY_TOO_MANY_SPACES'));
});

test('full validator and Face shadow agree for two adjacent rooms', () => {
  const draft = makeDraft(
    [
      { id: 'n1', xMm: 0, yMm: 0 }, { id: 'n2', xMm: 2000, yMm: 0 },
      { id: 'n3', xMm: 4000, yMm: 0 }, { id: 'n4', xMm: 0, yMm: 2000 },
      { id: 'n5', xMm: 2000, yMm: 2000 }, { id: 'n6', xMm: 4000, yMm: 2000 }
    ],
    [
      { id: 'w1', startNodeId: 'n1', endNodeId: 'n2' },
      { id: 'shared', startNodeId: 'n2', endNodeId: 'n5' },
      { id: 'w3', startNodeId: 'n5', endNodeId: 'n4' },
      { id: 'w4', startNodeId: 'n4', endNodeId: 'n1' },
      { id: 'w5', startNodeId: 'n2', endNodeId: 'n3' },
      { id: 'w6', startNodeId: 'n3', endNodeId: 'n6' },
      { id: 'w7', startNodeId: 'n6', endNodeId: 'n5' }
    ],
    [
      { id: 'left', wallIds: ['w1', 'shared', 'w3', 'w4'], closed: true },
      { id: 'right', wallIds: ['w5', 'w6', 'w7', 'shared'], closed: true }
    ]
  );
  const floor = surveyGraph.getActiveFloor(draft);
  const shadow = extractFaces(floor);
  const validation = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
  assert.equal(shadow.faces.length, 2);
  assert.equal(shadow.dangles.length, 0);
  assert.equal(validation.valid, true);
});

test('open wall chains produce dangle diagnostics without fake spaces', () => {
  const draft = makeDraft(
    [{ id: 'n1', xMm: 0, yMm: 0 }, { id: 'n2', xMm: 1000, yMm: 0 }],
    [{ id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 1000 }]
  );
  const result = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'DANGLE_WALL'));
  assert.equal(extractFaces(surveyGraph.getActiveFloor(draft)).faces.length, 0);
});

test('a bridge attached to a closed boundary stays a dangle instead of entering the Face', () => {
  const draft = rectangleDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes.push({ id: 'branch-end', xMm: 1500, yMm: 1000 });
  floor.walls.push({
    id: 'branch',
    startNodeId: 'n2',
    endNodeId: 'branch-end',
    thicknessMm: 200,
    lengthMm: 1803
  });
  const result = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'DANGLE_WALL'));
  assert.equal(extractFaces(floor).faces.length, 1);
});
