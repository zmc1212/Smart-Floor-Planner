const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const surveyGraph = require(path.join(root, 'miniprogram/utils/surveyWallGraph.js'));
const { CATEGORY_ORDER, createScenarioCatalog } = require('../src/scenarios.js');

const catalog = createScenarioCatalog(surveyGraph);

test('scenario catalog covers the supported measurement topology families', () => {
  assert.equal(catalog.length, 23);
  assert.deepEqual([...new Set(catalog.map((scenario) => scenario.category))], CATEGORY_ORDER);
  assert.equal(new Set(catalog.map((scenario) => scenario.key)).size, catalog.length);
  ['rectangle', 'l-shape', 'open-chain', 'adjacent-rooms', 't-junction', 'partition']
    .forEach((legacyKey) => assert.ok(catalog.some((scenario) => scenario.key === legacyKey)));
});

catalog.forEach((scenario) => {
  test(`scenario ${scenario.key} builds a valid production wall graph`, () => {
    const draft = scenario.build();
    const floor = surveyGraph.getActiveFloor(draft);
    const actual = {
      walls: floor.walls.length,
      spaces: floor.spaces.filter((space) => space.closed).length,
      openings: floor.openings.length
    };
    assert.deepEqual(actual, scenario.expected);
    assert.equal(surveyGraph.validateSurveyDraft(draft, { mode: 'full' }).valid, true);
  });
});

test('the supplied staggered two-room reference preserves its measured room dimensions', () => {
  const scenario = catalog.find((entry) => entry.key === 'staggered-adjacent');
  const draft = scenario.build();
  const floor = surveyGraph.getActiveFloor(draft);
  const dimensions = floor.spaces
    .filter((space) => space.closed)
    .map((space) => surveyGraph.buildSpaceDimensionPlan(floor, space).inner)
    .map(({ widthMm, heightMm }) => ({ widthMm, heightMm }))
    .sort((first, second) => first.widthMm - second.widthMm);

  assert.deepEqual(dimensions, [
    { widthMm: 2761, heightMm: 3223 },
    { widthMm: 3082, heightMm: 4120 }
  ]);
});

test('the T-shaped layout closes adjacent rooms through shared boundaries', () => {
  const scenario = catalog.find((entry) => entry.key === 'three-room-t');
  const floor = surveyGraph.getActiveFloor(scenario.build());
  const junction = floor.nodes.find((node) => node.xMm === 3000 && node.yMm === 2400);
  const junctionWalls = floor.walls.filter((wall) => (
    wall.startNodeId === junction.id || wall.endNodeId === junction.id
  ));
  const endpointKeys = floor.walls.map((wall) => [wall.startNodeId, wall.endNodeId].sort().join(':'));

  assert.equal(junctionWalls.length, 3);
  assert.equal(new Set(endpointKeys).size, floor.walls.length);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 3);
});
