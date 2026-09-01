const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const surveyNavigation = fs.readFileSync(path.join(miniRoot, 'utils', 'surveyNavigation.js'), 'utf8');
const aiDesignNavigation = fs.readFileSync(path.join(miniRoot, 'utils', 'aiDesignNavigation.js'), 'utf8');
const leadDetailJs = fs.readFileSync(
  path.join(miniRoot, 'packages', 'business', 'lead-detail', 'lead-detail.js'),
  'utf8'
);
const leadDetailWxml = fs.readFileSync(
  path.join(miniRoot, 'packages', 'business', 'lead-detail', 'lead-detail.wxml'),
  'utf8'
);

test('survey navigation ignores duplicate open requests while entering the editor', () => {
  assert.match(surveyNavigation, /let openingSurveyEditor = false;/);
  assert.match(surveyNavigation, /if \(openingSurveyEditor\) return false;/);
  assert.match(surveyNavigation, /openingSurveyEditor = true;/);
  assert.match(surveyNavigation, /complete:\s*\(\)\s*=>\s*\{[\s\S]*openingSurveyEditor = false;/);
});

test('lead detail guards page navigations and uses catchtap for formal-survey CTAs', () => {
  assert.match(leadDetailJs, /navigateOnce\(url\)/);
  assert.match(leadDetailJs, /if \(this\._navigating\) return;/);
  assert.match(leadDetailWxml, /catchtap="onStartMeasure"/);
  assert.match(leadDetailWxml, /catchtap="onOpenAppointment"/);
  assert.match(leadDetailWxml, /catchtap="onOpenAIDesignWorkbench"/);
});

test('AI design entry ignores duplicate open requests while navigating', () => {
  assert.match(aiDesignNavigation, /let openingAIDesignEntry = false;/);
  assert.match(aiDesignNavigation, /if \(openingAIDesignEntry\) return false;/);
  assert.match(aiDesignNavigation, /openingAIDesignEntry = true;/);
});
