const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  rankCustomerProjects,
  buildCompanionState,
  buildProgressPills,
  resolveBookShortcut,
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
      serviceStageLabel: '已匹配测量员',
      appointmentSummary: '已匹配设计师和测量员，请预约上门量房时间',
      nextActionKind: 'book',
      nextActionLabel: '预约上门',
    }],
  });
  assert.equal(state.subtitle, '已匹配设计师和测量员，请预约上门量房时间');
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
  assert.match(wxml, /class="hero-cta primary/);
  assert.match(wxml, /wx:if="\{\{showSecondaryCta\}\}"/);
  assert.match(wxml, /shortcut-desc">\{\{bookShortcutDesc/);
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
      appointmentSummary: '正在为您匹配设计师和测量员',
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
  const json = JSON.parse(fs.readFileSync(path.join(componentRoot, 'customer-service-home.json'), 'utf8'));

  assert.equal(json.component, true);
  assert.match(wxml, /家客来 · 服务向导/);
  assert.match(wxml, /专业服务/);
  assert.match(wxml, /我的装修服务/);
  assert.match(wxml, /我的服务档案/);
  assert.match(wxml, /还有/);
  assert.match(wxml, /预约量房/);
  assert.match(wxml, /专属设计师/);
  assert.doesNotMatch(wxml, /查看全部项目/);
  assert.doesNotMatch(wxml, />我的服务</);

  assert.match(js, /\/images\/airy-v1\/project-delivery-xiao-k\.png/);
  assert.doesNotMatch(js, /xiao-k-mascot-3d\.png/);
  assert.doesNotMatch(js, /packages\/business\/assets\/customer-project-v1\/project-delivery-xiao-k\.png/);
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
  assert.doesNotMatch(js, /staff-activity-code\/staff-activity-code/);
  assert.match(js, /pageLifetimes:\s*\{[\s\S]*show\(\)\s*\{[\s\S]*this\.load\(/);
  assert.match(js, /attached\(\)\s*\{[\s\S]*?setData\(navigationMetrics\(\)\)/);
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
