const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const sc = catalog.find(c => c.key === 'merged-room-middle-deletion');
// Wait, I need to call the new scenario function, but I didn't add it to the catalog!
const scFn = require('./src/scenarios')(kernel);
const draft = scFn.mergedRoomWithThirdRoom();

console.log('Spaces count:', draft.floors[0].spaces.length);
