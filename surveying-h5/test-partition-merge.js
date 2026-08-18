const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const p = catalog.find(c => c.key === 'partition');
const draft = p.build();

const room1 = draft.floors[0].spaces[0];
const room2 = draft.floors[0].spaces[1];

const sharedWallId = room1.wallIds.find(id => room2.wallIds.includes(id));
console.log('Shared wall:', sharedWallId);

const mergedDraft = kernel.deleteWall(draft, sharedWallId);
console.log('Merged spaces:', mergedDraft.floors[0].spaces.length);
