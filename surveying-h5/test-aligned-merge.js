const kernel = require('../miniprogram/utils/survey/legacy-kernel');

let floor = kernel.createSurveyDraft().floors[0];

// Node at the T-junction
const n_middle = kernel.addNode(floor, { xMm: 4000, yMm: 2000 });

// Room 1 (Bottom)
const n_bl = kernel.addNode(floor, { xMm: 0, yMm: 4000 });
const n_br = kernel.addNode(floor, { xMm: 4000, yMm: 4000 });
const n_tl_1 = kernel.addNode(floor, { xMm: 0, yMm: 2000 }); // Left of shared wall

const w1_bottom = kernel.addWall(floor, { startNodeId: n_bl.id, endNodeId: n_br.id, thicknessMm: 200 });
const w1_right = kernel.addWall(floor, { startNodeId: n_br.id, endNodeId: n_middle.id, thicknessMm: 200 });
const w1_shared = kernel.addWall(floor, { startNodeId: n_middle.id, endNodeId: n_tl_1.id, thicknessMm: 200 });
const w1_left = kernel.addWall(floor, { startNodeId: n_tl_1.id, endNodeId: n_bl.id, thicknessMm: 200 });

kernel.addSpace(floor, {
  id: 'space1',
  name: 'Room 1',
  wallIds: [w1_bottom.id, w1_right.id, w1_shared.id, w1_left.id],
  closed: true
});

// Room 2 (Top), narrower on the left
// n_tl_1 is (0, 2000). Room 2's left wall starts at (2000, 2000).
// We need to split w1_shared at x=2000!
const n_mid_left = kernel.addNode(floor, { xMm: 2000, yMm: 2000 });
kernel.splitWallAtNodes(floor, w1_shared.id, [n_mid_left.id]);

const shared_part = floor.walls.find(w => (w.startNodeId === n_middle.id && w.endNodeId === n_mid_left.id) || (w.startNodeId === n_mid_left.id && w.endNodeId === n_middle.id));
const non_shared_part = floor.walls.find(w => (w.startNodeId === n_mid_left.id && w.endNodeId === n_tl_1.id) || (w.startNodeId === n_tl_1.id && w.endNodeId === n_mid_left.id));

const n_tl_2 = kernel.addNode(floor, { xMm: 2000, yMm: 0 });
const n_tr_2 = kernel.addNode(floor, { xMm: 4000, yMm: 0 });

const w2_left = kernel.addWall(floor, { startNodeId: n_mid_left.id, endNodeId: n_tl_2.id, thicknessMm: 200 });
const w2_top = kernel.addWall(floor, { startNodeId: n_tl_2.id, endNodeId: n_tr_2.id, thicknessMm: 200 });
const w2_right = kernel.addWall(floor, { startNodeId: n_tr_2.id, endNodeId: n_middle.id, thicknessMm: 200 });

kernel.addSpace(floor, {
  id: 'space2',
  name: 'Room 2',
  wallIds: [w2_left.id, w2_top.id, w2_right.id, shared_part.id],
  closed: true
});

console.log('Room 1 walls:', floor.spaces[0].wallIds.length);
console.log('Room 2 walls:', floor.spaces[1].wallIds.length);

const mergedSpace = kernel.buildMergedSpaceForDeletedSharedWall(floor, shared_part.id);

if (!mergedSpace) {
  console.log('MERGE FAILED');
  const boundaryWallIds = floor.spaces.flatMap(s => s.wallIds.filter(id => id !== shared_part.id));
  const ordered = kernel.orderClosedBoundaryWallIds(floor, boundaryWallIds);
  console.log('Boundary count:', boundaryWallIds.length, 'Ordered count:', ordered.length);
} else {
  console.log('MERGE SUCCEEDED');
}
