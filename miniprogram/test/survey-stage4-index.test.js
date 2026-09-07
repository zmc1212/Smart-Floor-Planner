const test = require('node:test');
const assert = require('node:assert/strict');
const { createTopologyIndex } = require('../packages/surveying/utils/survey/topology/topology-index.js');
const { extractFaces } = require('../packages/surveying/utils/survey/topology/face-extractor.js');

function square() {
  return {
    nodes: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]].map(([xMm, yMm], i) => ({ id: `n${i}`, xMm, yMm })),
    walls: [0, 1, 2, 3].map(i => ({ id: `w${i}`, startNodeId: `n${i}`, endNodeId: `n${(i + 1) % 4}` })),
    spaces: [], openings: []
  };
}

test('stage 4 Face extraction reuses the read-only pass index without changing geometry', () => {
  const floor = square();
  const before = JSON.stringify(floor);
  const index = createTopologyIndex(floor);
  const reused = extractFaces(floor, index);
  assert.equal(reused.index, index);
  assert.deepEqual(reused.faces, extractFaces(floor).faces);
  assert.equal(reused.faces[0].areaMm2, 16000000);
  assert.equal(JSON.stringify(floor), before);
});

test('stage 4 invalidated or foreign indexes cannot supply stale topology', () => {
  const floor = square();
  const index = createTopologyIndex(floor);
  assert.notEqual(extractFaces(square(), index).index, index);
  index.invalidate();
  floor.walls.pop();
  const result = extractFaces(floor, index);
  assert.notEqual(result.index, index);
  assert.equal(result.faces.length, 0);
});
