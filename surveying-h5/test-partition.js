const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const p = catalog.find(c => c.key === 'partition');
let draft = p.build();
console.log('Spaces:', draft.floors[0].spaces.length);
