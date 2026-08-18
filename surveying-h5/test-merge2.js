const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const mergeScenario = catalog.find(c => c.key === 'merged-room-after-deletion');

let draft = mergeScenario.build();
console.log('Spaces after delete:', draft.floors[0].spaces.length);
if (draft.floors[0].spaces.length === 1) {
    console.log('MERGE SUCCESSFUL! Resulting wall count:', draft.floors[0].spaces[0].wallIds.length);
} else {
    console.log('MERGE FAILED. Spaces:', draft.floors[0].spaces.length);
}
