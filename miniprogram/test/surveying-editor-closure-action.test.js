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
const editorWxss = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.wxss'),
  'utf8'
);

test('the close action follows the graph minimum-wall rule for standalone and shared starts', () => {
  assert.match(
    editorScript,
    /const minimumActiveWallCount = surveyGraph\.getMinimumClosureSuggestionWallCount\(floor, session\)/
  );
  assert.match(editorScript, /const actionVisible = session\.state === 'closing' \|\| session\.state === 'mergeClosing'/);
  assert.match(editorScript, /left:\$\{roundPx\(actionX - actionRadius\)\}px; top:\$\{roundPx\(actionY - actionRadius\)\}px;/);
  assert.match(editorWxml, /wx:if="\{\{!componentEditorVisible && closeActionVisible\}\}"[\s\S]*catchtap="onConfirmClose"/);
  assert.match(editorWxml, /aria-label="闭合当前空间"[\s\S]*<cover-view class="closure-action-label">合<\/cover-view>/);
  assert.match(editorWxss, /\.closure-action\s*\{\s*width: 56rpx;\s*height: 56rpx;\s*border: 0;\s*border-radius: 50%;\s*background: var\(--brand-primary\);/);
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
