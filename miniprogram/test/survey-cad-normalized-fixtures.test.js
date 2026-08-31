const test = require('node:test');
const assert = require('node:assert/strict');
const scenarios = require('./fixtures/survey-cad/scenarios.js');
const { normalizeDraft } = require('./fixtures/survey-cad/normalize.js');

function signature(fixture) {
  return {
    nodes: fixture.nodes.map((node) => `${node.xMm},${node.yMm}`),
    walls: fixture.walls.map((wall) => [
      `${wall.startNodeId}>${wall.endNodeId}`,
      wall.lengthMm,
      wall.thicknessMm,
      wall.measurementSide,
      wall.measurementStartInsetMm,
      wall.measurementEndInsetMm
    ]),
    openings: fixture.openings.map((opening) => [opening.wallId, opening.type, opening.centerOffsetMm, opening.widthMm]),
    spaces: fixture.spaces.map((space) => [space.wallIds.join(','), space.closed]),
    session: fixture.session
  };
}

const EXPECTED = {
  rectangle: {
    nodes: ['0,0', '3000,0', '3000,2000', '0,2000'],
    walls: [
      ['n1>n2', 3000, 200, 'left', 0, 0], ['n2>n3', 2000, 200, 'left', 0, 0],
      ['n3>n4', 3000, 200, 'left', 0, 0], ['n4>n1', 2000, 200, 'left', 0, 0]
    ],
    openings: [],
    spaces: [['w1,w2,w3,w4', true]],
    session: { state: 'spaceClosed', anchorNodeId: '', selectedWallId: '', selectedOpeningId: '' }
  },
  concave: {
    nodes: ['0,0', '3000,0', '3000,1000', '1500,1000', '1500,2000', '0,2000'],
    walls: [
      ['n1>n2', 3000, 200, 'left', 0, 0], ['n2>n3', 1000, 200, 'left', 0, 0],
      ['n3>n4', 1300, 200, 'left', 0, 200], ['n4>n5', 1000, 200, 'left', 0, 0],
      ['n5>n6', 1500, 200, 'left', 0, 0], ['n6>n1', 2000, 200, 'left', 0, 0]
    ],
    openings: [],
    spaces: [['w1,w2,w3,w4,w5,w6', true]],
    session: { state: 'spaceClosed', anchorNodeId: '', selectedWallId: '', selectedOpeningId: '' }
  },
  wallSplitWithOpening: {
    nodes: ['0,0', '3000,0', '3000,2000', '0,2000', '1500,0', '1500,-1200'],
    walls: [
      ['n1>n5', 1500, 200, 'left', 0, 0], ['n5>n2', 1300, 200, 'left', 200, 0],
      ['n2>n3', 2000, 200, 'left', 0, 0], ['n3>n4', 3000, 200, 'left', 0, 0],
      ['n4>n1', 2000, 200, 'left', 0, 0], ['n5>n6', 1000, 200, 'right', 200, 0]
    ],
    openings: [['w1', 'door', 750, 900]],
    spaces: [['w1,w2,w3,w4,w5', true]],
    session: { state: 'wallCommitted', anchorNodeId: 'n6', selectedWallId: '', selectedOpeningId: '' }
  }
};

[
  ['rectangle', 'rectangle', scenarios.rectangle],
  ['concave', 'concave space', scenarios.concave],
  ['wallSplitWithOpening', 'wall split with opening', scenarios.wallSplitWithOpening]
].forEach(([key, name, replay]) => {
  test(`${name} replay has a stable normalized topology fixture`, () => {
    const fixture = normalizeDraft(replay());
    assert.deepEqual(fixture, normalizeDraft(replay()));
    assert.deepEqual(signature(fixture), EXPECTED[key]);
  });
});
