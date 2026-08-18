const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const sc = catalog.find(c => c.key === 'merged-room-middle-deletion');
let draft = sc.build();

const spaces = draft.floors[0].spaces;
const room1Walls = spaces[0].wallIds;
const room2Walls = spaces[1].wallIds;
const sharedWallId = room1Walls.find(id => room2Walls.includes(id));
console.log('Room 1 walls:', room1Walls.length);
console.log('Room 2 walls:', room2Walls.length);

draft = kernel.deleteWall(draft, sharedWallId);

const mergedSpace = draft.floors[0].spaces[0];
console.log('Merged room walls:', mergedSpace.wallIds.length);
