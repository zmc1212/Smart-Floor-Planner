const fs = require('fs');
let code = fs.readFileSync('./miniprogram/utils/survey/legacy-kernel.js', 'utf8');

const replacement = "    session.closeCandidatePoint = null;\n" +
"    let correctSharedWallId = session.activeSpaceSharedWallId;\n" +
"    if (session.activeSpaceSharedWallId) {\n" +
"      const activeWalls = (floor.walls || []).slice(session.activeSpaceStartWallIndex || 0);\n" +
"      const activeWallIds = {};\n" +
"      activeWalls.forEach((wall) => { activeWallIds[wall.id] = true; });\n" +
"      const targetWall = (floor.walls || []).find((wall) => \n" +
"        !activeWallIds[wall.id] && (wall.startNodeId === closeTargetNode.id || wall.endNodeId === closeTargetNode.id)\n" +
"      );\n" +
"      if (targetWall) correctSharedWallId = targetWall.id;\n" +
"    }\n" +
"    session.closeCandidateType = correctSharedWallId ? 'shared-wall' : 'merge';\n" +
"    session.closeCandidateSharedWallId = correctSharedWallId || '';\n" +
"    console.log('DEBUG: closeCandidateSharedWallId set to', session.closeCandidateSharedWallId, 'for targetNode', closeTargetNode.id);\n";

code = code.replace(
  /session\.closeCandidatePoint = null;\r?\n\s*session\.closeCandidateType = session\.activeSpaceSharedWallId \? 'shared-wall' : 'merge';\r?\n\s*session\.closeCandidateSharedWallId = session\.activeSpaceSharedWallId \|\| '';/,
  replacement
);

code = code.replace(/const sharedWallIds = session\.activeSpaceStartNodeId/, 
'console.log(\"DEBUG-PATH: sharedCloseNodeId=\", sharedCloseNodeId, \"sharedStartNodeId=\", sharedStartNodeId);\n' +
'$&');

fs.writeFileSync('./miniprogram/utils/survey/legacy-kernel-temp.js', code);

const kernelTemp = require('./miniprogram/utils/survey/legacy-kernel-temp.js');
let d = kernelTemp.resetCursor(kernelTemp.createSurveyDraft());
d = kernelTemp.setThickness(d, 200);
d = kernelTemp.placeCursor(d, {xMm:0, yMm:0});
d = kernelTemp.commitPreviewLength(kernelTemp.startPreview(d, {xMm:3207, yMm:0}), 3207, 'manual');
d = kernelTemp.commitPreviewLength(kernelTemp.startPreview(d, {xMm:3207, yMm:3342}), 3342, 'manual');
d = kernelTemp.commitPreviewLength(kernelTemp.startPreview(d, {xMm:0, yMm:3342}), 3207, 'manual');
d = kernelTemp.confirmClosure(d);

const floor = kernelTemp.getActiveFloor(d);
const target = kernelTemp.getCursorPlacementTarget(floor, {xMm: 1582, yMm: -200}, kernelTemp.CLOSE_TOLERANCE_MM);
d = kernelTemp.snapCursorToWall(kernelTemp.startWallSnap(d), target.pointMm, target);
d = kernelTemp.commitPreviewLength(kernelTemp.startPreview(d, {xMm:1582, yMm:-2008}), 1808, 'manual');
d = kernelTemp.commitPreviewLength(kernelTemp.startPreview(d, {xMm:3407, yMm:-2008}), 1825, 'manual');
const floor2 = kernelTemp.getActiveFloor(d);
const target2 = kernelTemp.getCursorPlacementTarget(floor2, {xMm: 3407, yMm: -200}, kernelTemp.CLOSE_TOLERANCE_MM);
d = kernelTemp.startPreview(d, target2.pointMm, target2);

try {
  d = kernelTemp.confirmClosure(d);
  console.log('SUCCESS!!');
  const validator = require('./miniprogram/utils/survey/invariants/floor-plan-validator.js');
  const errs = validator.validateSurveyDraft(d);
  console.log('Errors:', JSON.stringify(errs, null, 2));
} catch(e) {
  console.log('Caught:', e.message);
}
fs.unlinkSync('./miniprogram/utils/survey/legacy-kernel-temp.js');
