const kernel = require('../miniprogram/utils/survey/legacy-kernel');
let draft = kernel.createSurveyDraft();
draft = kernel.placeCursor(draft, { xMm: 0, yMm: 0 });
draft = kernel.startPreview(draft, { xMm: 0, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: -4000 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 4000, yMm: 0 });
draft = kernel.commitPreviewLength(draft, 4000, 'test');
draft = kernel.startPreview(draft, { xMm: 0, yMm: 0 });
draft = kernel.confirmClosure(draft);

const target = kernel.getCursorPlacementTarget(draft.floors[0], { xMm: 0, yMm: -2000 }, 1000);
draft = kernel.placeCursor(draft, target.pointMm);
draft = kernel.startPreview(draft, { xMm: 2000, yMm: -2000 });
draft = kernel.commitPreviewLength(draft, 2000, 'test');

console.log('Spaces after stub:', draft.floors[0].spaces.length);
