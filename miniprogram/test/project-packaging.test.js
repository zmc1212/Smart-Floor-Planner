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

  for (const runtimeDirectory of ['pages', 'images', 'utils', 'packages']) {
    assert.equal(ignoredDirectories.has(runtimeDirectory), false);
  }
});

test('main package contains only primary tabs and low-frequency flows are split by domain', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));

  assert.deepEqual(appConfig.pages, [
    'pages/index/index',
    'pages/ai-design/ai-design',
    'pages/mine/mine',
    'pages/leads-management/leads-management',
  ]);
  assert.deepEqual(appConfig.subPackages, [
    { root: 'packages/surveying', pages: ['editor/surveying-editor'] },
    {
      root: 'packages/ai-workflow',
      pages: [
        'legacy/ai-gen',
        'create/ai-design-create',
        'result/ai-design-result',
        'history/ai-design-history',
      ],
    },
    {
      root: 'packages/business',
      pages: [
        'login/login',
        'lead-form/lead-form',
        'lead-detail/lead-detail',
        'promotion-records/promotion-records',
        'promotion-record-detail/promotion-record-detail',
        'commission-records/commission-records',
        'acquisition-center/acquisition-center',
        'inspiration/inspiration',
        'recommendations/index',
      ],
    },
  ]);
  assert.equal(appConfig.preloadRule, undefined);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'miniprogram_npm')), false);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'packages/surveying/vendor/threejs-miniprogram.js')));

  for (const packageName of ['surveying', 'ai-workflow', 'business']) {
    const packageRoot = path.join(__dirname, '..', 'packages', packageName);
    const sourceFiles = fs.readdirSync(packageRoot, { recursive: true })
      .filter((file) => /\.(js|json|wxml|wxss)$/.test(file));

    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(path.join(packageRoot, sourceFile), 'utf8');
      for (const otherPackage of ['surveying', 'ai-workflow', 'business']) {
        if (otherPackage !== packageName) {
          assert.doesNotMatch(source, new RegExp(`packages/${otherPackage}`));
        }
      }
    }
  }
});

test('removed legacy artwork cannot silently return to the source package', () => {
  const root = path.join(__dirname, '..');
  const removedAssets = [
    'images/mine-workbench-panel.png',
    'images/mockups/leads-hero.png',
    'images/leads-v4/summary-scene.png',
    'images/leads-v4/header-scene.png',
    'images/surveying-onboarding-k.png',
    'images/mine-profile-card.png',
    'images/surveying-guide-k.png',
    'images/ai-design-hero-v2.jpg',
    'images/home-v5/hero-scene.jpg',
    'images/home-v5/measure-orb.jpg',
    'images/home-ip-v1/hero-scene.jpg',
    'images/mine-todo-panel.png',
    'images/mine-actions-panel.png',
    'images/mine-icons/tab-plus.png',
    'images/idea0.png',
    'images/idea1.png',
  ];

  for (const asset of removedAssets) {
    assert.equal(fs.existsSync(path.join(root, asset)), false, `${asset} must remain out of the source package`);
  }
});
