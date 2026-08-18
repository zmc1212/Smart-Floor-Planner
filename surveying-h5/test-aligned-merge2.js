const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);

// Draw Room 1 (Bottom, 4000x2000) and Room 2 (Top, 2000x2000, right aligned)
let draft = kernel.createSurveyDraft();

draft = kernel.placeCursor(draft, { xMm: 0, yMm: 0 });
draft = kernel.startPreview(draft, { xMm: 0, yMm: -2000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: -2000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: 0 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');
draft = kernel.startPreview(draft, { xMm: 0, yMm: 0 });
draft = kernel.confirmClosure(draft);

// Room 1 created. Now attach Room 2 on top. 
// Room 2 left wall starts at (2000, -2000), goes UP to (2000, -4000).
let floor = draft.floors[0];
const targetLeft = kernel.getCursorPlacementTarget(floor, { xMm: 2000, yMm: -2000 }, 1000);
draft = kernel.placeCursor(draft, targetLeft.pointMm);
draft = kernel.startPreview(draft, { xMm: 2000, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');

// Top wall of Room 2 (2000, -4000) to (4000, -4000)
draft = kernel.startPreview(draft, { xMm: 4000, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');

// Right wall of Room 2 (4000, -4000) down to (4000, -2000)
// The target is the top-right corner of Room 1!
floor = draft.floors[0];
const targetRight = kernel.getCursorPlacementTarget(floor, { xMm: 4000, yMm: -2000 }, 1000);
draft = kernel.startPreview(draft, targetRight.pointMm);
draft = kernel.confirmClosure(draft);

const spaces = draft.floors[0].spaces;
const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
console.log('Shared wall ID:', sharedWallId);

const mergedDraft = kernel.deleteWall(draft, sharedWallId);

if (mergedDraft.floors[0].spaces.length === 1) {
  console.log('MERGE SUCCEEDED');
} else {
  console.log('MERGE FAILED. Spaces:', mergedDraft.floors[0].spaces.length);
  const boundaryWallIds = mergedDraft.floors[0].spaces.flatMap(s => s.wallIds.filter(id => id !== sharedWallId));
  const ordered = kernel.orderClosedBoundaryWallIds(mergedDraft.floors[0], boundaryWallIds);
  console.log('Boundary count:', boundaryWallIds.length, 'Ordered count:', ordered.length);
}
