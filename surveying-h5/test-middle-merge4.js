const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);
const sc = catalog.find(c => c.key === 'merged-room-middle-deletion');
let draft = sc.build();

const merged = draft.floors[0].spaces[0];
console.log('Merged room walls:');
for (let wid of merged.wallIds) {
    const w = draft.floors[0].walls.find(x => x.id === wid);
    const n1 = draft.floors[0].nodes.find(x => x.id === w.startNodeId);
    const n2 = draft.floors[0].nodes.find(x => x.id === w.endNodeId);
    console.log('Wall ' + wid + ': (' + n1.xMm + ', ' + n1.yMm + ') -> (' + n2.xMm + ', ' + n2.yMm + ')');
}
