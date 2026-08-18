const fs = require('fs');
const path = require('path');
const kernelPath = path.join(__dirname, 'miniprogram/utils/survey/legacy-kernel.js');
const legacyKernel = require(kernelPath);

function addNode(floor, point) {
  const node = { id: `node-${Date.now()}-${Math.random()}`, xMm: point.xMm, yMm: point.yMm };
  floor.nodes.push(node);
  return node;
}

// Intercept findOverlappingWall inside legacyKernel!
const originalFindOverlappingWall = legacyKernel.__get__ ? legacyKernel.__get__('findOverlappingWall') : null;

let draft = legacyKernel.createSurveyDraft();

draft.settings.defaultThicknessMm = 240;

const node1 = addNode(draft.floors[0], { xMm: 0, yMm: 0 });
const node2 = addNode(draft.floors[0], { xMm: 3000, yMm: 0 });
draft.floors[0].walls.push({
  id: 'wall-1',
  startNodeId: node1.id,
  endNodeId: node2.id,
  thicknessMm: 240,
  lengthMm: 3000
});

draft.floors[0].session.activeSpaceSharedWallId = 'wall-1';
draft.floors[0].session.activeSpaceSharedSnapLine = 'outer';
draft.floors[0].session.mode = 'straight';

draft = legacyKernel.placeCursor(draft, { xMm: 1000, yMm: 240 });
draft = legacyKernel.startPreview(draft, { xMm: 1000, yMm: 1240 });
draft = legacyKernel.commitPreviewLength(draft, 1000, 'preview');

draft = legacyKernel.startPreview(draft, { xMm: 2000, yMm: 1240 });
draft = legacyKernel.commitPreviewLength(draft, 1000, 'preview');

draft = legacyKernel.startPreview(draft, { xMm: 2000, yMm: 240 });
try {
  draft = legacyKernel.commitPreviewLength(draft, 1000, 'manual-input');
  console.log("FINAL STATE:", draft.floors[0].session.state);
} catch (e) {
  console.log("ERROR:", e);
}
