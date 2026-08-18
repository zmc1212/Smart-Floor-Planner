const { createScenarioCatalog } = require('./scenarios.js');
const surveyGraph = require('../../miniprogram/utils/surveyWallGraph.js');

const scenarios = createScenarioCatalog(surveyGraph);
const scenario = scenarios.find(s => s.key === 'outer-face-mid-wall-closure');
let draft = scenario.build();

const floor = draft.floors[0];
let sharedWallId = null;
for (const w of floor.spaces[0].wallIds) {
  if (floor.spaces[1].wallIds.includes(w)) {
    sharedWallId = w;
    break;
  }
}

draft = surveyGraph.deleteWall(draft, sharedWallId);
const floor2 = draft.floors[0];
console.log('Spaces:', floor2.spaces.length);
