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
