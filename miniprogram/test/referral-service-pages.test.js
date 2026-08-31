const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

const referralAssets = [
  'thumbs-up-xiao-k.png',
  'xiao-k-service-archive-guide.png',
  'service-archive-scene-v2.png',
  'xiao-k-continuity-archive-drawer.png',
  'onsite-measurement.png',
  'designer-service.png',
  'phone-authorization.png',
  'designer-matching.png',
  'xiao-k-onboarding-recovery.png',
  'xiao-k-spatial-service-guide.png',
  'xiao-k-three-benefits.png',
  'phone-auth-privacy.png',
];

const codePresenterAssets = [
  'scan-frame.png',
];

const codePresenterV3Assets = [
  'xiao-k-scan-presenter.png',
  'scan-journey.png',
  'role-journey.png',
  'start-journey.png',
  'home-outline.png',
  'advisor-outline.png',
];

test('staff activity code renders a continuous service invitation and may show the enterprise name', () => {
  const wxml = source('packages/business/staff-activity-code/staff-activity-code.wxml');
  const js = source('packages/business/staff-activity-code/staff-activity-code.js');
  const less = source('packages/business/staff-activity-code/staff-activity-code.less');

  assert.match(wxml, /免费设计服务/);
  assert.match(wxml, /免费上门量房 · 专业家装设计顾问服务/);
  assert.match(wxml, /请客户扫描此码/);
  assert.match(wxml, /分享给客户/);
  assert.doesNotMatch(wxml, /让客户扫码领取/);
  assert.match(wxml, /enterpriseName/);
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(wxml, /code-presenter-v3\/xiao-k-scan-presenter\.png/);
  assert.match(wxml, /code-presenter-v2\/scan-frame\.png/);
  assert.match(wxml, /code-presenter-v3\/home-outline\.png/);
  assert.match(wxml, /code-presenter-v3\/advisor-outline\.png/);
  assert.doesNotMatch(wxml, /referral-service-v1\/thumbs-up-xiao-k/);
  assert.doesNotMatch(less, /\.scan-glyph\s*\{[^}]*border:\s*3rpx solid/);
  assert.doesNotMatch(less, /\.share-scan\s*\{[^}]*border:\s*3rpx solid/);
  assert.match(js, /\/miniprogram\/staff-activity-code/);
  assert.match(js, /staff-activity-code\/image/);
  assert.match(js, /designer_profile_incomplete/);
  assert.match(js, /profile-edit\/profile-edit/);
  assert.match(js, /onFixProfile/);
  assert.match(wxml, /去完善资料/);
  assert.match(wxml, /errorAction === 'profile'/);
  assert.match(wxml, /bindtap="onBack"/);
  assert.match(wxml, /aria-label="返回首页"/);
  assert.match(js, /navigateToRoleLanding/);
  assert.match(js, /leaveToRoleHome/);
  assert.match(less, /\.nav-back/);
  assert.match(less, /\.back-chevron/);
  assert.match(js, /free-design-service\/free-design-service\?token=/);
  assert.match(wxml, /service-invitation-card/);
  assert.match(wxml, /service-code-scroll/);
  assert.match(wxml, /action-dock/);
  assert.match(less, /\.service-code-scroll\s*\{[\s\S]*flex:\s*1/);
  assert.match(less, /\.service-code-content\s*\{[\s\S]*min-height:\s*100%[\s\S]*flex-direction:\s*column/);
  assert.match(less, /\.service-invitation-card\s*\{[\s\S]*flex:\s*none/);
  assert.match(less, /\.qr-stage\s*\{[\s\S]*width:\s*478rpx/);
  assert.match(less, /\.service-promises\s*\{[\s\S]*background:\s*#fff/);
  assert.match(less, /\.qr-state-copy\s*\{[\s\S]*font-size:\s*22rpx/);
});

test('enterprise join codes present owner dual codes and employee personal promoter codes', () => {
  const wxml = source('packages/business/enterprise-join-codes/enterprise-join-codes.wxml');
  const js = source('packages/business/enterprise-join-codes/enterprise-join-codes.js');
  const less = source('packages/business/enterprise-join-codes/enterprise-join-codes.less');
  const json = JSON.parse(source('packages/business/enterprise-join-codes/enterprise-join-codes.json'));

  assert.equal(json.navigationStyle, 'custom');
  assert.match(wxml, /出示入驻码/);
  assert.match(wxml, /生成入驻码/);
  assert.match(wxml, /换新/);
  assert.match(wxml, /停用/);
  assert.match(wxml, /一键分享/);
  assert.match(wxml, /open-type="share"/);
  assert.match(wxml, /enterpriseName/);
  assert.match(wxml, /code-presenter-v3\/xiao-k-scan-presenter\.png/);
  assert.match(wxml, /code-presenter-v3\/\{\{item\.icon\}\}/);
  assert.doesNotMatch(wxml, /<text>\{\{item\.mark\}\}<\/text>/);
  assert.doesNotMatch(less, /\.scan-glyph\s*\{[^}]*border:\s*3rpx solid/);
  assert.doesNotMatch(less, /\.share-scan\s*\{[^}]*border:\s*3rpx solid/);
  assert.match(js, /员工入驻码/);
  assert.match(js, /我的推广人入驻码/);
  assert.match(js, /normalizeJoinCodeScope\(result\.data && result\.data\.scope\)/);
  assert.match(js, /tabsForScope\(scope\)/);
  assert.match(js, /activeTypeForScope\(scope, this\.data\.activeType\)/);
  assert.match(js, /onShareAppMessage\(\)/);
  assert.match(js, /onboarding\/onboarding\?token=/);
  assert.match(js, /hideShareMenu/);
  assert.equal(json.enableShareAppMessage, true);
  assert.doesNotMatch(wxml, /出示员工活动码|免费设计服务|让客户扫码领取|推荐网络 → 企业双码/);
  assert.match(js, /\/miniprogram\/enterprise-join-codes/);
  assert.match(js, /enterprise-join-codes\/\$\{encodeURIComponent\(codeType\)\}\/image/);
  assert.match(js, /\/rotate['"`]/);
  assert.match(js, /\/disable['"`]/);
  assert.match(js, /wx\.showModal/);
  assert.match(js, /wx\.showToast/);
  assert.match(js, /确认生成|确认换新|确认停用/);
  assert.doesNotMatch(js, /confirmText:\s*hasActive\s*\?\s*'换新入驻码'\s*:\s*'生成入驻码'/);
  assert.doesNotMatch(js, /confirmText:\s*'停用入驻码'/);
  const confirmTexts = [...js.matchAll(/confirmText:\s*hasActive\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)]
    .flatMap((match) => [match[1], match[2]]);
  const disableConfirm = js.match(/onDisable[\s\S]*?confirmText:\s*'([^']+)'/);
  if (disableConfirm) confirmTexts.push(disableConfirm[1]);
  assert.ok(confirmTexts.length >= 3, 'expected generate/rotate/disable confirmText literals');
  confirmTexts.forEach((text) => {
    assert.ok(String(text).length <= 4, `wx.showModal confirmText must be ≤4 chars: ${text}`);
  });
  assert.match(js, /确认弹窗打开失败/);
  assert.match(wxml, /bindtap="onBack"/);
  assert.match(wxml, /aria-label="返回首页"/);
  assert.match(js, /navigateToRoleLanding/);
  assert.match(js, /leaveToRoleHome/);
  assert.match(less, /\.nav-back/);
  assert.match(less, /\.back-chevron/);
  assert.doesNotMatch(js, /staff-activity-code/);
  assert.match(less, /\.code-tab\.active/);
  assert.match(less, /\.manage-primary/);
  assert.match(wxml, /code-invitation-card/);
  assert.match(wxml, /journey-rail/);
  assert.match(wxml, /action-dock/);
  assert.match(wxml, /class="info-bar"[\s\S]*class="roster-link"[\s\S]*class="action-dock"/);
  assert.match(wxml, /rosterLinkLabel/);
  assert.match(js, /openReferrerRoster/);
  assert.match(js, /enterprise-referrers\/enterprise-referrers/);
  assert.match(less, /\.roster-link text\s*\{[\s\S]*font-size:\s*26rpx/);
  assert.match(less, /\.service-code-scroll\s*\{[\s\S]*flex:\s*1/);
  assert.match(less, /\.service-code-content\s*\{[\s\S]*min-height:\s*100%[\s\S]*flex-direction:\s*column/);
  assert.match(less, /\.code-invitation-card\s*\{[\s\S]*flex:\s*none/);
  assert.match(less, /\.qr-stage\s*\{[\s\S]*width:\s*380rpx/);
  assert.doesNotMatch(less, /\.action-dock\s*\{[\s\S]*margin-top:\s*auto/);
});

test('join-code scope model gives employees one personal promoter tab', () => {
  const model = require('../packages/business/enterprise-join-codes/enterprise-join-codes-model.js');
  assert.deepEqual(model.tabsForScope('own'), [
    { codeType: 'referrer', label: '我的推广人入驻码' },
  ]);
  assert.deepEqual(model.tabsForScope('enterprise'), [
    { codeType: 'staff', label: '员工入驻码' },
    { codeType: 'referrer', label: '我的推广人入驻码' },
  ]);
  assert.equal(model.activeTypeForScope('own', 'staff'), 'referrer');
  assert.equal(model.rosterLinkLabel('own'), '查看我的推广人');
  assert.equal(model.rosterLinkLabel('enterprise'), '查看推广网络');
});

test('promotion service screen keeps the public presentation anonymous and scanable', () => {
  const wxml = source('packages/business/promotion-service-code/promotion-service-code.wxml');
  const js = source('packages/business/promotion-service-code/promotion-service-code.js');
  const less = source('packages/business/promotion-service-code/promotion-service-code.less');

  assert.match(wxml, /免费设计服务/);
  assert.match(wxml, /免费上门量房 · 专业家装设计顾问服务/);
  assert.match(wxml, /请客户扫描此码/);
  assert.match(wxml, /0元服务/);
  assert.match(wxml, /家装设计顾问匹配/);
  assert.match(wxml, /分享给客户/);
  assert.doesNotMatch(wxml, /让客户扫码领取/);
  assert.match(wxml, /open-type="share"/);
  assert.match(wxml, /code-presenter-v3\/xiao-k-scan-presenter\.png/);
  assert.match(wxml, /code-presenter-v3\/home-outline\.png/);
  assert.match(wxml, /code-presenter-v3\/advisor-outline\.png/);
  assert.match(wxml, /code-presenter-v2\/scan-frame\.png/);
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.doesNotMatch(wxml, /referral-service-v1\/thumbs-up-xiao-k/);
  assert.doesNotMatch(less, /\.scan-glyph\s*\{[^}]*border:\s*3rpx solid/);
  assert.doesNotMatch(less, /\.share-scan\s*\{[^}]*border:\s*3rpx solid/);
  assert.match(js, /promotion-code\/image/);
  assert.match(js, /free-design-service\/free-design-service\?token=/);
  assert.match(js, /responseType:\s*'arraybuffer'/);
  assert.match(wxml, /service-invitation-card/);
  assert.match(wxml, /service-code-scroll/);
  assert.match(wxml, /action-dock/);
  assert.match(less, /\.service-code-scroll\s*\{[\s\S]*flex:\s*1/);
  assert.match(less, /\.service-code-content\s*\{[\s\S]*min-height:\s*100%[\s\S]*flex-direction:\s*column/);
  assert.match(less, /\.service-invitation-card\s*\{[\s\S]*flex:\s*none/);
  assert.match(less, /\.hero-title\s*\{[\s\S]*font-size:\s*64rpx/);
  assert.match(less, /\.hero-subtitle\s*\{[\s\S]*font-size:\s*30rpx/);
  assert.match(less, /\.qr-stage\s*\{[\s\S]*width:\s*478rpx/);
  assert.match(less, /\.service-qr\s*\{[\s\S]*width:\s*450rpx/);
  assert.match(less, /\.guide-xiaok\s*\{[\s\S]*width:\s*260rpx/);
  assert.match(less, /\.scan-copy\s*\{[\s\S]*font-size:\s*30rpx/);
  assert.match(less, /\.promise-icon\s*\{[\s\S]*width:\s*92rpx/);
  assert.match(less, /\.promise-title\s*\{[\s\S]*font-size:\s*26rpx/);
  assert.match(less, /\.info-copy\s*\{[\s\S]*font-size:\s*24rpx/);
  assert.match(less, /\.share-action\s*\{[\s\S]*min-height:\s*96rpx/);
  assert.match(less, /\.service-promises\s*\{[\s\S]*background:\s*#fff/);
  assert.match(less, /\.qr-retry\s*\{[\s\S]*width:\s*auto/);
  assert.match(less, /\.qr-retry\s*\{[\s\S]*max-width:\s*100%/);
  assert.doesNotMatch(wxml, /装修公司|企业名称|enterpriseName|企业选择/);
  assert.match(wxml, /bindtap="onBack"/);
  assert.match(wxml, /aria-label="返回首页"/);
  assert.match(js, /navigateToRoleLanding/);
  assert.match(js, /leaveToRoleHome/);
  assert.match(less, /\.nav-back/);
  assert.match(less, /\.back-chevron/);
});

test('free design service success state is archive first and uses real designer proof', () => {
  const wxml = source('packages/business/free-design-service/free-design-service.wxml');
  const less = source('packages/business/free-design-service/free-design-service.less');
  const successMarkup = wxml.match(
    /<view wx:elif="\{\{pageState === 'success'\}\}"[\s\S]*?(?=<view wx:elif="\{\{pageState === 'existing'\}\}")/,
  )?.[0] || '';

  assert.match(successMarkup, /领取完成[\s\S]*授权完成[\s\S]*顾问已匹配/);
  assert.match(successMarkup, /你的服务档案已建立/);
  assert.match(successMarkup, /量房、户型、方案与服务进度，都在这里持续更新/);
  assert.match(successMarkup, /服务进度[\s\S]*户型档案[\s\S]*设计方案/);
  assert.match(successMarkup, /xiao-k-service-archive-guide\.png/);
  assert.match(successMarkup, /service-archive-scene-v2\.png/);
  assert.match(successMarkup, /查看服务档案<\/button>[\s\S]*success-contact-card[\s\S]*查看微信/);
  assert.match(successMarkup, /professionalProfile\.titleVisible/);
  assert.match(successMarkup, /professionalProfile\.experienceLabel/);
  assert.match(successMarkup, /professionalProfile\.serviceLabel/);
  assert.doesNotMatch(successMarkup, /量房预约与方案沟通可通过微信联系/);
  assert.doesNotMatch(successMarkup, /后续量房预约、户型确认与方案沟通由家装设计顾问微信跟进/);
  assert.doesNotMatch(successMarkup, /claim-action-outline success-contact-action/);
  assert.match(less, /\.success-archive-title\s*\{[^}]*font-size:\s*48rpx/);
  assert.match(less, /\.success-project-action\s*\{[^}]*min-height:\s*100rpx/);
  assert.match(less, /\.success-contact-compact\s*\{[^}]*min-height:\s*72rpx/);
  assert.match(less, /\.success-contact-compact\s*\{[^}]*width:\s*148rpx[^}]*flex:\s*0 0 148rpx/);
  assert.match(less, /\.success-designer-proof\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('free design service existing state restores the approved continuity archive drawer', () => {
  const wxml = source('packages/business/free-design-service/free-design-service.wxml');
  const less = source('packages/business/free-design-service/free-design-service.less');
  const js = source('packages/business/free-design-service/free-design-service.js');
  const existingMarkup = wxml.match(
    /<view wx:elif="\{\{pageState === 'existing'\}\}"[\s\S]*?<view wx:elif="\{\{pageState === 'pending'\}\}"/,
  )?.[0] || '';

  assert.match(existingMarkup, /已为你接续原有服务/);
  assert.match(existingMarkup, /人员、进度与服务档案都已保留/);
  assert.match(existingMarkup, /服务归属已保留/);
  assert.match(existingMarkup, /xiao-k-continuity-archive-drawer\.png/);
  assert.match(existingMarkup, /existing-folder-tab progress[\s\S]*服务进度/);
  assert.match(existingMarkup, /existing-folder-tab floorplan[\s\S]*户型档案/);
  assert.match(existingMarkup, /existing-folder-tab scheme[\s\S]*设计方案/);
  assert.match(existingMarkup, /继续查看服务档案/);
  assert.match(existingMarkup, /existing-designer-card[\s\S]*查看微信/);
  assert.match(existingMarkup, /professionalProfile\.titleVisible/);
  assert.match(existingMarkup, /professionalProfile\.experienceLabel/);
  assert.match(existingMarkup, /professionalProfile\.serviceLabel/);
  assert.doesNotMatch(existingMarkup, /联系当前家装设计顾问|claim-action-outline|thumbs-up-xiao-k/);
  assert.match(js, /label\.includes\('现场顾问'\)/);
  assert.match(less, /\.existing-continuity-card\s*\{[^}]*border-radius:\s*34rpx[^}]*background:\s*linear-gradient/);
  assert.match(less, /\.existing-drawer-scene\s*\{[^}]*height:\s*318rpx/);
  assert.match(less, /\.existing-primary\s*\{[^}]*min-height:\s*100rpx[^}]*font-size:\s*32rpx/);
  assert.match(less, /\.existing-contact-compact\s*\{[^}]*width:\s*148rpx[^}]*flex:\s*0 0 148rpx/);
  assert.match(less, /\.existing-designer-proof\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(less, /\.existing-note\s*\{[^}]*background:\s*#eef7f1/);
});

test('free design service resolves into phone authorization and renders truthful outcomes', () => {
  const wxml = source('packages/business/free-design-service/free-design-service.wxml');
  const js = source('packages/business/free-design-service/free-design-service.js');
  const less = source('packages/business/free-design-service/free-design-service.less');
  const phoneAuthMarkup = wxml.match(
    /<view wx:elif="\{\{pageState === 'phoneAuth'\}\}"[\s\S]*?(?=<view wx:elif="\{\{pageState === 'success'\}\}")/,
  )?.[0] || '';

  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /允许微信授权手机号/);
  assert.match(wxml, /pageState === 'phoneAuth'/);
  assert.match(wxml, /你的服务档案已建立/);
  assert.match(wxml, /量房、户型、方案与服务进度，都在这里持续更新/);
  assert.match(wxml, /领取完成/);
  assert.match(wxml, /授权完成/);
  assert.match(wxml, /顾问已匹配/);
  assert.match(wxml, /xiao-k-service-archive-guide\.png/);
  assert.match(wxml, /免费量房 · 免费设计/);
  assert.match(phoneAuthMarkup, /三项免费权益/);
  assert.match(phoneAuthMarkup, /装修问题找/);
  assert.match(phoneAuthMarkup, /微信家装顾问，/);
  assert.match(phoneAuthMarkup, /免费问清楚/);
  assert.match(phoneAuthMarkup, /授权手机号，即可领取以下权益/);
  assert.match(phoneAuthMarkup, /免费效果图/);
  assert.match(phoneAuthMarkup, /出到客户满意为止/);
  assert.match(phoneAuthMarkup, /免费家装设计顾问/);
  assert.match(phoneAuthMarkup, /解答你的装修问题/);
  assert.match(phoneAuthMarkup, /免费家装现场顾问/);
  assert.doesNotMatch(phoneAuthMarkup, /免费设计顾问/);
  assert.doesNotMatch(phoneAuthMarkup, /免费现场顾问/);
  assert.match(phoneAuthMarkup, /解答现场问题/);
  assert.match(phoneAuthMarkup, /手机号仅用于服务联系，不公开、不出售/);
  assert.match(phoneAuthMarkup, /xiao-k-three-benefits\.png/);
  assert.match(phoneAuthMarkup, /ai-design-icons\/reference\.png/);
  assert.match(phoneAuthMarkup, /mine-icons\/bulb\.png/);
  assert.match(phoneAuthMarkup, /promotion-create\/location-pin\.png/);
  assert.doesNotMatch(phoneAuthMarkup, /phone-auth-design\.png|phone-auth-wechat\.png|mine-icons\/home\.png/);
  for (const iconPath of [
    'images/ai-design-icons/reference.png',
    'images/mine-icons/bulb.png',
    'packages/business/assets/promotion-create/location-pin.png',
  ]) {
    assert.equal(fs.existsSync(path.join(miniRoot, iconPath)), true, `${iconPath} must be packaged`);
  }
  assert.match(wxml, /phone-auth-privacy\.png/);
  assert.doesNotMatch(
    phoneAuthMarkup,
    /上门|量房|预约|地址|家装设计顾问匹配|双重免费权益|授权后我们会|发送家装设计顾问微信/,
  );
  assert.match(wxml, /权益已生效，正在为你匹配合适的家装设计顾问/);
  assert.match(wxml, /专业人员上门测量/);
  assert.match(wxml, /家装设计顾问沟通方案/);
  assert.match(wxml, /接下来这样进行/);
  assert.match(wxml, /安排上门量房/);
  assert.match(wxml, /围绕户型与需求沟通方案/);
  assert.match(wxml, /查看免费服务档案/);
  assert.match(wxml, /有其他服务需求？补充一下/);
  assert.match(wxml, /查看服务档案<\/button>[\s\S]*success-contact-card[\s\S]*查看微信[\s\S]*<view class="service-needs-link"/);
  assert.match(wxml, /xiao-k-spatial-service-guide\.png/);
  assert.doesNotMatch(wxml, /pageState === 'ready'/);
  assert.doesNotMatch(wxml, /一键授权手机号/);
  assert.doesNotMatch(wxml, /我已阅读并同意/);
  for (const asset of referralAssets.slice(1)) {
    if (
      asset === 'phone-authorization.png'
      || asset === 'xiao-k-onboarding-recovery.png'
    ) {
      continue;
    }
    assert.match(wxml, new RegExp(`referral-service-v1/${asset.replace('.', '\\.')}`));
  }
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/referrals\/authorize-and-create-lead/);
  assert.match(js, /encryptedData/);
  assert.doesNotMatch(js, /offerNotificationAuthorization/);
  assert.doesNotMatch(js, /requestSubscribeMessage/);
  assert.match(js, /kind !== 'referral' && response.data.kind !== 'staff_activity'/);
  assert.match(js, /'Idempotency-Key'/);
  assert.match(js, /response\.existingAttribution/);
  assert.match(js, /pageState:\s*'existing'/);
  assert.match(js, /pageState:\s*'phoneAuth'/);
  assert.doesNotMatch(js, /enterpriseName/);
  assert.match(js, /pageState:\s*designerProfile\s*\?\s*'success'\s*:\s*'pending'/);
  assert.match(js, /wechat_user_mismatch/);
  assert.match(js, /staff_phone_linked_to_other_user/);
  assert.match(js, /该手机号已绑定其他微信账号/);
  assert.doesNotMatch(js, /onStartPhoneAuth/);
  assert.doesNotMatch(js, /agreed/);
  assert.match(js, /pageState !== 'phoneAuth'/);
  assert.match(js, /leaveScanLanding/);
  assert.match(wxml, /bindtap="onBack"/);
  assert.match(wxml, /pageState === 'existing'/);
  assert.match(wxml, /已为你接续原有服务/);
  assert.match(wxml, /人员、进度与服务档案都已保留/);
  assert.match(wxml, /当前服务归属已保留/);
  assert.match(wxml, /xiao-k-continuity-archive-drawer\.png/);
  assert.doesNotMatch(wxml, /thumbs-up-xiao-k\.png/);
  assert.doesNotMatch(wxml, /xiao-k-existing-service\.png/);
  assert.match(wxml, /需求确认/);
  assert.match(wxml, /量房安排/);
  assert.match(wxml, /设计沟通/);
  assert.match(wxml, /existing-folder-tab progress[\s\S]*服务进度[\s\S]*existing-folder-tab floorplan[\s\S]*户型档案[\s\S]*existing-folder-tab scheme[\s\S]*设计方案/);
  assert.match(wxml, /继续查看服务档案/);
  assert.match(wxml, /existing-designer-card[\s\S]*existing-contact-compact[\s\S]*查看微信/);
  assert.doesNotMatch(wxml, /联系当前家装设计顾问/);
  assert.match(wxml, /success-contact-card/);
  assert.match(wxml, /professionalProfile\.titleVisible/);
  assert.match(wxml, /professionalProfile\.experienceLabel/);
  assert.match(wxml, /professionalProfile\.serviceLabel/);
  assert.match(wxml, /professional-badge\.png/);
  assert.match(wxml, /professional-experience\.png/);
  assert.match(wxml, /professional-service\.png/);
  assert.doesNotMatch(wxml, /后续量房预约、户型确认与方案沟通由家装设计顾问微信跟进/);
  assert.doesNotMatch(wxml, /量房预约与方案沟通可通过微信联系/);
  assert.match(wxml, /查看微信/);
  assert.match(wxml, /同步中/);
  assert.match(wxml, /查看服务档案/);
  assert.match(wxml, /success-archive-index[\s\S]*服务进度[\s\S]*户型档案[\s\S]*设计方案/);
  assert.match(wxml, /class="claim-action success-project-action"[\s\S]*查看服务档案<\/button>[\s\S]*class="success-contact-compact/);
  assert.doesNotMatch(wxml, /designer-qr-block|show-menu-by-longpress/);
  assert.match(wxml, /designer-contact-sheet/);
  assert.match(wxml, /canContactDesigner/);
  assert.match(js, /onContactDesigner/);
  assert.match(js, /onOpenContactSheet/);
  assert.match(js, /onOpenServiceNeeds/);
  assert.match(js, /service-needs\/service-needs\?leadId=/);
  assert.match(js, /showContactSheet:\s*Boolean\(designerProfile && contactAvailable\)/);
  assert.doesNotMatch(js, /loadDesignerQrToTempFile|copyDesignerWechatId/);
  assert.match(js, /hasDesignerContact/);
  assert.match(js, /hydrateExistingAttribution/);
  assert.match(js, /label\.includes\('现场顾问'\)/);
  assert.match(js, /customerProjectFromApiResponse/);
  assert.match(js, /const project = customerProjectFromApiResponse\(result\)/);
  assert.match(js, /服务已存在/);
  assert.doesNotMatch(wxml, /本次扫码不会重复领取/);
  assert.doesNotMatch(js, /saveImageToPhotosAlbum/);
  assert.match(less, /@media \(max-width:\s*360px\)/);
  assert.match(less, /\.claim-action\s*\{[^}]*align-self:\s*stretch/);
  assert.match(less, /\.claim-action\s*\{[^}]*min-width:\s*100%/);
  assert.match(less, /\.claim-action\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(less, /\.claim-auth\s*\{[^}]*overflow:\s*hidden/);
  assert.match(less, /\.claim-pending\s*\{[^}]*overflow:\s*hidden/);
  assert.match(less, /\.claim-auth \.claim-action\s*\{[^}]*margin-top:\s*20rpx/);
  assert.match(less, /\.auth-benefit-pass\s*\{[^}]*flex:\s*none/);
  assert.doesNotMatch(less, /\.auth-benefit-pass\s*\{[^}]*flex:\s*1/);
  assert.match(less, /\.auth-benefit-title\s*\{[^}]*font-size:\s*48rpx/);
  assert.match(less, /\.auth-benefit-main\s*\{[^}]*min-height:\s*500rpx[^}]*flex:\s*none/);
  assert.match(less, /\.auth-benefit-item\s*\{[^}]*min-height:\s*168rpx/);
  assert.match(less, /\.auth-benefit-xiaok\s*\{[^}]*width:\s*426rpx[^}]*height:\s*360rpx/);
  assert.match(less, /\.auth-benefit-icon-wrap\s*\{[^}]*width:\s*124rpx[^}]*height:\s*124rpx/);
  assert.match(less, /\.auth-benefit-label\s*\{[^}]*font-size:\s*36rpx/);
  assert.match(less, /\.auth-benefit-helper\s*\{[^}]*font-size:\s*28rpx/);
  assert.match(less, /\.auth-privacy-strip\s*\{[^}]*font-size:\s*28rpx/);
  assert.match(less, /\.claim-auth \.claim-action\s*\{[^}]*min-height:\s*104rpx[^}]*font-size:\s*32rpx/);
  assert.doesNotMatch(less, /@media \(max-height:\s*760px\)\s*\{[\s\S]*\.auth-benefit-pass\s*\{[^}]*min-height/);
  assert.doesNotMatch(less, /\.auth-purpose-card\s*\{/);
  assert.match(less, /\.claim-pending \.claim-action\s*\{[^}]*margin-top:\s*20rpx/);
  assert.match(less, /\.pending-benefit-hero\s*\{[^}]*min-height:\s*418rpx[^}]*flex:\s*1\.08 1 auto/);
  assert.match(less, /\.pending-benefit-title\s*\{[^}]*font-size:\s*48rpx/);
  assert.match(less, /\.pending-benefit-item\s*\{[^}]*min-height:\s*150rpx/);
  assert.match(less, /\.pending-journey-card\s*\{[^}]*min-height:\s*373rpx[^}]*flex:\s*0\.92 1 auto[^}]*background:\s*#ffffff/);
  assert.match(less, /@media \(max-height:\s*760px\)\s*\{[\s\S]*\.claim-pending\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(less, /@media \(max-height:\s*760px\)\s*\{[\s\S]*\.claim-auth,[\s\S]*overflow-y:\s*auto/);
  assert.match(less, /\.existing-continuity-card\s*\{[^}]*border-radius:\s*34rpx[^}]*background:\s*linear-gradient/);
  assert.match(less, /\.existing-drawer-scene\s*\{[^}]*height:\s*318rpx/);
  assert.match(less, /\.existing-primary\s*\{[^}]*min-height:\s*100rpx[^}]*font-size:\s*32rpx/);
  assert.match(less, /\.existing-contact-compact\s*\{[^}]*width:\s*148rpx[^}]*flex:\s*0 0 148rpx/);
  assert.match(less, /\.existing-designer-proof\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(less, /\.existing-note\s*\{[^}]*background:\s*#eef7f1/);
  assert.match(less, /\.success-archive-title\s*\{[^}]*font-size:\s*48rpx/);
  assert.match(less, /\.success-archive-scene\s*\{[^}]*width:\s*258rpx[^}]*height:\s*282rpx/);
  assert.match(less, /\.success-tertiary-zone\s*\{[^}]*flex:\s*1 0 148rpx/);
  assert.match(less, /\.success-archive-index\s*\{[^}]*width:\s*438rpx/);
  assert.match(less, /\.success-contact-card\s*\{[^}]*background:\s*#ffffff/);
  assert.match(less, /\.success-contact-compact\s*\{[^}]*min-height:\s*72rpx/);
  assert.match(less, /\.success-contact-compact\s*\{[^}]*width:\s*148rpx[^}]*flex:\s*0 0 148rpx/);
  assert.match(less, /\.success-designer-proof\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(less, /\.success-project-action\s*\{[^}]*min-height:\s*100rpx/);
  assert.match(less, /\.claim-success\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.doesNotMatch(wxml, /装修公司|企业名称|enterpriseName|企业选择/);
});

test('referral assets are transparent PNG files within the package limit', () => {
  for (const asset of referralAssets) {
    const assetPath = path.join(miniRoot, 'packages/business/assets/referral-service-v1', asset);
    const bytes = fs.readFileSync(assetPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length <= 300 * 1024, `${asset} exceeds 300KB`);
    assert.ok(bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]), `${asset} must retain transparency`);
  }
});

test('code presenter v2 scan frame is independently packaged, transparent, and within the package limit', () => {
  for (const asset of codePresenterAssets) {
    const assetPath = path.join(miniRoot, 'packages/business/assets/code-presenter-v2', asset);
    const bytes = fs.readFileSync(assetPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length <= 300 * 1024, `${asset} exceeds 300KB`);
    assert.ok(bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]), `${asset} must retain transparency`);
  }
});

test('code presenter v3 artwork is independently packaged, transparent, and within the package limit', () => {
  for (const asset of codePresenterV3Assets) {
    const assetPath = path.join(miniRoot, 'packages/business/assets/code-presenter-v3', asset);
    const bytes = fs.readFileSync(assetPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length <= 300 * 1024, `${asset} exceeds 300KB`);
    assert.ok(bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]), `${asset} must retain transparency`);
  }
});

test('referral service primary copy respects the Mini Program type floor', () => {
  const styles = [
    source('packages/business/promotion-service-code/promotion-service-code.less'),
    source('packages/business/staff-activity-code/staff-activity-code.less'),
    source('packages/business/enterprise-join-codes/enterprise-join-codes.less'),
    source('packages/business/free-design-service/free-design-service.less')
  ].join('\n');
  assert.doesNotMatch(styles, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
  assert.doesNotMatch(styles, /transform:\s*scale\(/);
});
