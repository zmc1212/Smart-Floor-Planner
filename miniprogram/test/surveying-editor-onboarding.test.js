const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const editorDir = path.join(miniRoot, 'pages', 'surveying-editor');
const editorScript = fs.readFileSync(path.join(editorDir, 'surveying-editor.js'), 'utf8');
const editorWxml = fs.readFileSync(path.join(editorDir, 'surveying-editor.wxml'), 'utf8');
const editorWxss = fs.readFileSync(path.join(editorDir, 'surveying-editor.wxss'), 'utf8');
const navigationScript = fs.readFileSync(path.join(miniRoot, 'utils', 'surveyNavigation.js'), 'utf8');
const planRoute = fs.readFileSync(
  path.join(miniRoot, '..', 'admin', 'src', 'app', 'api', 'floorplans', '[id]', 'route.ts'),
  'utf8'
);

test('formal surveying titles resolve to the linked community instead of a formal-survey label', () => {
  assert.match(navigationScript, /communityName: opts\.communityName \|\| ''/);
  assert.match(editorScript, /title: context\.communityName \|\| '未填写小区'/);
  assert.match(editorScript, /title: communityName \|\| '未填写小区'/);
  assert.match(planRoute, /findByFloorPlanId\(plan\.id\)/);
  assert.match(planRoute, /lead: lead/);
  assert.match(editorWxss, /\.page-title\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
});

test('empty surveying sessions use a one-time compact onboarding package', () => {
  assert.match(editorScript, /SURVEYING_ONBOARDING_SEEN_KEY/);
  assert.match(editorScript, /wx\.getStorageSync\(SURVEYING_ONBOARDING_SEEN_KEY\)/);
  assert.match(editorScript, /wx\.setStorageSync\(SURVEYING_ONBOARDING_SEEN_KEY, true\)/);
  assert.match(editorScript, /onOnboardingNext\(\)/);
  assert.match(editorWxml, /class="survey-onboarding \{\{onboardingTarget\}\}"/);
  assert.match(editorWxml, /onboardingProgress/);
  assert.doesNotMatch(editorWxml, /empty-survey-guide/);
  assert.match(editorWxss, /\.survey-onboarding\s*\{[\s\S]*pointer-events:\s*auto;/);
});

test('first onboarding step uses the reference-derived measuring Xiao K crop', () => {
  const asset = fs.readFileSync(path.join(miniRoot, 'images', 'surveying-onboarding-k.png'));
  assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(asset.length > 1024);
  assert.match(editorWxml, /\/images\/surveying-onboarding-k\.png/);
});
