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

test('runtime artwork excludes WebP and keeps the AI project folio as PNG', () => {
  const root = path.join(__dirname, '..');
  const runtimeFiles = fs.readdirSync(root, { recursive: true });
  const webpFiles = runtimeFiles.filter((file) => /\.webp$/i.test(file));
  assert.deepEqual(webpFiles, []);

  const folio = fs.readFileSync(path.join(root, 'images', 'ai-design-project-folio-cover-v1.png'));
  assert.equal(folio.subarray(1, 4).toString(), 'PNG');
  assert.ok(folio.length <= 300 * 1024, 'AI project folio exceeds the generated-artwork budget');
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
        'recipe-detail/recipe-detail',
        'recipe-project/recipe-project',
        'recipe-confirm/recipe-confirm',
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
        'promotion-service-code/promotion-service-code',
        'staff-activity-code/staff-activity-code',
        'free-design-service/free-design-service',
        'onboarding/onboarding',
        'onboarding-debug/onboarding-debug',
        'referrer-workbench/referrer-workbench',
        'referrer-progress/referrer-progress',
        'referrer-earnings/referrer-earnings',
        'customer-projects/customer-projects',
        'customer-project/customer-project',
        'appointment-detail/appointment-detail',
        'appointment-reschedule/appointment-reschedule',
        'appointment-booking/appointment-booking',
        'measurer-calendar/measurer-calendar',
        'enterprise-appointments/enterprise-appointments',
        'measurer-unavailability/measurer-unavailability',
        'inspiration/inspiration',
        'recommendations/index',
        'profile-edit/profile-edit',
        'settings/settings',
        'identity-switch/identity-switch',
        'identity-recovery/identity-recovery',
        'account-security/account-security',
      ],
    },
  ]);
  assert.equal(appConfig.preloadRule, undefined);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'miniprogram_npm')), false);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'packages/surveying/vendor/threejs-miniprogram.js')));

  for (const packageName of ['surveying', 'ai-workflow', 'business']) {
    const packageRoot = path.join(__dirname, '..', 'packages', packageName);
    const sourceFiles = fs.readdirSync(packageRoot, { recursive: true })
      .filter((file) => /\.(js|json|wxml|less)$/.test(file));

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
    'images/ai-design-hero-v3.png',
    'images/ai-design-project-hero-v4.jpg',
    'images/ai-design-project-hero-v5.jpg',
    'images/home-ip-v1/hero-scene-wechat-safe.png',
    'images/home-v5/notification.png',
    'images/mine-icons/log-out.png',
    'images/mine-icons/tab-bulb.png',
    'images/mine-icons/tab-bulb-active.png',
    'images/mine-icons/tab-measure.png',
    'images/mine-icons/tab-measure-active.png',
    'images/mine-icons/todo-blue.png',
    'images/mine-icons/todo-green.png',
    'images/mine-icons/todo-orange.png',
    'images/mine-v6/tab-create.png',
    'images/page-ip-v3/ai-home.png',
    'packages/ai-workflow/assets/result-icons/share-white.png',
    'packages/surveying/assets/surveying-guide-k-left.png',
    'packages/surveying/assets/surveying-guide-k-right.png',
    'packages/surveying/assets/surveying-guide-k-down.png',
    'packages/surveying/assets/icons/cursor-compass.png',
    'packages/surveying/assets/icons/topbar-assistant.png',
    'packages/surveying/assets/icons/topbar-save.png',
    'packages/surveying/assets/icons/editor-rail/diagonal.png',
    'packages/surveying/assets/icons/editor-rail/diagonal-active.png',
    'packages/surveying/assets/icons/editor-rail/input.png',
    'packages/surveying/assets/icons/editor-rail/straight.png',
    'packages/surveying/assets/icons/editor-rail/straight-active.png',
    'packages/surveying/assets/icons/editor-rail/thickness.png',
    'packages/surveying/assets/icons/editor-rail/zoom.png',
    'packages/surveying/assets/icons/wall-toolbar/preview.png',
    'packages/surveying/assets/icons/wall-toolbar/reset.png',
    'packages/surveying/assets/icons/wall-toolbar/side.png',
    'packages/surveying/assets/icons/wall-toolbar/thickness.png',
  ];

  for (const asset of removedAssets) {
    assert.equal(fs.existsSync(path.join(root, asset)), false, `${asset} must remain out of the source package`);
  }
});
