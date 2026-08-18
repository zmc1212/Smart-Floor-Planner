const kernel = require('./miniprogram/utils/survey/legacy-kernel.js');
const fs = require('fs');

// We can just call the mergedRoomAfterDeletion function directly if we extract it, or we can just run it using the kernel.
const thk = 200;
const room1W = 3129;
const room1H = 3565;

let draft = kernel.createSurveyDraft();
draft = kernel.placeCursor(draft, { xMm: 0, yMm: 0 });
draft = kernel.startPreview(draft, { xMm: 0, yMm: -room1H });
draft = kernel.commitPreviewLength(draft, room1H, 'test');
draft = kernel.startPreview(draft, { xMm: room1W, yMm: -room1H });
draft = kernel.commitPreviewLength(draft, room1W, 'test');
draft = kernel.startPreview(draft, { xMm: room1W, yMm: 0 });
draft = kernel.commitPreviewLength(draft, room1H, 'test');
draft = kernel.startPreview(draft, { xMm: 0, yMm: 0 });
draft = kernel.confirmClosure(draft);

// Room 1 created. Now room 2.
// Start at outer top-right
draft = kernel.placeCursor(draft, { xMm: room1W + thk, yMm: -room1H - thk });
// wait, the previous placeCursor might need getCursorPlacementTarget
const target = kernel.getCursorPlacementTarget(draft.floors[0], { xMm: room1W + thk, yMm: -room1H - thk }, 1000);
draft = kernel.placeCursor(draft, target.pointMm);

draft = kernel.startPreview(draft, { xMm: room1W + thk + 2454, yMm: -room1H - thk });
draft = kernel.commitPreviewLength(draft, 2454, 'test');
draft = kernel.startPreview(draft, { xMm: room1W + thk + 2454, yMm: -room1H - thk + 1769 });
draft = kernel.commitPreviewLength(draft, 1769, 'test');
draft = kernel.startPreview(draft, { xMm: room1W + thk, yMm: -room1H - thk + 1769 });
draft = kernel.confirmClosure(draft);

const spaces = draft.floors[0].spaces;
console.log('Spaces before delete:', spaces.length);

const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
console.log('Shared wall ID:', sharedWallId);

draft = kernel.deleteWall(draft, sharedWallId);
console.log('Spaces after delete:', draft.floors[0].spaces.length);

if (draft.floors[0].spaces.length === 1) {
    console.log('MERGE SUCCESSFUL! Resulting wall count:', draft.floors[0].spaces[0].wallIds.length);
} else {
    console.log('MERGE FAILED. Boundary walls:', draft.floors[0].walls.length);
}

