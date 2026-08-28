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
    new Set(['test', 'dev-log', '.impeccable', 'scripts', 'node_modules'])
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

test('source package ignores only development files after unused artwork was deleted', () => {
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  const ignoredFiles = new Set(
    projectConfig.packOptions.ignore
      .filter((rule) => rule.type === 'file')
      .map((rule) => rule.value)
  );

  assert.deepEqual(ignoredFiles, new Set([
    'tmp-lshape-preview.js',
    'tmp-preview-check.js',
    'DESIGN.md',
    'design-tokens.json',
  ]));
});

test('business subpackage source stays under the WeChat 2MB subpackage limit', () => {
  const miniRoot = path.join(__dirname, '..');
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  const ignoredFiles = new Set(
    projectConfig.packOptions.ignore
      .filter((rule) => rule.type === 'file')
      .map((rule) => rule.value.replace(/\\/g, '/'))
  );
  const businessRoot = path.join(miniRoot, 'packages', 'business');
  let total = 0;
  for (const file of fs.readdirSync(businessRoot, { recursive: true })) {
    const absolute = path.join(businessRoot, file);
    if (!fs.statSync(absolute).isFile()) continue;
    const packagedPath = path.posix.join('packages/business', file.replace(/\\/g, '/'));
    if (ignoredFiles.has(packagedPath)) continue;
    total += fs.statSync(absolute).size;
  }
  assert.ok(
    total <= 2048 * 1024,
    `packages/business source size ${Math.ceil(total / 1024)}KB exceeds the 2048KB subpackage limit`
  );
});

test('role guides stay in their own subpackage and under the WeChat 2MB limit', () => {
  const miniRoot = path.join(__dirname, '..');
  const guidesRoot = path.join(miniRoot, 'packages', 'guides');
  let total = 0;
  for (const file of fs.readdirSync(guidesRoot, { recursive: true })) {
    const absolute = path.join(guidesRoot, file);
    if (fs.statSync(absolute).isFile()) total += fs.statSync(absolute).size;
  }
  assert.ok(
    total <= 2048 * 1024,
    `packages/guides source size ${Math.ceil(total / 1024)}KB exceeds the 2048KB subpackage limit`
  );
  assert.equal(fs.existsSync(path.join(miniRoot, 'images', 'role-guides')), false);
});

test('platform subpackage source stays under the WeChat 2MB subpackage limit', () => {
  const miniRoot = path.join(__dirname, '..');
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
  const platform = appConfig.subPackages.find((item) => item.root === 'packages/platform');
  assert.ok(platform);
  assert.equal(platform.independent, undefined);
  assert.deepEqual(platform.pages, [
    'devices/devices',
    'enterprise-review/enterprise-review',
    'enterprise-review-detail/enterprise-review-detail',
    'registration-code/registration-code',
  ]);

  const platformRoot = path.join(miniRoot, 'packages', 'platform');
  let total = 0;
  for (const file of fs.readdirSync(platformRoot, { recursive: true })) {
    const absolute = path.join(platformRoot, file);
    if (fs.statSync(absolute).isFile()) total += fs.statSync(absolute).size;
  }
  assert.ok(
    total <= 2048 * 1024,
    `packages/platform source size ${Math.ceil(total / 1024)}KB exceeds the 2048KB subpackage limit`
  );
});

test('main package source stays under the WeChat 2MB main-package limit', () => {
  const miniRoot = path.join(__dirname, '..');
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  const ignoredFiles = new Set(
    projectConfig.packOptions.ignore
      .filter((rule) => rule.type === 'file')
      .map((rule) => rule.value.replace(/\\/g, '/'))
  );
  const ignoredFolders = new Set(
    projectConfig.packOptions.ignore
      .filter((rule) => rule.type === 'folder')
      .map((rule) => rule.value.replace(/\\/g, '/'))
  );
  ignoredFolders.add('node_modules');
  ignoredFolders.add('packages');
  ignoredFolders.add('scripts');
  ignoredFolders.add('.cloudbase');

  let total = 0;
  for (const file of fs.readdirSync(miniRoot, { recursive: true })) {
    const absolute = path.join(miniRoot, file);
    if (!fs.statSync(absolute).isFile()) continue;
    const packagedPath = file.replace(/\\/g, '/');
    const top = packagedPath.split('/')[0];
    if (ignoredFolders.has(top)) continue;
    if (ignoredFiles.has(packagedPath)) continue;
    total += fs.statSync(absolute).size;
  }
  assert.ok(
    total <= 2048 * 1024,
    `main package source size ${Math.ceil(total / 1024)}KB exceeds the 2048KB main-package limit`
  );
  assert.equal(
    fs.existsSync(path.join(miniRoot, 'images', 'identity-switch')),
    false,
    'subpackage-only identity artwork must not return to the main package'
  );
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
    'pages/enterprise-operations/enterprise-operations',
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
        'scheme-studio/scheme-studio',
      ],
    },
    {
      root: 'packages/guides',
      pages: ['referrer-guide/referrer-guide', 'enterprise-owner-guide/enterprise-owner-guide', 'designer-guide/designer-guide', 'measurer-guide/measurer-guide', 'customer-guide/customer-guide'],
    },
    {
      root: 'packages/platform',
      pages: [
        'devices/devices',
        'enterprise-review/enterprise-review',
        'enterprise-review-detail/enterprise-review-detail',
        'registration-code/registration-code',
      ],
    },
    {
      root: 'packages/business',
      pages: [
        'login/login',
        'legal-webview/legal-webview',
        'lead-form/lead-form',
        'lead-detail/lead-detail',
        'lead-claim-pool/lead-claim-pool',
        'promotion-records/promotion-records',
        'promotion-record-detail/promotion-record-detail',
        'commission-records/commission-records',
        'promotion-service-code/promotion-service-code',
        'staff-activity-code/staff-activity-code',
        'enterprise-join-codes/enterprise-join-codes',
        'enterprise-staff/enterprise-staff',
        'enterprise-referrers/enterprise-referrers',
        'free-design-service/free-design-service',
        'service-needs/service-needs',
        'onboarding/onboarding',
        'enterprise-register/enterprise-register',
        'onboarding-debug/onboarding-debug',
        'referrer-workbench/referrer-workbench',
        'referrer-progress/referrer-progress',
        'referrer-earnings/referrer-earnings',
        'staff-earnings/staff-earnings',
        'customer-projects/customer-projects',
        'customer-project/customer-project',
        'customer-ai-schemes/customer-ai-schemes',
        'appointment-detail/appointment-detail',
        'appointment-reschedule/appointment-reschedule',
        'appointment-booking/appointment-booking',
        'measurer-calendar/measurer-calendar',
        'enterprise-appointments/enterprise-appointments',
        'enterprise-commissions/enterprise-commissions',
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

  for (const packageName of ['surveying', 'ai-workflow', 'business', 'platform']) {
    const packageRoot = path.join(__dirname, '..', 'packages', packageName);
    const sourceFiles = fs.readdirSync(packageRoot, { recursive: true })
      .filter((file) => /\.(js|json|wxml|less)$/.test(file));

    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(path.join(packageRoot, sourceFile), 'utf8');
      for (const otherPackage of ['surveying', 'ai-workflow', 'business', 'platform']) {
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
    'images/ai-design-empty-v2/step-ai.png',
    'images/ai-design-empty-v2/step-customer.png',
    'images/ai-design-empty-v2/step-survey.png',
    'images/ai-design-empty-v2/stage-art.jpg',
    'images/ai-design-preparation-art-v1.jpg',
    'images/ai-design-switch-arrows-v1.png',
    'images/airy-v1/recipe-minimal-living.png',
    'images/airy-v1/recipe-wood-cream.png',
    'images/airy-v1/xiao-k-mascot-3d.png',
    'images/home-v5/ai-wand.jpg',
    'images/home-v5/bluetooth-mark.jpg',
    'images/home-v5/laser-device.jpg',
    'images/home-v5/lead-avatars.jpg',
    'images/home-v5/leads-icon.jpg',
    'images/home-v5/location.png',
    'images/home-v5/plan-preview.jpg',
    'images/home-v5/ai-preview.jpg',
    'images/leads-v4/plus-white.png',
    'images/mine-icons/book-a-active.png',
    'images/mine-icons/camera.png',
    'images/mine-icons/message-square.png',
    'images/mine-icons/receipt-text.png',
    'images/operations-dashboard/activity-code-share.png',
    'images/operations-dashboard/referrer-roster.png',
    'images/operations-dashboard/lead-inbox.png',
    'images/operations-dashboard/staff-onboarding.png',
    'images/operations-dashboard/scheme-delivery-rate.png',
    'images/operations-dashboard/signing-rate.png',
    'images/operations-dashboard/floor-route-board.png',
    'images/ai-recipe/recipe-atelier-hero.jpg',
    'images/ai-design-stage-active-glow-v1.png',
    'images/generated-hero-bleed-v2.png',
    'images/login-hero.png',
    'images/home-ip-v1/measure-k.png',
    'packages/business/assets/code-presenter-v2/onsite-measurement.png',
    'packages/business/assets/code-presenter-v2/advisor-match.png',
    'packages/business/assets/code-presenter-v2/free-service.png',
    'packages/business/assets/code-presenter-v2/join-identity.png',
    'packages/business/assets/code-presenter-v2/service-start.png',
    'packages/business/assets/code-presenter-v2/xiao-k-scan-guide.png',
    'packages/business/assets/referral-service-v1/phone-auth-calendar.png',
    'packages/business/assets/referral-service-v1/phone-auth-design.png',
    'packages/business/assets/referral-service-v1/phone-auth-measure.png',
    'packages/business/assets/referral-service-v1/phone-auth-wechat.png',
    'packages/business/assets/referral-service-v1/xiao-k-existing-service.png',
    'packages/business/assets/referral-service-v1/privacy-lock.png',
    'packages/business/assets/referral-service-v1/xiao-k-phone-privacy.png',
    'packages/business/assets/referral-service-v1/xiao-k-onboarding-welcome.png',
    'packages/business/assets/customer-project-v1/published-design-folio.png',
    'packages/business/assets/customer-project-v1/formal-floor-plan-archive.png',
  ];

  for (const asset of removedAssets) {
    assert.equal(fs.existsSync(path.join(root, asset)), false, `${asset} must remain out of the source package`);
  }
});
