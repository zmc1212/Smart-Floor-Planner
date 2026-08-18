const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const stagg = catalog.find(c => c.key === 'staggered-adjacent');
let draft = stagg.build();

const spaces = draft.floors[0].spaces;
const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
draft = kernel.deleteWall(draft, sharedWallId);

if (draft.floors[0].spaces.length === 1) {
    console.log('MERGE SUCCESSFUL! Resulting wall count:', draft.floors[0].spaces[0].wallIds.length);
} else {
    console.log('MERGE FAILED. Spaces:', draft.floors[0].spaces.length);
}
