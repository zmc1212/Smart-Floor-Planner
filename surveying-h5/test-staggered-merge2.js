const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);

// Helper functions from scenarios.js are captured inside createScenarioCatalog, but we can just use the exposed catalog.
// I'll just write my own quick script using startPreview/commitPreviewLength.
let draft = kernel.createSurveyDraft();

// Start Room 1 at (0, 0)
draft = kernel.placeCursor(draft, { xMm: 0, yMm: 0 });
draft = kernel.startPreview(draft, { xMm: 0, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: 0 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 0, yMm: 0 });
draft = kernel.confirmClosure(draft);

// Room 1 is from (0,-4000) top left to (4000,0) bottom right.
// Top wall is (0,-4000) to (4000,-4000).
// Let's attach Room 2 to the top wall.
// Room 2 left wall starts at x=2000, goes up to y=-6000
const target = kernel.getCursorPlacementTarget(draft.floors[0], { xMm: 2000, yMm: -4000 }, 1000);
draft = kernel.placeCursor(draft, target.pointMm);
draft = kernel.startPreview(draft, { xMm: 2000, yMm: -6000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');
draft = kernel.startPreview(draft, { xMm: 6000, yMm: -6000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 6000, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');

// Close it by snapping back to the top wall at x=4000 (Wait, we should snap to x=2000!)
draft = kernel.startPreview(draft, { xMm: 2000, yMm: -4000 });
draft = kernel.confirmClosure(draft);

const spaces = draft.floors[0].spaces;
console.log('Room 1 walls:', spaces[0].wallIds.length);
console.log('Room 2 walls:', spaces[1].wallIds.length);

const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
console.log('Shared wall ID:', sharedWallId);

draft = kernel.deleteWall(draft, sharedWallId);

const mergedSpace = draft.floors[0].spaces[0];
if (draft.floors[0].spaces.length === 1) {
  console.log('MERGE SUCCEEDED');
} else {
  console.log('MERGE FAILED. Spaces:', draft.floors[0].spaces.length);
}
