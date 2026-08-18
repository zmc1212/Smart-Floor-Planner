const kernel = require('../miniprogram/utils/survey/legacy-kernel');
let draft = kernel.createSurveyDraft();

// Draw Room 1 (4000x4000)
draft = kernel.placeCursor(draft, { xMm: 0, yMm: 0 });
draft = kernel.startPreview(draft, { xMm: 0, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: 0 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 0, yMm: 0 });
draft = kernel.confirmClosure(draft);

let floor = draft.floors[0];

// Draw Room 2 (2000x2000), starting at (2000, -4000) and ending at (4000, -4000)
const targetLeft = kernel.getCursorPlacementTarget(floor, { xMm: 2000, yMm: -4000 }, 1000);
draft = kernel.placeCursor(draft, targetLeft.pointMm);
draft = kernel.startPreview(draft, { xMm: 2000, yMm: -6000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: -6000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');

// Last wall: going down to (4000, -4000). The target should be the top-right corner of Room 1.
// BUT Room 1's top-right OUTER corner is at (4100, -4100) or similar.
// What happens in the H5 when you hover over the top-right corner?
floor = draft.floors[0];
const targetRight = kernel.getCursorPlacementTarget(floor, { xMm: 4000, yMm: -4000 }, 1000);
console.log('Target for closure:', targetRight.type, targetRight.pointMm);

draft = kernel.startPreview(draft, targetRight.pointMm);
draft = kernel.confirmClosure(draft);

const spaces = draft.floors[0].spaces;
const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
console.log('Shared wall ID:', sharedWallId);

const mergedDraft = kernel.deleteWall(draft, sharedWallId);
console.log('Merged spaces:', mergedDraft.floors[0].spaces.length);

