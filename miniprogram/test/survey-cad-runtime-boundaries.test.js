const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('full validation is completion-only and absent from load, drag and render paths', () => {
  const editor = read('packages/surveying/editor/surveying-editor.js');
  const renderer = read('packages/surveying/utils/surveyCanvasRenderer.js');
  const matches = editor.match(/validateSurveyDraft/g) || [];
  assert.equal(matches.length, 1);
  assert.match(editor, /if \(status === 'completed'\)[\s\S]{0,180}validateSurveyDraft\(this\.draft, \{ mode: 'full' \}\)/);
  assert.doesNotMatch(editor, /face-extractor/);
  assert.doesNotMatch(renderer, /validateSurveyDraft|face-extractor/);
});

test('snap lock remains editor-local and is cleared at drag boundaries', () => {
  const editor = read('packages/surveying/editor/surveying-editor.js');
  assert.match(editor, /previousLock: this\.cursorSnapLock/);
  assert.ok((editor.match(/this\.cursorSnapLock = null/g) || []).length >= 3);
  assert.doesNotMatch(read('utils/survey/legacy-kernel.js'), /cursorSnapLock/);
});
