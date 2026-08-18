const kernel = require('../miniprogram/utils/survey/legacy-kernel');
let floor = kernel.createFloor();

// Room 1: Left room, lower than right room
const n1 = kernel.addNode(floor, { xMm: 0, yMm: 2000 });
const n2 = kernel.addNode(floor, { xMm: 0, yMm: 6000 });
const n3 = kernel.addNode(floor, { xMm: 4000, yMm: 6000 });
const n4 = kernel.addNode(floor, { xMm: 4000, yMm: 2000 });

const w1 = kernel.addWall(floor, { startNodeId: n1.id, endNodeId: n2.id, thicknessMm: 200 }); // Left
const w2 = kernel.addWall(floor, { startNodeId: n2.id, endNodeId: n3.id, thicknessMm: 200 }); // Bottom
const w3 = kernel.addWall(floor, { startNodeId: n3.id, endNodeId: n4.id, thicknessMm: 200 }); // Right
const w4 = kernel.addWall(floor, { startNodeId: n4.id, endNodeId: n1.id, thicknessMm: 200 }); // Top

kernel.addSpace(floor, {
  id: 'space1',
  name: 'Room 1',
  wallIds: [w1.id, w2.id, w3.id, w4.id],
  closed: true
});

// Room 2: Right room, starts higher than Room 1
// We need to split Room 1's right wall at the intersection point.
// Let's say Room 2's bottom aligns with y=4000
const n5 = kernel.addNode(floor, { xMm: 4000, yMm: 4000 }); // Bottom of shared segment

// Split w3 at n5
kernel.splitWallAtNodes(floor, w3.id, [n5.id]);
// Now w3 is split into two segments: n3->n5 (bottom, non-shared), n5->n4 (top, shared)
// Actually w3 was n3(6000)->n4(2000), so the shared segment is n5(4000)->n4(2000).
const sharedWall = floor.walls.find(w => (w.startNodeId === n5.id && w.endNodeId === n4.id) || (w.startNodeId === n4.id && w.endNodeId === n5.id));

// Room 2 walls
// n4 is the top of Room 1's right wall. Room 2 continues UP from n4.
const n6 = kernel.addNode(floor, { xMm: 4000, yMm: 0 }); // Top-left of Room 2
const n7 = kernel.addNode(floor, { xMm: 8000, yMm: 0 }); // Top-right of Room 2
const n8 = kernel.addNode(floor, { xMm: 8000, yMm: 4000 }); // Bottom-right of Room 2

const w5 = kernel.addWall(floor, { startNodeId: n4.id, endNodeId: n6.id, thicknessMm: 200 }); // Left (non-shared)
const w6 = kernel.addWall(floor, { startNodeId: n6.id, endNodeId: n7.id, thicknessMm: 200 }); // Top
const w7 = kernel.addWall(floor, { startNodeId: n7.id, endNodeId: n8.id, thicknessMm: 200 }); // Right
const w8 = kernel.addWall(floor, { startNodeId: n8.id, endNodeId: n5.id, thicknessMm: 200 }); // Bottom

kernel.addSpace(floor, {
  id: 'space2',
  name: 'Room 2',
  wallIds: [w5.id, w6.id, w7.id, w8.id, sharedWall.id],
  closed: true
});

console.log('Room 1 walls:', floor.spaces.find(s => s.id === 'space1').wallIds.length);
console.log('Room 2 walls:', floor.spaces.find(s => s.id === 'space2').wallIds.length);

const mergedSpace = kernel.buildMergedSpaceForDeletedSharedWall(floor, sharedWall.id);

if (!mergedSpace) {
  console.log('MERGE FAILED');
  const affectedSpaces = floor.spaces;
  const boundaryWallIds = affectedSpaces.flatMap(s => s.wallIds.filter(id => id !== sharedWall.id));
  const ordered = kernel.orderClosedBoundaryWallIds(floor, boundaryWallIds);
  console.log('Boundary count:', boundaryWallIds.length, 'Ordered count:', ordered.length);
} else {
  console.log('MERGE SUCCEEDED');
}
