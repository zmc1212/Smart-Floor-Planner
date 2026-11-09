const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph');
const surveyLayout = require('../utils/surveyLayout');
const draftStorage = require('../packages/surveying/utils/surveyDraftAutosave');

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

function localPersistence(storage) {
  return vm.runInNewContext(`({${extractMethod(editorScript, 'persistFormalDraft')}}).persistFormalDraft`, {
    surveyGraph, surveyLayout,
    hasPersistedSurveyContent: draftStorage.hasPersistedSurveyContent,
    wrapFormalDraftStorage: draftStorage.wrapFormalDraftStorage,
    wx: { setStorageSync: (key, value) => storage.set(key, value) },
  });
}

test('leaving during cloud load never replaces a saved wall graph with the initial empty canvas', () => {
  const measured = require('./fixtures/survey-cad/scenarios').rectangle();
  const previous = draftStorage.wrapFormalDraftStorage(measured, 1000);
  const storage = new Map([['owned-plan', previous]]);
  const page = { draft: surveyGraph.createSurveyDraft(), formalDraftKey: 'owned-plan',
    data: { leadId: 'owned-lead' }, localDraftSavedAt: 1000, formalCloudLoadInFlight: true };
  const persist = localPersistence(storage);
  assert.equal(persist.call(page), false);
  assert.equal(storage.get('owned-plan'), previous);
  assert.equal(page.localDraftSavedAt, 1000);
  page.draft = measured;
  page.formalCloudLoadInFlight = false;
  assert.equal(persist.call(page), true);
  assert.equal(storage.get('owned-plan').draft.floors[0].walls.length, 4);
});

test('real edits during load and an intentional clear after load still persist', () => {
  const storage = new Map();
  const page = { draft: require('./fixtures/survey-cad/scenarios').rectangle(), formalDraftKey: 'owned-plan',
    data: { leadId: 'owned-lead' }, formalCloudLoadInFlight: true };
  const persist = localPersistence(storage);
  assert.equal(persist.call(page), true);
  assert.equal(storage.get('owned-plan').draft.floors[0].walls.length, 4);
  page.formalCloudLoadInFlight = false;
  page.draft = surveyGraph.createSurveyDraft();
  assert.equal(persist.call(page), true);
  assert.equal(storage.get('owned-plan').draft.floors[0].walls.length, 0);
});
