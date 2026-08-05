const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectConfigPath = path.join(__dirname, '..', 'project.config.json');

test('source package excludes development-only directories', () => {
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  const ignoredDirectories = new Set(
    projectConfig.packOptions.ignore
      .filter((rule) => rule.type === 'folder')
      .map((rule) => rule.value)
  );

  assert.deepEqual(
    ignoredDirectories,
    new Set(['test', 'dev-log', '.impeccable'])
  );
});

test('source package keeps the Mini Program runtime directories', () => {
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  const ignoredDirectories = new Set(
    projectConfig.packOptions.ignore
      .filter((rule) => rule.type === 'folder')
      .map((rule) => rule.value)
  );

  for (const runtimeDirectory of ['pages', 'images', 'utils', 'miniprogram_npm']) {
    assert.equal(ignoredDirectories.has(runtimeDirectory), false);
  }
});
