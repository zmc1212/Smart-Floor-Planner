const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mineStyles = fs.readFileSync(
  path.join(__dirname, '../pages/mine/mine.less'),
  'utf8'
);

test('Mine workbench keeps four columns on narrow real-device viewports', () => {
  const narrowViewportStyles = mineStyles.slice(
    mineStyles.indexOf('@media (max-width: 360px)')
  );

  assert.match(
    mineStyles,
    /\.tool-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    narrowViewportStyles,
    /\.tool-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.doesNotMatch(
    narrowViewportStyles,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );
});

test('Mine header stays above the profile card and role artwork', () => {
  assert.match(
    mineStyles,
    /\.mine-header\s*\{[\s\S]*?z-index:\s*5/
  );
  assert.match(
    mineStyles,
    /\.profile-card\s*\{[\s\S]*?z-index:\s*2/
  );
  assert.match(
    mineStyles,
    /\.mine-role-scene\s*\{[\s\S]*?z-index:\s*3/
  );
});

test('Mine profile card follows the safe header in normal flow', () => {
  const profileCardBlock = mineStyles.match(/\.profile-card\s*\{([\s\S]*?)\}/);

  assert.ok(profileCardBlock, 'profile-card rule should exist');
  assert.match(
    profileCardBlock[1],
    /position:\s*relative[\s\S]*?margin-top:\s*28rpx/
  );
  assert.match(
    mineStyles,
    /\.user-profile-hero\s*\{[\s\S]*?height:\s*400rpx/
  );
});
