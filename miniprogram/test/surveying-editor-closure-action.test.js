const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editorScript = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.js'),
  'utf8'
);
const editorWxml = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.wxml'),
  'utf8'
);

test('a one-wall shared-boundary closure renders its close action', () => {
  assert.match(
    editorScript,
    /const minimumActiveWallCount = session\.activeSpaceSharedWallId \? 1 : \(hasSharedBoundary \? 2 : 3\)/
  );
  assert.match(editorScript, /const actionVisible = session\.state === 'closing' \|\| session\.state === 'mergeClosing'/);
  assert.match(editorWxml, /wx:if="\{\{closeActionVisible\}\}"[\s\S]*catchtap="onConfirmClose"/);
});

test('a placed cursor keeps its guide visibility when the canvas render data is returned', () => {
  assert.match(editorScript, /return \{\s*cursorVisible,\s*guideVisible,/);
});

test('wall-snapped cursor drops clear a late transient frame after the formal canvas redraw', () => {
  assert.match(
    editorScript,
    /this\.drawSurveyCanvas\(\);\s*\/\/ A cursor-drag frame[\s\S]*?this\.clearCursorDragCanvas\(\{ force: true \}\);/
  );
});

test('viewport gestures render on the primary canvas instead of the cursor overlay', () => {
  assert.match(
    editorScript,
    /drawViewportInteractionFrame\(viewport\)[\s\S]*?this\.surveyCtx,[\s\S]*?dpr: this\.surveyCanvasDpr \|\| 1/
  );
});
