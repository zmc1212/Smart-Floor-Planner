const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const sc = catalog.find(c => c.key === 'merged-room-middle-deletion');
let draft = sc.build();

const spaces = draft.floors[0].spaces;
console.log('Spaces count:', spaces.length);
if (spaces.length < 2) {
    console.log('Walls:', draft.floors[0].walls.length);
}
