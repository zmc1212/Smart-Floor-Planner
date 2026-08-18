const kernel = require('../miniprogram/utils/survey/legacy-kernel');

let floor = kernel.createFloor();

// Room 1: 0 to 4000 vertically.
const n1 = kernel.addNode(floor, { xMm: 0, yMm: 0 });
const n2 = kernel.addNode(floor, { xMm: 0, yMm: 4000 });
const n3 = kernel.addNode(floor, { xMm: 3000, yMm: 4000 });
const n4 = kernel.addNode(floor, { xMm: 3000, yMm: 0 });

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

// Room 2: Attached to the MIDDLE of Room 1's right wall (y=1000 to y=3000)
const n5 = kernel.addNode(floor, { xMm: 3000, yMm: 1000 });
const n6 = kernel.addNode(floor, { xMm: 3000, yMm: 3000 });
kernel.splitWallAtNodes(floor, w3.id, [n5.id, n6.id]);

// After split, w3 is now 3 segments: n3(3000,4000)->n6(3000,3000), n6(3000,3000)->n5(3000,1000), n5(3000,1000)->n4(3000,0)
const sharedWall = floor.walls.find(w => (w.startNodeId === n5.id && w.endNodeId === n6.id) || (w.startNodeId === n6.id && w.endNodeId === n5.id));

const n7 = kernel.addNode(floor, { xMm: 6000, yMm: 1000 });
const n8 = kernel.addNode(floor, { xMm: 6000, yMm: 3000 });

const w5 = kernel.addWall(floor, { startNodeId: n5.id, endNodeId: n7.id, thicknessMm: 200 });
const w6 = kernel.addWall(floor, { startNodeId: n7.id, endNodeId: n8.id, thicknessMm: 200 });
const w7 = kernel.addWall(floor, { startNodeId: n8.id, endNodeId: n6.id, thicknessMm: 200 });

kernel.addSpace(floor, {
  id: 'space2',
  name: 'Room 2',
  wallIds: [w5.id, w6.id, w7.id, sharedWall.id],
  closed: true
});

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
