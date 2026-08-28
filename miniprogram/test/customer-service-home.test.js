const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  rankCustomerProjects,
  buildCompanionState,
  buildProgressPills,
  resolveBookShortcut,
  resolveBenefitStatusLabel,
} = require('../utils/customerServiceHome');

const root = path.join(__dirname, '..');
const componentRoot = path.join(root, 'components', 'customer-service-home');

test('ranks expired before measurer_assigned', () => {
  const ranked = rankCustomerProjects([
    { leadId: 'a', serviceStage: 'measurer_assigned' },
    { leadId: 'b', serviceStage: 'appointment_expired' },
  ]);
  assert.equal(ranked[0].leadId, 'b');
});

test('companion subtitle uses appointmentSummary once and inset title does not repeat it', () => {
  const state = buildCompanionState({
    projects: [{
      leadId: '1',
      serviceStage: 'measurer_assigned',
      serviceStageLabel: '已匹配家装现场顾问',
      appointmentSummary: '已匹配家装设计顾问和家装现场顾问，请预约上门量房时间',
      nextActionKind: 'book',
      nextActionLabel: '预约上门',
    }],
  });
  assert.equal(state.subtitle, '已匹配家装设计顾问和家装现场顾问，请预约上门量房时间');
  assert.equal(state.insetTitle, '待预约上门量房');
  assert.notEqual(state.insetHelper, state.subtitle);
  assert.equal(state.primaryCta.label, '预约上门');
  assert.equal(state.secondaryCta.label, '我的服务档案');
  assert.equal(state.showSecondaryCta, true);
});

test('confirmed appointment inset title shows current survey step not reschedule CTA', () => {
  const state = buildCompanionState({
    projects: [{
      leadId: '1',
      serviceStage: 'appointment_confirmed',
      appointmentSummary: '8月21日 09:00 上门量房',
      nextActionKind: 'reschedule',
      nextActionLabel: '改期',
    }],
  });
  assert.equal(state.insetTitle, '已预约上门量房');
  assert.equal(state.primaryCta.label, '改期');
  assert.equal(state.showSecondaryCta, true);
  const pills = buildProgressPills('appointment_confirmed');
  assert.equal(pills.find((p) => p.key === 'survey').tone, 'current');
});

test('published unsurveyed home keeps one hero archive CTA and routes makeup through the book shortcut', () => {
  const state = buildCompanionState({
    projects: [{
      leadId: '1',
      serviceStage: 'design_published',
      appointmentSummary: '方案已发布，可在服务档案查看',
      nextActionKind: 'view_project',
      nextActionLabel: '我的服务档案',
      canRebook: true,
      appointmentStatus: '',
      publishedDesignCount: 1,
    }],
  });
  assert.equal(state.primaryCta.label, '我的服务档案');
  assert.equal(state.showSecondaryCta, false);
  assert.equal(state.bookShortcutKind, 'book');
  assert.equal(state.bookShortcutDesc, '预约上门');
  assert.deepEqual(resolveBookShortcut({
    nextActionKind: 'view_project',
    canRebook: true,
    appointmentStatus: 'expired',
  }), { kind: 'rebook', desc: '重新预约' });
  assert.deepEqual(resolveBookShortcut({
    nextActionKind: 'view_project',
    canReschedule: true,
  }), { kind: 'reschedule', desc: '改期' });

  const wxml = fs.readFileSync(path.join(componentRoot, 'customer-service-home.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(componentRoot, 'customer-service-home.js'), 'utf8');
  assert.match(wxml, /class="ticket-cta primary/);
  assert.match(wxml, /wx:if="\{\{showSecondaryCta\}\}"/);
  assert.match(wxml, /benefit-service-card onsite-advisor-card/);
  assert.match(wxml, /bindtap="openBookShortcut"/);
  assert.match(js, /const kind = this\.data\.bookShortcutKind \|\| this\.data\.nextActionKind;/);
  assert.match(js, /kind === 'book' \|\| kind === 'rebook'/);
});

test('hides secondary archive CTA when primary already opens archive', () => {
  const state = buildCompanionState({
    projects: [{
      leadId: '1',
      serviceStage: 'survey_completed',
      appointmentSummary: '量房完成',
      nextActionKind: 'view_project',
      nextActionLabel: '我的服务档案',
      hasFormalFloorPlan: true,
    }],
  });
  assert.equal(state.showSecondaryCta, false);
  assert.equal(state.primaryCta.label, '我的服务档案');
});

test('three-benefit status copy follows the real service stage', () => {
  assert.equal(resolveBenefitStatusLabel('design_published'), '方案已交付');
  assert.equal(resolveBenefitStatusLabel('survey_completed'), '量房已完成');
  assert.equal(resolveBenefitStatusLabel('appointment_confirmed'), '已预约上门');
  assert.equal(resolveBenefitStatusLabel('appointment_expired'), '等待重新预约');
  assert.equal(resolveBenefitStatusLabel('claimed'), '服务进行中');
  assert.equal(resolveBenefitStatusLabel('closed'), '服务已结束');

  const state = buildCompanionState({
    projects: [{
      leadId: '1',
      serviceStage: 'design_published',
      appointmentSummary: '方案已发布，可在服务档案查看',
      nextActionKind: 'view_project',
    }],
  });
  assert.equal(state.insetTitle, '方案已发布');
  assert.equal(state.benefitStatusLabel, '方案已交付');
});

test('switcherCount is length - 1 and hidden for single project', () => {
  const one = buildCompanionState({ projects: [{ leadId: '1', serviceStage: 'claimed', appointmentSummary: '等待派单', nextActionKind: 'wait_designer', nextActionLabel: '等待派单' }] });
  const two = buildCompanionState({
    projects: [
      { leadId: '1', serviceStage: 'measurer_assigned', appointmentSummary: '请预约', nextActionKind: 'book', nextActionLabel: '预约上门' },
      { leadId: '2', serviceStage: 'claimed', appointmentSummary: '等待派单', nextActionKind: 'wait_designer', nextActionLabel: '等待派单' },
    ],
  });
  assert.equal(one.showSwitcher, false);
  assert.equal(one.switcherCount, 0);
  assert.equal(two.showSwitcher, true);
  assert.equal(two.switcherCount, 1);
});

test('progress pills mark matching stage current', () => {
  const pills = buildProgressPills('measurer_assigned');
  assert.deepEqual(pills.map((p) => p.key), ['match', 'book', 'survey', 'scheme']);
  assert.equal(pills.find((p) => p.key === 'match').tone, 'done');
  assert.equal(pills.find((p) => p.key === 'book').tone, 'current');
});

test('falls back to kind labels when nextActionLabel missing', () => {
  const book = buildCompanionState({
    projects: [{ leadId: '1', serviceStage: 'measurer_assigned', appointmentSummary: '请预约', nextActionKind: 'book' }],
  });
  assert.equal(book.primaryCta.label, '预约上门');
  assert.equal(book.insetTitle, '待预约上门量房');

  const wait = buildCompanionState({
    projects: [{ leadId: '2', serviceStage: 'claimed', appointmentSummary: '等待', nextActionKind: 'wait_designer' }],
  });
  assert.equal(wait.primaryCta.label, '等待派单');
  assert.equal(wait.insetTitle, '服务匹配中');
  assert.notEqual(wait.insetHelper, wait.primaryCta.label);
});

test('claimed insetHelper avoids repeating appointmentSummary subtitle', () => {
  const state = buildCompanionState({
    projects: [{
      leadId: '1',
      serviceStage: 'claimed',
      appointmentSummary: '等待派单',
      nextActionKind: 'wait_designer',
    }],
  });
  assert.equal(state.subtitle, '等待派单');
  assert.notEqual(state.insetHelper, state.subtitle);
  assert.notEqual(state.insetHelper, state.primaryCta.label);
});

test('pending match keeps 等待派单 only on the primary CTA', () => {
  const state = buildCompanionState({
    projects: [{
      leadId: '1',
      serviceStage: 'assignment_pending',
      appointmentSummary: '正在为您匹配家装设计顾问和家装现场顾问',
      nextActionKind: 'wait_designer',
      nextActionLabel: '等待派单',
    }],
  });
  assert.equal(state.primaryCta.label, '等待派单');
  assert.equal(state.insetTitle, '服务匹配中');
  assert.equal(state.insetHelper, '匹配完成后可预约上门');
  assert.notEqual(state.insetHelper, '等待派单');
});

test('customer-service-home component follows stage-companion contract', () => {
  const wxml = fs.readFileSync(path.join(componentRoot, 'customer-service-home.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(componentRoot, 'customer-service-home.js'), 'utf8');
  const less = fs.readFileSync(path.join(componentRoot, 'customer-service-home.less'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(componentRoot, 'customer-service-home.json'), 'utf8'));

  assert.equal(json.component, true);
  assert.match(wxml, /家客来 · 服务向导/);
  assert.match(wxml, /专业服务/);
  assert.match(wxml, /三项免费权益/);
  assert.match(wxml, /我是小K/);
  assert.match(wxml, /点击我带你看看/);
  assert.match(wxml, /bindtap="openCustomerGuide"/);
  assert.match(wxml, /class="guide-inline-entry"/);
  assert.match(less, /@media \(max-width: 400px\)[\s\S]*?\.guide-entry-bubble\s*\{[\s\S]*?display:\s*none;/);
  assert.match(less, /@media \(max-width: 400px\)[\s\S]*?\.guide-inline-entry\s*\{[\s\S]*?display:\s*inline-flex;/);
  assert.match(wxml, /三个免费，装修更省心/);
  assert.match(wxml, /免费效果图/);
  assert.match(wxml, /免费家装设计顾问/);
  assert.match(wxml, /免费家装现场顾问/);
  assert.match(wxml, /出到客户满意为止/);
  assert.match(wxml, /解答你的装修问题/);
  assert.match(wxml, /解答现场问题/);
  assert.match(wxml, /三项服务不收费/);
  assert.match(wxml, /ticket-main-row/);
  assert.match(wxml, /class="ticket-copy"/);
  assert.match(wxml, /ticket-actions \{\{showSecondaryCta \? 'dual' : 'single'\}\}/);
  assert.match(less, /\.ticket-main-row\.no-media \.ticket-status\s*\{[\s\S]*display: grid;[\s\S]*grid-template-columns:/);
  assert.match(wxml, /benefit-service-card effect-card/);
  assert.match(wxml, /benefit-service-card design-advisor-card/);
  assert.match(wxml, /benefit-service-card onsite-advisor-card/);
  assert.match(wxml, /class="benefit-arrow"/);
  assert.match(wxml, /class="benefit-arrow-icon" src="\/images\/customer-service-three-free\/chevron-right\.png"/);
  assert.match(less, /\.benefit-arrow\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/);
  assert.match(less, /\.benefit-arrow-icon\s*\{[\s\S]*?width:\s*44rpx;[\s\S]*?height:\s*44rpx;/);
  assert.doesNotMatch(wxml, /benefit-arrow-mark/);
  assert.doesNotMatch(less, /\.benefit-arrow-mark|\.benefit-arrow::after|translate\(-62%/);
  assert.match(wxml, /bindtap="openEffectShortcut"/);
  assert.match(wxml, /我的服务档案/);
  assert.match(wxml, /还有/);
  assert.doesNotMatch(wxml, /查看全部项目/);
  assert.doesNotMatch(wxml, />我的服务</);

  assert.match(js, /\/images\/customer-service-three-free\/xiao-k-three-benefits\.png/);
  assert.match(wxml, /\/images\/customer-service-three-free\/effect-room\.jpg/);
  assert.match(wxml, /\/images\/customer-service-three-free\/design-advisor-3d\.png/);
  assert.match(wxml, /\/images\/customer-service-three-free\/onsite-advisor-3d\.png/);
  assert.doesNotMatch(wxml, /ai-design-icons\/reference\.png|mine-icons\/bulb\.png|location-pin\.png/);
  assert.doesNotMatch(`${js}\n${wxml}`, /\/packages\/business\/assets\//);
  assert.match(js, /openEffectShortcut\(\)/);
  assert.match(js, /openAiSchemes\(\)/);
  assert.match(js, /customer-ai-schemes\/customer-ai-schemes\?leadId=/);
  assert.match(js, /mode=customer/);
  assert.doesNotMatch(js, /xiao-k-mascot-3d\.png/);
  assert.doesNotMatch(wxml, /两项服务，全程免费|免费量房|benefit-service-card measurement-card/);
  assert.match(js, /['"`]\/miniprogram\/customer-projects['"`]/);
  assert.match(js, /\/miniprogram\/customer-projects\/\$\{(?:encodeURIComponent\()?featuredLeadId/);
  assert.match(js, /customer-project\?leadId=/);
  assert.doesNotMatch(js, /customer-projects\/customer-projects/);
  assert.match(js, /appointmentId=\$\{(?:encodeURIComponent\()?appointmentId/);
  assert.match(js, /appointment-detail\/appointment-detail\?mode=customer/);
  assert.doesNotMatch(js, /appointment-reschedule\/appointment-reschedule\?leadId=/);
  assert.match(js, /wx\.scanCode/);
  assert.match(wxml, /bindtap="openScan"/);
  assert.match(wxml, /mine-icons\/scan\.png/);
  assert.doesNotMatch(wxml, /class="bell-btn"/);
  assert.doesNotMatch(wxml, /mine-icons\/bell\.png/);
  assert.doesNotMatch(wxml, /bindtap="openBell"/);
  assert.doesNotMatch(js, /openBell\(/);
  assert.doesNotMatch(js, /switchTab\(\{\s*url:\s*'\/pages\/mine\/mine'/);
  assert.match(js, /free-design-service\/free-design-service/);
  assert.match(js, /onboarding\/onboarding/);
  assert.match(js, /customer-guide\/customer-guide/);
  assert.doesNotMatch(js, /staff-activity-code\/staff-activity-code/);
  assert.match(js, /pageLifetimes:\s*\{[\s\S]*show\(\)\s*\{[\s\S]*this\.load\(/);
  assert.match(js, /attached\(\)\s*\{[\s\S]*?hasSignedSession\(\)/);
  assert.match(js, /guestCompanionUi\(\)/);
  const attachedBody = js.match(/attached\(\)\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(attachedBody, 'expected attached lifetime body');
  assert.doesNotMatch(attachedBody[1], /this\.load\(/);
  assert.match(js, /softRefresh/);
  assert.match(js, /forceLoading:\s*true/);
  assert.match(js, /designerShortcutDescription/);
  assert.match(js, /hasDesignerContact/);
  assert.match(js, /showContactSheet/);
  assert.match(js, /designer-contact-sheet|closeContactSheet/);
  assert.match(wxml, /designer-contact-sheet/);
  assert.match(json.usingComponents['designer-contact-sheet'], /designer-contact-sheet/);
});

test('customer guide is a manual four-step customer-service tour with packaged transparent artwork', () => {
  const guideRoot = path.join(root, 'packages', 'guides', 'customer-guide');
  const wxml = fs.readFileSync(path.join(guideRoot, 'customer-guide.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(guideRoot, 'customer-guide.js'), 'utf8');
  const less = fs.readFileSync(path.join(guideRoot, 'customer-guide.less'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(guideRoot, 'customer-guide.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const guides = app.subPackages.find((entry) => entry.root === 'packages/guides');

  assert.equal(config.navigationStyle, 'custom');
  assert.ok(guides.pages.includes('customer-guide/customer-guide'));
  assert.match(wxml, /装修服务向导/);
  assert.match(js, /三个免费，装修更省心/);
  assert.match(wxml, /开始我的装修服务/);
  assert.match(wxml, /autoplay="\{\{false\}\}"/);
  assert.match(wxml, /circular="\{\{false\}\}"/);
  assert.match(js, /totalSteps: CUSTOMER_GUIDE_SLIDES\.length/);
  assert.match(js, /\[0, 1, 2, 3\]/);
  assert.match(js, /navigateBack/);
  assert.match(js, /switchTab\(\{ url: '\/pages\/index\/index' \}\)/);
  assert.doesNotMatch(js, /markRoleGuideSeen|hasSeenRoleGuide|automatic/);
  assert.doesNotMatch(less, /height:\s*100%|min-height:\s*100vh|flex-grow:\s*1|flex:\s*1/);

  for (const name of ['three-free-benefits.png', 'home-archive.png', 'service-route.png', 'service-archive.png']) {
    const bytes = fs.readFileSync(path.join(root, 'packages', 'guides', 'assets', 'customer-v1', name));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length <= 300 * 1024, `${name} must stay within the 300KB Mini Program budget`);
    assert.ok(bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]), `${name} must retain transparency`);
  }
});

test('unsigned Service home renders the empty companion without calling customer-projects', async () => {
  const originals = {
    Component: global.Component,
    getApp: global.getApp,
    wx: global.wx,
  };
  let definition;
  global.Component = (config) => { definition = config; };
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    getStorageSync: () => '',
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
    getSystemInfoSync: () => ({ windowWidth: 390, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 48, height: 32 }),
  };

  const api = require('../utils/api.js');
  const originalRequest = api.request;
  let requestCalls = 0;
  api.request = async () => {
    requestCalls += 1;
    throw new Error('guest home must not call customer-projects');
  };

  const componentPath = require.resolve('../components/customer-service-home/customer-service-home.js');
  delete require.cache[componentPath];
  require(componentPath);

  try {
    const page = {
      data: { ...definition.data },
      setData(update) {
        Object.assign(this.data, update);
      },
    };
    definition.lifetimes.attached.call(page);
    await definition.methods.load.call(page);
    assert.equal(requestCalls, 0);
    assert.equal(page.data.loading, false);
    assert.equal(page.data.isEmpty, true);
    assert.equal(page.data.error, '');
    assert.equal(page.data.primaryCta.kind, 'scan_claim');
    assert.equal(page.data.insetTitle, '扫码领取免费设计服务');
  } finally {
    api.request = originalRequest;
    delete require.cache[componentPath];
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});

test('customer-service-home three-free artwork is packaged in the main package', () => {
  const assetRoot = path.join(root, 'images', 'customer-service-three-free');
  const pngAssetNames = [
    'xiao-k-three-benefits.png',
    'design-advisor-3d.png',
    'onsite-advisor-3d.png',
    'chevron-right.png',
  ];

  for (const assetName of pngAssetNames) {
    const assetPath = path.join(assetRoot, assetName);
    const bytes = fs.readFileSync(assetPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length <= 300 * 1024, `${assetName} must stay within the 300KB Mini Program budget`);
  }

  const chevronBytes = fs.readFileSync(path.join(assetRoot, 'chevron-right.png'));
  assert.equal(chevronBytes[25], 6, 'chevron-right.png must be RGBA so it can sit on the green circle');

  const jpegName = 'effect-room.jpg';
  const jpegBytes = fs.readFileSync(path.join(assetRoot, jpegName));
  assert.deepEqual([...jpegBytes.subarray(0, 3)], [255, 216, 255]);
  assert.ok(jpegBytes.length <= 300 * 1024, `${jpegName} must stay within the 300KB Mini Program budget`);
});

test('customer-projects list route is a redirect shell for deep links only', () => {
  const page = fs.readFileSync(
    path.join(root, 'packages', 'business', 'customer-projects', 'customer-projects.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.join(root, 'packages', 'business', 'customer-projects', 'customer-projects.wxml'),
    'utf8'
  );
  assert.match(page, /rankCustomerProjects/);
  assert.match(page, /['"`]\/miniprogram\/customer-projects['"`]/);
  assert.match(page, /wx\.redirectTo/);
  assert.match(page, /customer-project\/customer-project\?leadId=/);
  assert.match(page, /wx\.switchTab\(\{\s*url:\s*['"]\/pages\/index\/index['"]/);
  assert.doesNotMatch(wxml, /project-list|project-card|我的项目|查看全部项目/);
});
