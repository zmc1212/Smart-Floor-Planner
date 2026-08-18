const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const sc = catalog.find(c => c.key === 'outer-face-mid-wall-closure');
let draft = sc.build();

const spaces = draft.floors[0].spaces;
const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));

const preMergeWalls = spaces.reduce((acc, space) => acc + space.wallIds.length, 0);
console.log('Pre merge walls (Room 1 + Room 2):', preMergeWalls);

draft = kernel.deleteWall(draft, sharedWallId);

const merged = draft.floors[0].spaces[0];
console.log('Post merge walls:', merged.wallIds.length);
