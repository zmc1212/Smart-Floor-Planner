const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('customer service home shows one featured stage and a single next action', () => {
  const workbench = source('components/role-workbench/role-workbench.js');
  const template = source('components/role-workbench/role-workbench.wxml');
  assert.match(workbench, /featured\.nextActionKind/);
  assert.match(workbench, /nextActionKind === 'book'/);
  assert.match(workbench, /nextActionKind === 'reschedule'/);
  assert.match(workbench, /nextActionKind === 'rebook'/);
  assert.match(workbench, /appointment-detail\/appointment-detail\?leadId=/);
  assert.doesNotMatch(workbench, /appointment-reschedule\/appointment-reschedule\?leadId=\{/);
  assert.doesNotMatch(workbench, /appointment-detail\/appointment-detail\?mode=customer&leadId=\{/);
  assert.match(workbench, /还没有进行中的服务/);
  assert.match(template, /item\.canReschedule/);
  assert.match(template, /item\.actionLabel/);
  assert.match(template, /item-cta-secondary sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png[\s\S]*电话联系/);
  assert.match(template, /openNavigation[\s\S]*\/images\/leads-v4\/map-pin\.png[\s\S]*导航/);
  assert.match(template, /openSurvey[\s\S]*\/images\/leads-v4\/ruler-green\.png/);
  assert.match(template, /item\.canCompleteSurvey/);
  assert.match(template, /确认完成量房/);
  assert.match(template, /openReschedule[\s\S]*\/packages\/business\/assets\/promotion-detail\/calendar\.png/);
  assert.match(source('app.less'), /\.sfp-icon-action\s*\{[\s\S]*gap:\s*8rpx;/);
  assert.match(source('app.less'), /\.sfp-icon-action__icon\s*\{[\s\S]*width:\s*28rpx;[\s\S]*height:\s*28rpx;/);
  const workbenchStyles = source('components/role-workbench/role-workbench.less');
  assert.match(workbenchStyles, /\.item-cta\s*\{[\s\S]*gap:\s*8rpx;/);
  assert.match(workbenchStyles, /\.item-cta image\s*\{[\s\S]*width:\s*28rpx;[\s\S]*height:\s*28rpx;/);
  assert.doesNotMatch(workbench, /title: '免费设计与量房'/);
});

test('enterprise appointments remain a contextual route outside the AI design shell', () => {
  const tabBar = source('custom-tab-bar/index.js');
  const design = source('pages/ai-design/ai-design.js');
  assert.doesNotMatch(source('pages/ai-design/ai-design.wxml'), /enterprise_admin/);
  const appConfig = JSON.parse(source('app.json'));
  const business = appConfig.subPackages.find((item) => item.root === 'packages/business');
  const pageConfig = JSON.parse(source('packages/business/enterprise-appointments/enterprise-appointments.json'));
  const pageTemplate = source('packages/business/enterprise-appointments/enterprise-appointments.wxml');
  const pageScript = source('packages/business/enterprise-appointments/enterprise-appointments.js');
  const navigation = source('utils/identity-navigation.js');

  assert.doesNotMatch(tabBar, /key: 'appointments'[\s\S]*pagePath: '\/packages\/business\/enterprise-appointments\/enterprise-appointments'/);
  assert.match(source('components/role-workbench/role-workbench.js'), /target === 'appointments'/);
  assert.match(
    source('components/role-workbench/role-workbench.js'),
    /target === 'appointments'[\s\S]*wx\.navigateTo\(\{ url: '\/packages\/business\/enterprise-appointments\/enterprise-appointments' \}\)/
  );
  assert.doesNotMatch(
    source('components/role-workbench/role-workbench.js'),
    /wx\.reLaunch\(\{ url: '\/packages\/business\/enterprise-appointments\/enterprise-appointments' \}\)/
  );
  assert.match(design, /role === 'measurer'/);
  assert.doesNotMatch(design, /enterprise_admin/);
  assert.ok(business.pages.includes('enterprise-appointments/enterprise-appointments'));
  assert.equal(pageConfig.navigationStyle, 'custom');
  assert.equal(pageConfig.usingComponents, undefined);
  assert.match(pageTemplate, /预约调度中心/);
  assert.match(pageTemplate, /selectedAppointments/);
  assert.match(pageTemplate, /bindtap="onBack"/);
  assert.doesNotMatch(pageTemplate, /<custom-tab-bar\s*\/>/);
  assert.doesNotMatch(pageTemplate, /sfp-tab-page/);
  assert.match(pageScript, /onBack\(\)/);
  assert.match(pageScript, /wx\.navigateBack\(\{ fail: \(\) => wx\.switchTab\(\{ url: '\/pages\/index\/index' \}\) \}\)/);
  assert.doesNotMatch(pageScript, /getTabBar/);
  assert.match(pageScript, /\/miniprogram\/workbench/);
  assert.match(pageScript, /payload\.appointments/);
  assert.match(pageScript, /status === 'confirmed' \|\| item\.status === 'expired'/);
  assert.match(pageScript, /serviceStage === 'converted' \|\| serviceStage === 'closed'/);
  assert.match(pageScript, /statusLabel: serviceStage === 'converted' \? '已签约' : '已关闭'/);
  assert.match(pageScript, /openable: false/);
  assert.match(pageScript, /!openable/);
  assert.match(pageTemplate, /item\.openable \? 'card-pressed' : ''/);
  assert.match(pageTemplate, /item\.showRescheduleCta/);
  assert.match(pageScript, /isOverdueCoordination/);
  assert.match(pageScript, /selectedKey === todayKey && isOverdueCoordination/);
  assert.match(pageTemplate, /data-lead-id="\{\{item\.leadId\}\}"/);
  assert.match(pageTemplate, /data-appointment-id="\{\{item\.appointmentId\}\}"/);
  assert.match(pageTemplate, /data-openable="\{\{item\.openable\}\}"/);
  assert.doesNotMatch(pageTemplate, /data-item="\{\{item\}\}"/);
  assert.match(pageScript, /appointment-detail\/appointment-detail/);
  assert.doesNotMatch(pageTemplate, /重新调度/);
  assert.match(pageTemplate, /period-chip-row/);
  assert.match(pageTemplate, /bindtap="selectPeriodChip"/);
  assert.match(pageTemplate, /bindtap="openPeriodSheet"/);
  assert.match(pageTemplate, /class="custom-range"/);
  assert.match(pageTemplate, /\{\{customRangeLabel\}\}/);
  assert.match(pageTemplate, /nav-subtitle">\{\{weekSubtitle\}\}/);
  assert.match(pageScript, /if \(period\.kind === 'custom'\) return '自定义'/);
  assert.match(pageScript, /formatCustomRangeLabel/);
  assert.doesNotMatch(pageScript, /return `\$\{period\.from\} ~ \$\{period\.to\}`/);
  assert.match(pageTemplate, /自定义周期/);
  assert.match(pageTemplate, /period-sheet-mask/);
  assert.match(pageScript, /schedule: '1'/);
  assert.match(pageScript, /period: period\.kind \|\| 'week'/);
  assert.match(pageScript, /MAX_CUSTOM_DAYS = 366/);
  assert.match(pageScript, /confirmCustomPeriod/);
  assert.match(navigation, /enterprise-appointments\/enterprise-appointments': 'enterprise\.appointments'/);
  assert.match(navigation, /'\/pages\/ai-design\/ai-design': \['staff\.design', 'staff\.surveying'\]/);
  const pageStyles = source('packages/business/enterprise-appointments/enterprise-appointments.less');
  assert.match(pageStyles, /\.nav-back/);
  assert.doesNotMatch(pageStyles, /156rpx \+ env\(safe-area-inset-bottom\)/);
  assert.match(pageStyles, /\.period-chip text\s*\{[\s\S]*font-size:\s*26rpx/);
  assert.match(pageStyles, /\.custom-range text\s*\{[\s\S]*font-size:\s*22rpx/);
  assert.match(pageStyles, /\.period-sheet-mask\s*\{[\s\S]*opacity:\s*0/);
  assert.match(pageStyles, /\.period-sheet\s*\{[\s\S]*translateY\(100%\)/);
  assert.match(pageStyles, /\.period-sheet\.open\s*\{[\s\S]*translateY\(0\)/);
  assert.match(pageStyles, /\.status-tag\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(pageStyles, /\.status-tag\s*\{[\s\S]*align-items:\s*center/);
  assert.match(pageStyles, /\.status-tag text\s*\{[\s\S]*line-height:\s*1;/);
});

test('measurer workbench keeps the calendar itinerary separate from confirmed appointments', () => {
  const tabBar = source('custom-tab-bar/index.js');
  const calendar = source('packages/business/measurer-calendar/measurer-calendar.js');
  const calendarTemplate = source('packages/business/measurer-calendar/measurer-calendar.wxml');
  assert.match(tabBar, /key: 'workbench'[\s\S]*pagePath: '\/pages\/index\/index'/);
  assert.match(calendar, /confirmed: items\.filter\(\(item\) => item\.status === 'confirmed'\)/);
  assert.match(calendar, /history: items\.filter\(\(item\) => item\.status !== 'confirmed'\)/);
  assert.match(calendarTemplate, /待处理 \/ 历史/);
  assert.match(calendar, /measurer-unavailability\/measurer-unavailability/);
  assert.match(calendarTemplate, /bindtap="manageUnavailability"/);
});

test('designer profile edit loads and saves wechat id plus qr without requiring measurer qr', () => {
  const page = source('packages/business/profile-edit/profile-edit.js');
  const template = source('packages/business/profile-edit/profile-edit.wxml');
  const api = source('utils/api.js');
  assert.match(page, /\/miniprogram\/staff\/wechat-profile/);
  assert.match(page, /uploadStaffWechatQr/);
  assert.match(page, /hideKeyboard/);
  assert.match(page, /loadDesignerQrToTempFile/);
  assert.match(page, /assignmentEligible/);
  assert.match(page, /补齐后才能接客户/);
  assert.match(template, /wx:if="\{\{isDesigner\}\}"/);
  assert.match(template, /wechatId/);
  assert.match(template, /wechatQrPath|hasWechatQr/);
  assert.match(template, /catchtap="onChooseWechatQr"/);
  assert.match(template, /eligibilityLabel/);
  assert.match(template, /领取成功页和服务档案/);
  assert.doesNotMatch(template, /家装现场顾问.*二维码/);
  assert.match(api, /function uploadStaffWechatQr/);
  assert.match(api, /\/miniprogram\/staff\/wechat-qr/);
});

test('designer workbench opens profile edit from WeChat profile todo', () => {
  const workbench = source('components/role-workbench/role-workbench.js');
  assert.match(workbench, /action === 'profile'/);
  assert.match(workbench, /profile-edit\/profile-edit/);
});

test('designer workbench prompts incomplete WeChat profile on every entry', () => {
  const workbench = source('components/role-workbench/role-workbench.js');
  assert.match(workbench, /scheduleWechatProfilePrompt/);
  assert.match(workbench, /loadDesignerWechatProfileStatus/);
  assert.match(workbench, /\/miniprogram\/staff\/wechat-profile/);
  assert.match(workbench, /assignmentEligible/);
  assert.match(workbench, /includes\('wechatId'\)/);
  assert.match(workbench, /请先完善微信资料/);
  assert.match(workbench, /confirmText:\s*'去完善'/);
  assert.match(workbench, /cancelText:\s*'稍后'/);
  assert.match(workbench, /wx\.showModal/);
  assert.match(workbench, /_wechatProfilePromptShownThisVisit/);
});

test('role workbench identity nav left-aligns brand and enterprise name inside the capsule row', () => {
  const template = source('components/role-workbench/role-workbench.wxml');
  const styles = source('components/role-workbench/role-workbench.less');
  const workbench = source('components/role-workbench/role-workbench.js');
  const enterpriseNav = template.slice(
    template.indexOf('class="identity-nav"'),
    template.indexOf('class="role-hero-card enterprise-hero-card"')
  );
  assert.match(template, /role === 'enterprise_admin' \? '经营端' : role === 'designer' \? '家装设计顾问端' : '家装现场顾问端'/);
  assert.match(template, /min-height: \{\{navigationHeight\}\}px/);
  assert.match(template, /padding-right: \{\{navigationRight\}\}px/);
  assert.doesNotMatch(template, /identity-brand-row" style="height: \{\{navigationHeight\}\}px;"/);
  assert.doesNotMatch(template, /identity-actions/);
  assert.doesNotMatch(template, /class="qr-btn"/);
  assert.doesNotMatch(template, /class="bell-btn"/);
  assert.doesNotMatch(enterpriseNav, /mine-icons\/scan\.png/);
  assert.doesNotMatch(enterpriseNav, /mine-icons\/bell\.png/);
  assert.match(template, /bindtap="openActivityCode"/);
  assert.match(template, /去分享活动码/);
  assert.match(workbench, /openActivityCode\(\)/);
  assert.match(workbench, /openSecondary\(\)/);
  assert.match(workbench, /function resolveStaffName/);
  assert.match(workbench, /nickname \|\| info\.displayName \|\| info\.name/);
  assert.doesNotMatch(styles, /\.identity-actions/);
  assert.doesNotMatch(styles, /\.bell-btn/);
  assert.match(styles, /\.identity-nav\s*\{[\s\S]*align-items:\s*center;/);
  assert.match(styles, /\.identity-nav\s*\{[\s\S]*justify-content:\s*flex-start;/);
  assert.match(styles, /\.identity-nav\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(styles, /\.identity-nav\s*\{[\s\S]*margin:\s*0 -28rpx 20rpx;/);
  assert.match(styles, /\.identity-brand-stack\s*\{[\s\S]*align-items:\s*flex-start;/);
  assert.match(styles, /\.identity-brand-name\s*\{[\s\S]*font-size:\s*32rpx;/);
  assert.match(styles, /\.identity-enterprise-name\s*\{[\s\S]*font-size:\s*22rpx;/);
  assert.match(styles, /\.identity-enterprise-name\s*\{[\s\S]*text-align:\s*left;/);
  assert.match(styles, /\.identity-enterprise-name\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.doesNotMatch(styles, /\.identity-tag/);
  assert.doesNotMatch(styles, /word-break:\s*break-all/);
});

test('role workbench keeps the enterprise under the brand and the unified overview hero role-only', () => {
  const template = source('components/role-workbench/role-workbench.wxml');
  const styles = source('components/role-workbench/role-workbench.less');
  const professionalOverview = template.slice(
    template.indexOf("role === 'enterprise_admin' || role === 'designer' || role === 'measurer'"),
    template.indexOf("focus === 'operations'")
  );
  assert.match(template, /wx:if="\{\{enterpriseName\}\}"[\s\S]*identity-enterprise-name[\s\S]*\{\{enterpriseName\}\}/);
  assert.doesNotMatch(professionalOverview, /hero-staff-name|hero-subtitle/);
  assert.doesNotMatch(template, /staffName \+ ' · ' \+ enterpriseName/);
  assert.doesNotMatch(template, /企业负责人/);
  assert.doesNotMatch(template, /专业服务/);
  assert.match(styles, /\.identity-enterprise-name\s*\{[\s\S]*max-width:\s*calc\(100% - 50rpx\);/);
  assert.match(styles, /\.enterprise-hero-card\s*\{[\s\S]*min-height:\s*252rpx;/);
  assert.doesNotMatch(styles, /-webkit-line-clamp:\s*2;/);
});

test('enterprise owner workbench prioritizes acquisition and team actions without a sparse action area', () => {
  const template = source('components/role-workbench/role-workbench.wxml');
  const workbench = source('components/role-workbench/role-workbench.js');
  const styles = source('components/role-workbench/role-workbench.less');

  assert.match(template, /enterprise-action-share-card[\s\S]*activityCode\.label[\s\S]*activityCode\.detail/);
  assert.match(template, /enterprise-action-mini-card invite[\s\S]*joinCode\.label[\s\S]*joinCode\.detail/);
  assert.match(template, /operations-dashboard\/activity-code-share-v3\.png/);
  assert.match(template, /operations-dashboard\/team-onboarding-v3\.png/);
  assert.match(template, /operations-dashboard\/referrer-roster-v2\.png/);
  assert.doesNotMatch(template, /enterprise-code-plus|leads-v4\/plus-white\.png/);
  for (const asset of ['activity-code-share-v3.png', 'team-onboarding-v3.png', 'referrer-roster-v2.png', 'lead-inbox-v2.png', 'priority-alert-v2.png']) {
    const bytes = fs.readFileSync(path.join(root, 'images/operations-dashboard', asset));
    assert.ok(bytes.length <= 300 * 1024, `${asset} must remain package-sized`);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]), `${asset} must retain transparent PNG pixels`);
  }
  assert.match(template, /aria-label="分享活动码，发给客户扫码留资"/);
  assert.match(template, /aria-label="\{\{role === 'enterprise_admin' \? '邀请员工或推荐人入驻' : '邀请推荐人入驻'\}\}"/);
  assert.match(workbench, /normalizeWorkbenchCodeActions/);
  assert.match(workbench, /rawActivity\.target === 'join-codes'/);
  assert.match(workbench, /rawJoin = rawJoin \|\| rawActivity/);
  assert.match(workbench, /label:\s*'分享活动码'/);
  assert.match(workbench, /detail:\s*activity\.detail \|\| '发给客户 · 扫码留资'/);
  assert.match(workbench, /label:\s*'邀请入驻'/);
  assert.match(workbench, /payload\.role === 'enterprise_admin' \? '员工 · 推荐人' : '仅推荐人'/);
  assert.match(template, /bindtap="openReferrerRoster"/);
  assert.match(template, /referrerRoster\.label/);
  assert.match(workbench, /enterprise-referrers\/enterprise-referrers/);
  assert.match(template, /enterprise-appointment-row[\s\S]*secondary\.label/);
  assert.match(template, /enterprise-appointment-meta[\s\S]*appointmentCount/);
  assert.match(template, /enterprise-reminder-row[\s\S]*enterpriseReminder/);
  assert.match(template, /enterprise-action-hub[\s\S]*enterprise-appointment-row[\s\S]*enterprise-reminder-row[\s\S]*quick-nav-grid[\s\S]*enterprise-priority-section/);
  assert.match(template, /enterprise-reminder-title-divider[\s\S]*enterprise-reminder-divider/);
  assert.match(template, /quick-nav-arrow/);
  assert.match(template, /priority-alert-v2\.png/);
  assert.match(workbench, /buildEnterpriseReminder/);
  assert.match(workbench, /openOperations\(\)[\s\S]*enterprise-operations/);
  assert.match(styles, /\.enterprise-action-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1\.045fr\) minmax\(0, 0\.955fr\)/);
  assert.match(styles, /\.enterprise-action-stack\s*\{[\s\S]*grid-template-rows:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.enterprise-action-share-card\s*\{[\s\S]*min-height:\s*430rpx/);
  assert.match(styles, /\.enterprise-activity-art\s*\{[\s\S]*bottom:\s*74rpx[\s\S]*height:\s*220rpx/);
  assert.match(styles, /\.enterprise-action-mini-card\s*\{[\s\S]*min-height:\s*208rpx/);
  assert.match(styles, /\.enterprise-action-copy\.mini \.enterprise-action-title\s*\{[\s\S]*font-size:\s*32rpx/);
  assert.match(styles, /\.enterprise-mini-art\.invite\s*\{[\s\S]*right:\s*10rpx[\s\S]*bottom:\s*8rpx[\s\S]*width:\s*150rpx/);
  assert.match(styles, /\.enterprise-mini-art\.referrer\s*\{[\s\S]*right:\s*12rpx[\s\S]*bottom:\s*8rpx[\s\S]*width:\s*148rpx/);
  assert.match(styles, /\.enterprise-appointment-row\s*\{[\s\S]*min-height:\s*80rpx[\s\S]*border-radius:\s*18rpx/);
  assert.match(styles, /\.enterprise-reminder-row\s*\{[\s\S]*min-height:\s*72rpx[\s\S]*margin-top:\s*14rpx/);
  assert.match(styles, /\.enterprise-reminder-title-divider\s*\{[\s\S]*height:\s*32rpx/);
  assert.match(styles, /\.enterprise-action-hub \.quick-nav-card\s*\{[\s\S]*height:\s*176rpx/);
  assert.match(styles, /\.exception-cta\s*\{[\s\S]*border-radius:\s*10rpx/);
  assert.match(styles, /\.enterprise-hero-card \.hero-top-row\s*\{[\s\S]*min-height:\s*116rpx/);
  assert.match(styles, /\.enterprise-hero-card \.stats-pills-row\s*\{[\s\S]*margin-top:\s*12rpx[\s\S]*padding-right:\s*236rpx/);
  assert.match(styles, /\.enterprise-hero-card \.stat-pill\s*\{[\s\S]*flex:\s*0 1 auto/);
  assert.match(styles, /\.enterprise-hero-mascot\s*\{[\s\S]*position:\s*absolute[\s\S]*width:\s*220rpx/);
  assert.match(styles, /@media \(max-width:\s*360px\)[\s\S]*\.enterprise-action-share-card[\s\S]*min-height:\s*370rpx[\s\S]*\.enterprise-activity-art[\s\S]*height:\s*184rpx/);
});

test('enterprise owner operations dashboard restores the approved regular business loop', () => {
  const template = source('components/role-workbench/role-workbench.wxml');
  const workbench = source('components/role-workbench/role-workbench.js');
  const styles = source('components/role-workbench/role-workbench.less');
  const operationsStyles = styles.slice(styles.indexOf('/* Operations Tab — direct restoration'));

  assert.match(workbench, /normalizeEnterpriseDashboard/);
  assert.match(workbench, /stageKeys = \['newLeads', 'completedSurveys', 'signedCount'\]/);
  assert.match(workbench, /efficiencyKeys = \['schemeDelivery', 'signingRate'\]/);
  assert.match(template, /operations-board-kicker[\s\S]*经营闭环/);
  assert.match(template, /wx:for="\{\{dashboardStages\}\}"/);
  assert.doesNotMatch(template, /operations-stage-progress|operations-stage-progress-line/);
  assert.match(template, /wx:for="\{\{dashboardEfficiencies\}\}"/);
  assert.match(template, /focus === 'operations'/);
  assert.match(template, /enterprise-operations-hero/);
  assert.match(template, /operations-hero-kpi-grid/);
  assert.match(template, /enterpriseHeroKpis/);
  assert.match(template, /operations-dashboard\/enterprise-hero-k-v2\.png/);
  assert.match(template, /operations-dashboard\/new-leads-kpi-v2\.png/);
  assert.match(template, /operations-dashboard\/completed-survey-kpi-v2\.png/);
  assert.match(template, /operations-dashboard\/signed-contract-kpi-v2\.png/);
  assert.match(template, /operations-dashboard\/contract-amount-kpi-v2\.png/);
  assert.match(template, /operations-dashboard\/operations-growth-chart-v2\.png/);
  assert.match(template, /operations-dashboard\/zap\.png/);
  assert.match(template, /operations-dashboard\/enterprise-guide\.png/);
  assert.match(template, /operations-dashboard\/lead-inbox-v2\.png/);
  assert.match(template, /operations-dashboard\/staff-load\.png/);
  assert.match(template, /quick-nav-mascot \{\{item\.key === 'staffLoad' \? 'staff-load-mascot'/);
  assert.match(template, /operations-trend-card/);
  assert.match(template, /contractAmountTrend\.hasData/);
  assert.match(template, /operations-trend-canvas/);
  assert.match(template, /暂无签约金额趋势数据/);
  assert.match(workbench, /contractAmountSum/);
  assert.match(template, /stat-format\.wxs/);
  assert.match(template, /stat\.moneyValue\(item\.value\)/);
  assert.match(template, /stat\.count\(item\.value\)/);
  assert.match(workbench, /normalizeContractAmountTrend/);
  assert.match(workbench, /renderContractAmountTrend/);
  assert.match(workbench, /formatContractAmountTrendLabel/);
  assert.match(workbench, /annotationIndexes/);
  assert.match(workbench, /drawValueLabel/);
  assert.match(workbench, /context\.quadraticCurveTo/);
  assert.match(workbench, /已发布方案/);
  assert.match(template, /enterprise-priority-tray/);
  assert.match(template, /priority-empty-pin[\s\S]*leads-v4\/map-pin\.png[\s\S]*\{\{emptyCopy\}\}/);
  assert.equal((template.match(/<text class="section-icon">📊<\/text>/g) || []).length, 1);
  assert.doesNotMatch(template, /<text class="section-icon">⚡<\/text>/);
  assert.match(styles, /\.quick-nav-mascot\.staff-load-mascot\s*\{[\s\S]*width:\s*144rpx/);
  assert.match(styles, /\.enterprise-action-hub \.quick-nav-mascot\.staff-load-mascot\s*\{[\s\S]*right:\s*-2rpx[\s\S]*bottom:\s*-4rpx[\s\S]*width:\s*120rpx[\s\S]*height:\s*96rpx/);
  assert.match(styles, /\.enterprise-dashboard-section,[\s\S]*\.enterprise-priority-section\s*\{[\s\S]*margin-top:\s*24rpx/);
  assert.match(operationsStyles, /\.operations-hero-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4/);
  assert.match(operationsStyles, /\.operations-hero-kpi-value\s*\{[\s\S]*font-size:\s*44rpx/);
  assert.match(operationsStyles, /\.operations-hero-kpi-value\.is-compact\s*\{[\s\S]*font-size:\s*36rpx/);
  assert.match(operationsStyles, /\.operations-hero-kpi-value text \+ text\s*\{[\s\S]*font-size:\s*26rpx/);
  assert.doesNotMatch(operationsStyles, /\.operations-hero-kpi-value text:last-child/);
  assert.match(operationsStyles, /\.operations-trend-card\s*\{[\s\S]*min-height:\s*306rpx/);
  assert.match(operationsStyles, /\.enterprise-operations-hero\s*\{[\s\S]*min-height:\s*414rpx/);
  assert.match(operationsStyles, /\.operations-period-chip-row\s*\{[\s\S]*margin-top:\s*22rpx/);
  assert.match(operationsStyles, /\.operations-period-chip-row \.period-chip text\s*\{[\s\S]*font-size:\s*28rpx/);
  assert.match(styles, /\.staff-data-period-row\s*\{[\s\S]*?margin:\s*22rpx 0 0/);
  assert.match(styles, /\.staff-data-period-row\s*\{[\s\S]*?position:\s*relative/);
  assert.match(operationsStyles, /\.enterprise-operations-board\s*\{[\s\S]*min-height:\s*288rpx/);
  assert.match(operationsStyles, /\.operations-stage-grid\s*\{[\s\S]*gap:\s*0/);
  assert.match(operationsStyles, /\.operations-stage:not\(:last-child\)::after\s*\{[\s\S]*height:\s*3rpx/);
  assert.match(operationsStyles, /\.operations-stage\s*\{[\s\S]*border:\s*0/);
  assert.match(operationsStyles, /\.operations-stage-icon\s*\{[\s\S]*width:\s*88rpx/);
  assert.match(operationsStyles, /\.operations-stage-label\s*\{[\s\S]*font-size:\s*28rpx/);
  assert.match(operationsStyles, /\.operations-board-kicker text\s*\{[\s\S]*font-size:\s*34rpx/);
  assert.doesNotMatch(styles, /operations-board-art|operations-route-node|operations-stage-progress|operations-stage-completedSurveys::before/);
  assert.match(styles, /\.operations-efficiency-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(operationsStyles, /\.operations-efficiency-grid\s*\{[\s\S]*gap:\s*18rpx/);
  assert.match(operationsStyles, /\.operations-efficiency-card\s*\{[\s\S]*min-height:\s*192rpx/);
  assert.match(workbench, /legacyClosureDetail[\s\S]*方案同步中/);
  assert.match(styles, /\.enterprise-priority-tray\s*\{[\s\S]*background:\s*rgba\(242, 251, 246, 0\.92\)/);
});

test('enterprise owner dashboard cutouts are standalone optimized transparent PNGs', () => {
  const assets = [
    'images/operations-dashboard/enterprise-guide.png',
    'images/operations-dashboard/lead-inbox-v2.png',
    'images/operations-dashboard/staff-load.png',
    'images/operations-dashboard/activity-code-share-v3.png',
    'images/operations-dashboard/team-onboarding-v3.png',
    'images/operations-dashboard/referrer-roster-v2.png',
    'images/operations-dashboard/priority-alert-v2.png',
    'images/operations-dashboard/enterprise-hero-k-v2.png',
    'images/operations-dashboard/new-leads-kpi-v2.png',
    'images/operations-dashboard/completed-survey-kpi-v2.png',
    'images/operations-dashboard/signed-contract-kpi-v2.png',
    'images/operations-dashboard/contract-amount-kpi-v2.png',
    'images/operations-dashboard/operations-growth-chart-v2.png',
  ];
  for (const asset of assets) {
    const file = path.join(root, asset);
    assert.ok(fs.existsSync(file), `${asset} should be packaged`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length <= 300 * 1024, `${asset} exceeds the 300KB asset budget`);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]), `${asset} must preserve transparency`);
  }
  const repoFile = (relative) => fs.readFileSync(path.join(root, '..', relative), 'utf8');
  assert.match(repoFile('docs/icon-sources/mine/README.md'), /enterprise-guide\.png[\s\S]*ImageGen/);
  assert.match(repoFile('docs/miniprogram-system-modules.md'), /enterprise-owner-activity-code-entry-v3[\s\S]*300KB/);
  assert.match(repoFile('docs/miniprogram-system-modules.zh-CN.md'), /enterprise-owner-activity-code-entry-v3[\s\S]*300KB/);
});

test('custom period sheet keeps cancel and confirm above the custom TabBar', () => {
  const template = source('components/role-workbench/role-workbench.wxml');
  const styles = source('components/role-workbench/role-workbench.less');
  assert.match(template, /period-sheet-title[\s\S]*自定义周期/);
  assert.match(template, /bindtap="closePeriodSheet"[\s\S]*取消/);
  assert.match(template, /bindtap="confirmCustomPeriod"[\s\S]*确定/);
  assert.match(
    styles,
    /\.period-sheet-mask\s*\{[\s\S]*bottom:\s*var\(--sfp-custom-tabbar-safe-height/
  );
  assert.match(styles, /\.period-sheet-actions\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.period-sheet-btn\.solid\s*\{[\s\S]*background:\s*#00c365/);
});
