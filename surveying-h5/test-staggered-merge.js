const kernel = require('../miniprogram/utils/survey/legacy-kernel');
let floor = kernel.createSurveyDraft().floors[0];

// Create Room 1
const n1 = kernel.addNode(floor, { xMm: 0, yMm: 4000 });
const n2 = kernel.addNode(floor, { xMm: 4000, yMm: 4000 });
const n3 = kernel.addNode(floor, { xMm: 4000, yMm: 2000 });
const n4 = kernel.addNode(floor, { xMm: 0, yMm: 2000 });

const w1 = kernel.addWall(floor, { startNodeId: n1.id, endNodeId: n2.id, thicknessMm: 200 });
const w2 = kernel.addWall(floor, { startNodeId: n2.id, endNodeId: n3.id, thicknessMm: 200 });
const w3 = kernel.addWall(floor, { startNodeId: n3.id, endNodeId: n4.id, thicknessMm: 200 });
const w4 = kernel.addWall(floor, { startNodeId: n4.id, endNodeId: n1.id, thicknessMm: 200 });

kernel.addSpace(floor, {
  id: 'space1',
  name: 'Room 1',
  wallIds: [w1.id, w2.id, w3.id, w4.id],
  closed: true
});

// We need to split w3 (Top wall of Room 1) at x=2000 to attach Room 2.
const n5 = kernel.addNode(floor, { xMm: 2000, yMm: 2000 });
kernel.splitWallAtNodes(floor, w3.id, [n5.id]);
// Now Room 1's top wall (w3) is split. 
// w3 originally went from (4000, 2000) to (0, 2000).
// Let's find the segments.
const seg1 = floor.walls.find(w => (w.startNodeId === n3.id && w.endNodeId === n5.id) || (w.startNodeId === n5.id && w.endNodeId === n3.id)); // (4000, 2000) to (2000, 2000)
const seg2 = floor.walls.find(w => (w.startNodeId === n5.id && w.endNodeId === n4.id) || (w.startNodeId === n4.id && w.endNodeId === n5.id)); // (2000, 2000) to (0, 2000)

// Room 2 attaches to seg1 (the shared segment)
// Room 2: Bottom wall is from (2000, 2000) to (6000, 2000)
// The shared part is (2000, 2000) to (4000, 2000). The non-shared part is (4000, 2000) to (6000, 2000).
const n6 = kernel.addNode(floor, { xMm: 6000, yMm: 2000 });
const w5 = kernel.addWall(floor, { startNodeId: n3.id, endNodeId: n6.id, thicknessMm: 200 }); // Non-shared bottom part

const n7 = kernel.addNode(floor, { xMm: 6000, yMm: 0 });
const w6 = kernel.addWall(floor, { startNodeId: n6.id, endNodeId: n7.id, thicknessMm: 200 }); // Right

const n8 = kernel.addNode(floor, { xMm: 2000, yMm: 0 });
const w7 = kernel.addWall(floor, { startNodeId: n7.id, endNodeId: n8.id, thicknessMm: 200 }); // Top

const w8 = kernel.addWall(floor, { startNodeId: n8.id, endNodeId: n5.id, thicknessMm: 200 }); // Left

kernel.addSpace(floor, {
  id: 'space2',
  name: 'Room 2',
  wallIds: [seg1.id, w5.id, w6.id, w7.id, w8.id],
  closed: true
});

const sharedWallId = seg1.id;
console.log('Room 1 walls:', floor.spaces[0].wallIds.length);
console.log('Room 2 walls:', floor.spaces[1].wallIds.length);

// Delete the shared wall
const mergedSpace = kernel.buildMergedSpaceForDeletedSharedWall(floor, sharedWallId);

if (!mergedSpace) {
  console.log('MERGE FAILED');
  const boundaryWallIds = floor.spaces.flatMap(s => s.wallIds.filter(id => id !== sharedWallId));
  const ordered = kernel.orderClosedBoundaryWallIds(floor, boundaryWallIds);
  console.log('Boundary count:', boundaryWallIds.length, 'Ordered count:', ordered.length);
} else {
  console.log('MERGE SUCCEEDED');
}
