const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const sc = catalog.find(c => c.key === 'merged-room-middle-top');
let draft = sc.build();

const spaces = draft.floors[0].spaces;
console.log('Spaces after delete:', spaces.length);
if (spaces.length === 1) {
    const merged = spaces[0];
    console.log('Merged room walls:', merged.wallIds.length);
}
