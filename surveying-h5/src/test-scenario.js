const { createScenarioCatalog } = require('./scenarios.js');
const surveyGraph = require('../../miniprogram/utils/surveyWallGraph.js');

const scenarios = createScenarioCatalog(surveyGraph);
const scenario = scenarios.find(s => s.key === 'outer-face-mid-wall-closure');
let draft = scenario.build();

const floor = draft.floors[0];
console.log('Before delete:');
console.log('Spaces:', floor.spaces.length);
floor.spaces.forEach((s, i) => console.log('Space ' + i + ' closed:', s.closed));

let sharedWallId = null;
for (const w of floor.spaces[0].wallIds) {
  if (floor.spaces[1].wallIds.includes(w)) {
    sharedWallId = w;
    break;
  }
}
console.log('Shared wall:', sharedWallId);

draft = surveyGraph.deleteWall(draft, sharedWallId);
const floor2 = draft.floors[0];
console.log('After delete:');
console.log('Spaces:', floor2.spaces.length);
floor2.spaces.forEach((s, i) => console.log('Space ' + i + ' closed:', s.closed));
