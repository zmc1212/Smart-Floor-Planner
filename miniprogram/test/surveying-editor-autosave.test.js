const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const editorScript = fs.readFileSync(
  path.join(miniRoot, 'packages', 'surveying', 'editor', 'surveying-editor.js'),
  'utf8'
);

function extractMethod(source, methodName) {
  const start = source.indexOf(`  ${methodName}() {`);
  assert.ok(start >= 0, `missing ${methodName}`);
  const next = source.indexOf('\n  ', start + `  ${methodName}() {`.length);
  let cursor = start + `  ${methodName}() {`.length;
  let depth = 1;
  while (cursor < source.length && depth > 0) {
    const ch = source[cursor];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    cursor += 1;
  }
  return source.slice(start, cursor);
}

test('surveying editor flushes local draft and silent-cloud-saves on hide and unload', () => {
  assert.match(editorScript, /require\('\.\.\/utils\/surveyDraftAutosave\.js'\)/);

  const hide = extractMethod(editorScript, 'onHide');
  assert.match(hide, /this\.finishViewportInteraction\(\{ sync: true, persist: false \}\)/);
  assert.match(hide, /this\.flushFormalPersist\(\)/);
  assert.match(hide, /this\.autosaveFormalFloorPlan\(\)/);
  assert.doesNotMatch(hide, /wx\.navigateBack/);
  assert.doesNotMatch(hide, /wx\.showToast/);
  assert.doesNotMatch(hide, /wx\.showLoading/);

  const unload = extractMethod(editorScript, 'onUnload');
  assert.match(unload, /this\.flushFormalPersist\(\)/);
  assert.match(unload, /this\.autosaveFormalFloorPlan\(\)/);
  assert.doesNotMatch(unload, /wx\.navigateBack/);
});

test('surveying editor keeps a newer local draft when the cloud copy is stale', () => {
  assert.match(editorScript, /persistFormalDraft\(\) \{[\s\S]*this\.localDraftSavedAt[\s\S]*wrapFormalDraftStorage/);
  assert.match(editorScript, /loadFormalDraft\(leadId, serverDraft, draftKey\) \{[\s\S]*unwrapFormalDraftStorage/);
  assert.match(editorScript, /shouldKeepLocalSurveyDraft\(/);
  assert.match(editorScript, /if \(keepLocal\) this\.autosaveFormalFloorPlan\(\)/);
});
