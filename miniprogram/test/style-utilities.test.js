const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appLess = fs.readFileSync(path.join(root, 'app.less'), 'utf8');
const utilitiesLess = fs.readFileSync(
  path.join(root, 'styles', 'utilities.less'),
  'utf8'
);

test('global app style imports the shared Less utility layer', () => {
  assert.match(appLess, /@import ["']\.\/styles\/utilities\.less["'];/);
  assert.match(utilitiesLess, /\.flex-row\s*\{/);
  assert.match(utilitiesLess, /\.flex-1\s*\{[^}]*min-width:\s*0/);
  assert.match(utilitiesLess, /\.justify-between\s*\{/);
  assert.match(utilitiesLess, /\.gap-8\s*\{/);
});

test('disabled primary actions keep a mint fill distinct from the page', () => {
  assert.match(appLess, /--action-disabled-bg:\s*#A9D9B8/);
  assert.match(
    appLess,
    /\.sfp-primary-action\[disabled\][\s\S]*--action-disabled-bg/
  );
  assert.match(
    utilitiesLess,
    /\.btn-primary\[disabled\][\s\S]*--action-disabled-bg/
  );
});

test('all Mini Program style sources use Less', () => {
  const legacyStyleFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.name.endsWith('.wxss')) legacyStyleFiles.push(entryPath);
    }
  };
  visit(root);
  assert.deepEqual(legacyStyleFiles, []);
});
