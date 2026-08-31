const test = require('node:test');
const assert = require('node:assert/strict');
const segment = require('../packages/surveying/utils/survey/geometry/segment.js');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');

function rotate(point, quarterTurns) {
  let xMm = point.xMm;
  let yMm = point.yMm;
  for (let index = 0; index < quarterTurns; index += 1) {
    [xMm, yMm] = [-yMm, xMm];
  }
  return { xMm, yMm };
}

function relationType(points, quarterTurns) {
  const [a1, a2, b1, b2] = points.map((point) => rotate(point, quarterTurns));
  return segment.classifySegmentRelation(a1, a2, b1, b2).type;
}

function makeDraft(nodes, walls) {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  floor.walls = walls.map((wall) => ({
    thicknessMm: 200,
    lengthMm: Math.round(Math.hypot(
      nodeById.get(wall.endNodeId).xMm - nodeById.get(wall.startNodeId).xMm,
      nodeById.get(wall.endNodeId).yMm - nodeById.get(wall.startNodeId).yMm
    )),
    ...wall
  }));
  floor.openings = [];
  floor.spaces = [];
  return draft;
}

function fullCodes(draft) {
  return surveyGraph.validateSurveyDraft(draft, { mode: 'full' })
    .errors.map((error) => error.code);
}

test('segment relation matrix is rotation invariant for cross, T and collinear overlaps', () => {
  const matrix = [
    {
      name: 'proper cross',
      expected: 'proper-intersection',
      points: [
        { xMm: -2000, yMm: 0 }, { xMm: 2000, yMm: 0 },
        { xMm: 0, yMm: -1000 }, { xMm: 0, yMm: 1000 }
      ]
    },
    {
      name: 'T endpoint on wall interior',
      expected: 'endpoint-on-interior',
      points: [
        { xMm: -2000, yMm: 0 }, { xMm: 2000, yMm: 0 },
        { xMm: 0, yMm: -1000 }, { xMm: 0, yMm: 0 }
      ]
    },
    {
      name: 'partial collinear overlap',
      expected: 'collinear-overlap',
      points: [
        { xMm: 0, yMm: 0 }, { xMm: 4000, yMm: 0 },
        { xMm: 2000, yMm: 0 }, { xMm: 6000, yMm: 0 }
      ]
    },
    {
      name: 'contained collinear overlap',
      expected: 'collinear-overlap',
      points: [
        { xMm: 0, yMm: 0 }, { xMm: 4000, yMm: 0 },
        { xMm: 1000, yMm: 0 }, { xMm: 3000, yMm: 0 }
      ]
    }
  ];

  matrix.forEach(({ name, expected, points }) => {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      assert.equal(relationType(points, rotation), expected, `${name}, rotation=${rotation}`);
    }
  });
});

test('relation classification uses geometry epsilon rather than the 350mm snap tolerance', () => {
  assert.equal(segment.classifySegmentRelation(
    { xMm: 0, yMm: 0 }, { xMm: 4000, yMm: 0 },
    { xMm: 2000, yMm: -1000 }, { xMm: 2000, yMm: -1 }
  ).type, 'disjoint');
});

test('full validation reports each non-nodeized wall relationship with a stable code', () => {
  const cases = [
    {
      expected: 'UNSPLIT_WALL_INTERSECTION',
      nodes: [
        { id: 'a', xMm: -2000, yMm: 0 }, { id: 'b', xMm: 2000, yMm: 0 },
        { id: 'c', xMm: 0, yMm: -1000 }, { id: 'd', xMm: 0, yMm: 1000 }
      ]
    },
    {
      expected: 'UNSPLIT_WALL_T_JUNCTION',
      nodes: [
        { id: 'a', xMm: -2000, yMm: 0 }, { id: 'b', xMm: 2000, yMm: 0 },
        { id: 'c', xMm: 0, yMm: -1000 }, { id: 'd', xMm: 0, yMm: 0 }
      ]
    },
    {
      expected: 'OVERLAPPING_WALLS',
      nodes: [
        { id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 },
        { id: 'c', xMm: 1000, yMm: 0 }, { id: 'd', xMm: 3000, yMm: 0 }
      ]
    }
  ];

  cases.forEach(({ expected, nodes }) => {
    const draft = makeDraft(nodes, [
      { id: 'first', startNodeId: 'a', endNodeId: 'b' },
      { id: 'second', startNodeId: 'c', endNodeId: 'd' }
    ]);
    assert.ok(fullCodes(draft).includes(expected), expected);
  });
});

test('coincident endpoints with different node IDs are rejected as unmerged', () => {
  const draft = makeDraft(
    [
      { id: 'a', xMm: 0, yMm: 0 },
      { id: 'b', xMm: 2000, yMm: 0 },
      { id: 'b-copy', xMm: 2000, yMm: 0 },
      { id: 'c', xMm: 2000, yMm: 2000 }
    ],
    [
      { id: 'ab', startNodeId: 'a', endNodeId: 'b' },
      { id: 'bc', startNodeId: 'b-copy', endNodeId: 'c' }
    ]
  );
  assert.ok(fullCodes(draft).includes('UNMERGED_WALL_ENDPOINT'));
});

test('shared-node adjacency and correctly nodeized T/cross graphs remain legal', () => {
  const legalGraphs = [
    makeDraft(
      [
        { id: 'a', xMm: 0, yMm: 0 },
        { id: 'join', xMm: 2000, yMm: 0 },
        { id: 'b', xMm: 4000, yMm: 0 }
      ],
      [
        { id: 'left', startNodeId: 'a', endNodeId: 'join' },
        { id: 'right', startNodeId: 'join', endNodeId: 'b' }
      ]
    ),
    makeDraft(
      [
        { id: 'a', xMm: -2000, yMm: 0 },
        { id: 'join', xMm: 0, yMm: 0 },
        { id: 'b', xMm: 2000, yMm: 0 },
        { id: 'c', xMm: 0, yMm: -1000 }
      ],
      [
        { id: 'left', startNodeId: 'a', endNodeId: 'join' },
        { id: 'right', startNodeId: 'join', endNodeId: 'b' },
        { id: 'branch', startNodeId: 'c', endNodeId: 'join' }
      ]
    ),
    makeDraft(
      [
        { id: 'left', xMm: -2000, yMm: 0 },
        { id: 'join', xMm: 0, yMm: 0 },
        { id: 'right', xMm: 2000, yMm: 0 },
        { id: 'top', xMm: 0, yMm: -1000 },
        { id: 'bottom', xMm: 0, yMm: 1000 }
      ],
      [
        { id: 'west', startNodeId: 'left', endNodeId: 'join' },
        { id: 'east', startNodeId: 'join', endNodeId: 'right' },
        { id: 'north', startNodeId: 'top', endNodeId: 'join' },
        { id: 'south', startNodeId: 'join', endNodeId: 'bottom' }
      ]
    )
  ];

  legalGraphs.forEach((draft) => assert.deepEqual(fullCodes(draft), []));
});
