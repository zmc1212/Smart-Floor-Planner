const kernel = require('../miniprogram/utils/survey/legacy-kernel');
const scenarios = require('./src/scenarios');
const catalog = scenarios.createScenarioCatalog(kernel);

let draft = kernel.createSurveyDraft();

draft = kernel.placeCursor(draft, { xMm: 0, yMm: 0 });
draft = kernel.startPreview(draft, { xMm: 0, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 6000, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 6000, 'test');
draft = kernel.startPreview(draft, { xMm: 6000, yMm: 0 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 0, yMm: 0 });
draft = kernel.confirmClosure(draft);

let floor = draft.floors[0];

// Start Room 2 at (2000, -4000)
const t1 = kernel.getCursorPlacementTarget(floor, { xMm: 2000, yMm: -4000 }, 1000);
draft = kernel.placeCursor(draft, t1.pointMm);
draft = kernel.startPreview(draft, { xMm: 2000, yMm: -6000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: -6000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: -4000 });

floor = draft.floors[0];
const t2 = kernel.getCursorPlacementTarget(floor, { xMm: 4000, yMm: -4000 }, 1000);
draft = kernel.startPreview(draft, t2.pointMm);
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
