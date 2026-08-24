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
  'onsite-measurement.png',
  'designer-service.png',
  'phone-authorization.png',
  'designer-matching.png',
  'privacy-lock.png',
  'xiao-k-onboarding-welcome.png',
  'xiao-k-onboarding-recovery.png',
  'xiao-k-spatial-service-guide.png',
  'xiao-k-phone-privacy.png',
  'phone-auth-measure.png',
  'phone-auth-design.png',
  'phone-auth-calendar.png',
  'phone-auth-wechat.png',
  'phone-auth-privacy.png',
];

test('staff activity code reuses the promotion visual language and may show the enterprise name', () => {
  const wxml = source('packages/business/staff-activity-code/staff-activity-code.wxml');
  const js = source('packages/business/staff-activity-code/staff-activity-code.js');
  const less = source('packages/business/staff-activity-code/staff-activity-code.less');

  assert.match(wxml, /免费设计服务/);
  assert.match(wxml, /免费上门量房 · 专业设计师服务/);
  assert.match(wxml, /请客户扫描此码/);
  assert.match(wxml, /分享给客户/);
  assert.doesNotMatch(wxml, /让客户扫码领取/);
  assert.match(wxml, /enterpriseName/);
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(wxml, /mine-icons\/scan\.png/);
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
  assert.match(less, /\.qr-stage\s*\{[\s\S]*width:\s*520rpx/);
  assert.match(less, /\.qr-stage\s*\{[\s\S]*min-height:\s*520rpx/);
  assert.match(less, /@media \(max-width:\s*360px\)[\s\S]*\.qr-stage\s*\{[\s\S]*width:\s*508rpx/);
  assert.match(less, /\.qr-display\s*\{[\s\S]*flex:\s*none/);
  assert.match(less, /\.code-hero\s*\{[\s\S]*flex:\s*1/);
  assert.match(less, /\.service-promises\s*\{[\s\S]*background:\s*#ffffff/);
  assert.match(less, /\.qr-stage\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(less, /\.qr-retry\s*\{[\s\S]*width:\s*auto/);
  assert.match(less, /\.qr-retry\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(less, /\.qr-state-copy\s*\{[\s\S]*font-size:\s*22rpx/);
});

test('enterprise join codes present dual codes with generate, rotate, and disable', () => {
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
  assert.match(wxml, /mine-icons\/scan\.png/);
  assert.doesNotMatch(less, /\.scan-glyph\s*\{[^}]*border:\s*3rpx solid/);
  assert.doesNotMatch(less, /\.share-scan\s*\{[^}]*border:\s*3rpx solid/);
  assert.match(js, /员工入驻码/);
  assert.match(js, /推荐人入驻码/);
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
  assert.match(less, /\.qr-stage\s*\{[\s\S]*width:\s*292rpx/);
  assert.match(less, /\.qr-retry\s*\{[\s\S]*width:\s*auto/);
  assert.match(less, /\.qr-retry\s*\{[\s\S]*max-width:\s*100%/);
});

test('promotion service screen keeps the public presentation anonymous and scanable', () => {
  const wxml = source('packages/business/promotion-service-code/promotion-service-code.wxml');
  const js = source('packages/business/promotion-service-code/promotion-service-code.js');
  const less = source('packages/business/promotion-service-code/promotion-service-code.less');

  assert.match(wxml, /免费设计服务/);
  assert.match(wxml, /免费上门量房 · 专业设计师服务/);
  assert.match(wxml, /请客户扫描此码/);
  assert.match(wxml, /0元服务/);
  assert.match(wxml, /设计师匹配/);
  assert.match(wxml, /分享给客户/);
  assert.doesNotMatch(wxml, /让客户扫码领取/);
  assert.match(wxml, /open-type="share"/);
  assert.match(wxml, /referral-service-v1\/thumbs-up-xiao-k\.png/);
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(wxml, /mine-icons\/scan\.png/);
  assert.doesNotMatch(less, /\.scan-glyph\s*\{[^}]*border:\s*3rpx solid/);
  assert.doesNotMatch(less, /\.share-scan\s*\{[^}]*border:\s*3rpx solid/);
  assert.match(js, /promotion-code\/image/);
  assert.match(js, /free-design-service\/free-design-service\?token=/);
  assert.match(js, /responseType:\s*'arraybuffer'/);
  assert.match(less, /\.qr-stage\s*\{[\s\S]*width:\s*520rpx/);
  assert.match(less, /@media \(max-width:\s*360px\)[\s\S]*\.qr-stage\s*\{[\s\S]*width:\s*508rpx/);
  assert.match(less, /\.qr-display\s*\{[\s\S]*flex:\s*none/);
  assert.match(less, /\.code-hero\s*\{[\s\S]*flex:\s*1/);
  assert.match(less, /\.service-promises\s*\{[\s\S]*background:\s*#ffffff/);
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

test('free design service resolves into phone authorization and renders truthful outcomes', () => {
  const wxml = source('packages/business/free-design-service/free-design-service.wxml');
  const js = source('packages/business/free-design-service/free-design-service.js');
  const less = source('packages/business/free-design-service/free-design-service.less');

  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /允许微信授权手机号/);
  assert.match(wxml, /pageState === 'phoneAuth'/);
  assert.match(wxml, /设计师已为你匹配/);
  assert.match(wxml, /服务档案已建立，后续进度可随时查看/);
  assert.match(wxml, /success-title/);
  assert.match(wxml, /免费量房 · 免费设计/);
  assert.match(wxml, /双重免费权益/);
  assert.match(wxml, /仅用于本次服务联系/);
  assert.match(wxml, /授权后我们会/);
  assert.match(wxml, /确认上门时间与地址/);
  assert.match(wxml, /发送设计师微信/);
  assert.match(wxml, /手机号仅用于本次服务，不公开、不出售/);
  assert.match(wxml, /xiao-k-phone-privacy\.png/);
  assert.match(wxml, /phone-auth-measure\.png/);
  assert.match(wxml, /phone-auth-design\.png/);
  assert.match(wxml, /phone-auth-calendar\.png/);
  assert.match(wxml, /phone-auth-wechat\.png/);
  assert.match(wxml, /phone-auth-privacy\.png/);
  assert.match(wxml, /权益已生效，正在为你匹配合适的设计师/);
  assert.match(wxml, /专业人员上门测量/);
  assert.match(wxml, /设计师沟通方案/);
  assert.match(wxml, /接下来这样进行/);
  assert.match(wxml, /安排上门量房/);
  assert.match(wxml, /围绕户型与需求沟通方案/);
  assert.match(wxml, /查看免费服务档案/);
  assert.match(wxml, /有其他服务需求？补充一下/);
  assert.match(wxml, /查看服务档案<\/button>[\s\S]*查看设计师微信[\s\S]*<view class="service-needs-link"/);
  assert.match(wxml, /xiao-k-spatial-service-guide\.png/);
  assert.doesNotMatch(wxml, /pageState === 'ready'/);
  assert.doesNotMatch(wxml, /一键授权手机号/);
  assert.doesNotMatch(wxml, /我已阅读并同意/);
  for (const asset of referralAssets.slice(1)) {
    if (
      asset === 'designer-matching.png'
      || asset === 'privacy-lock.png'
      || asset === 'phone-authorization.png'
      || asset === 'designer-service.png'
      || asset === 'xiao-k-onboarding-welcome.png'
      || asset === 'xiao-k-onboarding-recovery.png'
    ) {
      continue;
    }
    assert.match(wxml, new RegExp(`referral-service-v1/${asset.replace('.', '\\.')}`));
  }
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/referrals\/authorize-and-create-lead/);
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
  assert.match(wxml, /你已有进行中的服务/);
  assert.match(wxml, /联系当前设计师/);
  assert.match(wxml, /当前服务归属已保留/);
  assert.match(wxml, /thumbs-up-xiao-k\.png/);
  assert.doesNotMatch(wxml, /xiao-k-existing-service\.png/);
  assert.match(wxml, /需求确认/);
  assert.match(wxml, /量房安排/);
  assert.match(wxml, /设计沟通/);
  assert.match(wxml, /clipboard-pen\.png/);
  assert.match(wxml, /success-contact-card/);
  assert.match(wxml, /后续量房预约、户型确认与方案沟通由设计师微信跟进/);
  assert.match(wxml, /查看设计师微信/);
  assert.match(wxml, /设计师联系方式同步中/);
  assert.match(wxml, /查看服务档案/);
  assert.match(wxml, /class="claim-action success-project-action"[\s\S]*查看服务档案<\/button>\s*<button[\s\S]*class="claim-action-outline success-contact-action/);
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
  assert.match(less, /\.auth-benefit-pass\s*\{[^}]*min-height:\s*442rpx[^}]*flex:\s*1\.08 1 auto/);
  assert.match(less, /\.auth-benefit-title\s*\{[^}]*font-size:\s*46rpx/);
  assert.match(less, /\.auth-benefit-item\s*\{[^}]*min-height:\s*132rpx/);
  assert.match(less, /\.auth-privacy-xiaok\s*\{[^}]*width:\s*320rpx[^}]*height:\s*304rpx/);
  assert.match(less, /\.auth-benefit-icon\s*\{[^}]*width:\s*72rpx[^}]*height:\s*72rpx/);
  assert.match(less, /\.auth-purpose-card\s*\{[^}]*min-height:\s*360rpx[^}]*flex:\s*0\.82 1 auto/);
  assert.match(less, /\.claim-pending \.claim-action\s*\{[^}]*margin-top:\s*20rpx/);
  assert.match(less, /\.pending-benefit-hero\s*\{[^}]*min-height:\s*418rpx[^}]*flex:\s*1\.08 1 auto/);
  assert.match(less, /\.pending-benefit-title\s*\{[^}]*font-size:\s*48rpx/);
  assert.match(less, /\.pending-benefit-item\s*\{[^}]*min-height:\s*150rpx/);
  assert.match(less, /\.pending-journey-card\s*\{[^}]*min-height:\s*373rpx[^}]*flex:\s*0\.92 1 auto[^}]*background:\s*#ffffff/);
  assert.match(less, /@media \(max-height:\s*760px\)\s*\{[\s\S]*\.claim-pending\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(less, /@media \(max-height:\s*760px\)\s*\{[\s\S]*\.claim-auth,[\s\S]*overflow-y:\s*auto/);
  assert.match(less, /\.success-title\s*\{[^}]*color:\s*#00c365/);
  assert.match(less, /\.existing-note\s*\{[^}]*background:\s*#f1f5f2/);
  assert.match(less, /\.success-contact-card\s*\{[^}]*background:\s*#ffffff/);
  assert.match(less, /\.success-contact-action\s*\{[^}]*min-height:\s*88rpx/);
  assert.match(less, /\.success-project-action\s*\{[^}]*min-height:\s*88rpx/);
  assert.match(less, /\.claim-success\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.doesNotMatch(wxml, /装修公司|企业名称|enterpriseName|企业选择/);
});

test('Antigravity referral assets are transparent PNG files within the package limit', () => {
  for (const asset of referralAssets) {
    const assetPath = path.join(miniRoot, 'packages/business/assets/referral-service-v1', asset);
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
