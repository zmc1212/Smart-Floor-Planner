const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.less'),
  'utf8'
);
const template = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.wxml'),
  'utf8'
);

function readPngRgba(filePath) {
  const bytes = fs.readFileSync(filePath);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  let offset = 8;
  const idat = [];
  while (offset < bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    offset += 12 + len;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? out[dst + i - bpp] : 0;
      const up = y > 0 ? out[dst - stride + i] : 0;
      const upLeft = y > 0 && i >= bpp ? out[dst - stride + i - bpp] : 0;
      let val = row[i];
      if (filter === 1) val = (val + left) & 255;
      else if (filter === 2) val = (val + up) & 255;
      else if (filter === 3) val = (val + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        val = (val + pr) & 255;
      }
      out[dst + i] = val;
    }
  }
  return { width, height, colorType, pixels: out };
}

test('formal-surveying tab has a defined surface and does not cover the lead-detail heading', () => {
  assert.match(
    styles,
    /\.whole-home-tab\s*\{[^}]*background:\s*var\(--brand-primary\);/s
  );
  assert.match(
    styles,
    /\.whole-home-card\s*\{[^}]*padding:\s*76rpx 24rpx 24rpx;/s
  );
  assert.doesNotMatch(template, /class="whole-home-title"/);
  assert.match(template, /class="whole-home-next-copy">\{\{nextAction\}\}<\/text>/);
  assert.match(template, /从墙图开始建立客户户型/);
  assert.doesNotMatch(template, /whole-home-plan-name/);
  assert.doesNotMatch(template, /class="lead-next-action"/);
});

test('lead-detail hero extends the green lane to Xiao K and keeps long community copy readable', () => {
  assert.match(template, /class="community-block"/);
  assert.match(template, /class="info community-label">小区/);
  assert.match(template, /class="community-name">\{\{lead\.communityName \|\| '未填写'\}\}/);
  assert.doesNotMatch(template, /小区：\{\{lead\.communityName/);
  assert.match(
    styles,
    /\.detail-hero\s*\{[^}]*background:\s*linear-gradient\(112deg,\s*#0f9f4e 0%,\s*#1fba61 60%,\s*#eef7ed 60%,\s*#f8fbf7 100%\);/s
  );
  assert.match(
    styles,
    /\.detail-hero \.hero-copy\s*\{[^}]*width:\s*48%;[^}]*max-width:\s*360rpx;/s
  );
  assert.match(
    styles,
    /\.detail-hero \.community-name\s*\{[^}]*word-break:\s*break-all;[^}]*overflow-wrap:\s*anywhere;/s
  );
  assert.match(
    styles,
    /\.detail-hero \.eyebrow,\s*\.detail-hero \.title,\s*\.detail-hero \.info,\s*\.detail-hero \.community-name\s*\{[^}]*text-shadow:/s
  );
});

test('lead-detail hero shows the referral source in the formal-survey tab treatment', () => {
  assert.match(
    template,
    /class="hero-referrer">[\s\S]*推荐人：\{\{lead\.referrer\.displayName\}\}/
  );
  assert.match(
    styles,
    /\.hero-referrer\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*height:\s*58rpx;[^}]*border-radius:\s*22rpx 0 22rpx 0;[^}]*background:\s*var\(--brand-primary\);[^}]*color:\s*#fff;[^}]*font-size:\s*24rpx;/s
  );
});

test('lead-detail scene is anchored to its hero instead of covering measurement history', () => {
  assert.match(
    styles,
    /\.detail-hero\s*\{[^}]*position:\s*relative;/s
  );
  assert.match(
    styles,
    /\.lead-detail-scene\s*\{[^}]*position:\s*absolute;[^}]*right:\s*-4rpx;[^}]*bottom:\s*-6rpx;/s
  );
});

test('each historical measurement record opens its own plan while delete remains isolated', () => {
  assert.match(
    template,
    /class="measurement-record[\s\S]*?data-id="\{\{item\._id\}\}"[\s\S]*?bindtap="onHistoryRecordTap"/
  );
  assert.match(template, /class="measurement-record-continue"[^>]*catchtap="onContinueMeasure"/);
  assert.match(template, /class="measurement-record-delete"[^>]*catchtap="onDeleteMeasure"/);
});

test('history records favor the shared project display name over legacy date titles', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.match(script, /projectTitle \|\| plan\.name \|\| '历史正式量房'/);
  assert.match(script, /projectSubtitle,/);
});

test('lead detail removes the legacy acquisition collaboration surface', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.doesNotMatch(template, /acquisition-info|联系家装设计顾问|查看协作记录|designer-contact-sheet|确认已获客/);
  assert.doesNotMatch(script, /onAcquireLead|canAcquireLead|onOpenAcquisition|onOpenDesignerContact/);
  assert.match(script, /const WORKFLOW_STAGES = \['新线索', '量房中', '方案设计', '已签约'\]/);
});

test('formal-survey keeps next-action right of the tab, address on its own row, and paired 84rpx pill CTAs', () => {
  assert.doesNotMatch(template, /class="appointment-entry"/);
  assert.doesNotMatch(template, /class="whole-home-main"/);
  assert.match(template, /class="whole-home-head"/);
  assert.match(template, /class="whole-home-address"/);
  assert.match(template, /class="whole-home-primary-actions"/);
  assert.match(template, /class="whole-home-appointment-action"/);
  assert.match(template, /class="whole-home-measure-action"/);
  assert.match(template, /安排上门量房/);
  assert.match(template, /查看预约/);
  assert.match(template, /\{\{activeFloorPlan \? '继续量房' : '开始量房'\}\}/);
  assert.doesNotMatch(template, /开始量房.*›/);
  assert.match(styles, /\.whole-home-head\s*\{[^}]*justify-content:\s*flex-end;/s);
  assert.match(
    styles,
    /\.whole-home-primary-actions\s*\{[^}]*flex-direction:\s*row;[^}]*gap:\s*16rpx;/s
  );
  assert.match(
    styles,
    /\.whole-home-appointment-action,\s*\.whole-home-measure-action\s*\{[^}]*flex:\s*1;[^}]*width:\s*auto;/s
  );
  assert.match(
    styles,
    /\.whole-home-appointment-action,\s*\.whole-home-measure-action\s*\{[^}]*height:\s*84rpx;[^}]*border-radius:\s*999rpx;/s
  );
  assert.doesNotMatch(
    styles,
    /\.whole-home-primary-actions > \.whole-home-appointment-action \+ \.whole-home-measure-action\s*\{[^}]*margin-left:/s
  );
  assert.match(
    styles,
    /\.whole-home-primary-actions > \.whole-home-appointment-action:only-child,\s*\.whole-home-primary-actions > \.whole-home-measure-action:only-child\s*\{[^}]*width:\s*100%;/s
  );
  assert.match(
    styles,
    /\.whole-home-secondary-actions\s*\{[^}]*grid-template-columns:\s*1fr 1fr;[^}]*gap:\s*16rpx;/s
  );
  assert.match(
    styles,
    /\.whole-home-action\s*\{[^}]*width:\s*100%;[^}]*height:\s*84rpx;[^}]*border-radius:\s*999rpx;/s
  );
  assert.match(styles, /\.conversion-primary-action\s*\{[^}]*height:\s*84rpx;/s);
  const surveyIndex = template.indexOf('class="whole-home-card"');
  const schemesIndex = template.indexOf('class="published-schemes-card"');
  const historyIndex = template.indexOf('class="measurement-history"');
  const conversionIndex = template.indexOf('class="conversion-card"');
  assert.ok(surveyIndex > -1);
  assert.ok(schemesIndex > surveyIndex);
  assert.ok(historyIndex > schemesIndex);
  assert.ok(conversionIndex > historyIndex);
});

test('designer and enterprise owner AI design CTA appears on open leads without requiring survey or published schemes', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.match(script, /function canOpenAIDesignWorkbench\(/);
  assert.match(script, /\['designer', 'enterprise_admin'\]\.includes\(staffRole\)/);
  assert.match(script, /function eligibleAIDesignFloorPlanId\(/);
  assert.match(script, /plan\.status !== 'completed'/);
  assert.match(script, /可用现场图开始出图/);
  assert.doesNotMatch(script, /return lead\.serviceStage === 'survey_completed';/);
  assert.match(script, /POST_SURVEY_SERVICE_STAGES = new Set\(\[\s*'survey_completed',\s*'converted',\s*'closed',\s*\]\)/);
  assert.doesNotMatch(script, /POST_SURVEY_SERVICE_STAGES[\s\S]{0,80}design_published/);
  assert.match(script, /canOpenAIDesign: canOpenAIDesignWorkbench\(lead, staffRole\)/);
  assert.match(script, /if \(!this\.data\.canOpenAIDesign\) return;/);
  assert.match(script, /floorPlanId: eligibleAIDesignFloorPlanId\(/);
  assert.match(template, /wx:if="\{\{publishedSchemes\.length > 0 \|\| canOpenAIDesign\}\}"/);
  assert.match(template, /wx:if="\{\{canOpenAIDesign\}\}"[\s\S]*?进入 AI 设计/);
  assert.match(template, /\{\{aiDesignEmptyHint\}\}/);
});

test('enterprise owner and assigned designer have the lead-detail surveying action set', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.match(script, /function canEditLeadMeasurements\(/);
  assert.match(
    script,
    /staffRole === 'designer' && staffIdOf\(lead\.assignedTo\) === staffId/
  );
  assert.match(script, /canEditMeasurements: canEditLeadMeasurements\(/);
  assert.doesNotMatch(script, /enterprise_admin[\s\S]{0,100}查看量房进度与服务安排/);
  assert.match(template, /wx:if="\{\{canEditMeasurements\}\}"[\s\S]*?开始量房/);
  assert.match(template, /wx:if="\{\{canEditMeasurements && activeFloorPlan\}\}"[\s\S]*?新增量房[\s\S]*?删除/);
});

test('published-scheme CTAs share one equal-width row when both are visible', () => {
  assert.match(template, /class="published-schemes-actions"/);
  assert.match(
    template,
    /class="published-schemes-actions"[\s\S]*?查看全部方案[\s\S]*?进入 AI 设计/
  );
  assert.match(
    styles,
    /\.published-schemes-actions\s*\{[^}]*flex-direction:\s*row;[^}]*gap:\s*16rpx;/s
  );
  assert.match(
    styles,
    /\.published-schemes-secondary,\s*\.published-schemes-primary\s*\{[^}]*flex:\s*1;[^}]*width:\s*auto;/s
  );
  assert.match(
    styles,
    /\.published-schemes-actions > \.published-schemes-secondary \+ \.published-schemes-primary\s*\{[^}]*margin-left:\s*16rpx;/s
  );
  assert.match(
    styles,
    /\.published-schemes-secondary,\s*\.published-schemes-primary\s*\{[^}]*font-size:\s*26rpx;[^}]*white-space:\s*nowrap;/s
  );
});

test('formal-survey address row stays full-width below the next-action head', () => {
  assert.match(styles, /\.whole-home-address\s*\{[^}]*display:\s*block;/s);
  assert.doesNotMatch(styles, /\.appointment-entry\s*\{/);
});

test('lead detail shows assigned designer and measurer name and phone between the hero and stage rail', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  const heroIndex = template.indexOf('class="detail-hero"');
  const staffIndex = template.indexOf('class="staff-assignment-grid"');
  const railIndex = template.indexOf('class="lead-stage-rail"');
  assert.ok(heroIndex > -1);
  assert.ok(staffIndex > heroIndex);
  assert.ok(railIndex > staffIndex);
  assert.match(template, /class="staff-assignment-role">家装设计顾问/);
  assert.match(template, /class="staff-assignment-role">家装现场顾问/);
  assert.match(template, /\{\{designerContact\.assignLabel\}\}/);
  assert.match(template, /\{\{measurerContact\.assignLabel\}\}/);
  assert.match(styles, /\.staff-assignment-head\s*\{[^}]*justify-content:\s*space-between;/s);
  assert.match(styles, /\.staff-assignment-action\s*\{[^}]*font-size:\s*24rpx;/s);
  assert.match(template, /\{\{designerContact\.name\}\}/);
  assert.match(template, /\{\{measurerContact\.name\}\}/);
  assert.match(template, /\{\{designerContact\.phone\}\}/);
  assert.match(template, /\{\{measurerContact\.phone\}\}/);
  assert.match(script, /function getStaffContact\(/);
  assert.match(script, /assignmentActions/);
  assert.match(script, /canAssignDesigner/);
  assert.match(script, /canAssignMeasurer/);
  assert.match(script, /wx\.makePhoneCall\(\{ phoneNumber: phone \}\)/);
  assert.match(script, /name: name \|\| '待分配'/);
  assert.match(styles, /\.staff-assignment-role\s*\{[^}]*font-size:\s*22rpx;/s);
  assert.match(styles, /\.staff-assignment-name\s*\{[^}]*font-size:\s*26rpx;/s);
  assert.match(styles, /\.staff-assignment-phone\s*\{[^}]*font-size:\s*24rpx;/s);
  assert.match(
    template,
    /staff-assignment-phone sfp-icon-action[\s\S]*\{\{designerContact\.phone\}\}[\s\S]*\/images\/leads-v4\/phone\.png/
  );
  assert.match(
    template,
    /staff-assignment-phone sfp-icon-action[\s\S]*\{\{measurerContact\.phone\}\}[\s\S]*\/images\/leads-v4\/phone\.png/
  );
  assert.doesNotMatch(
    template,
    /staff-assignment-phone sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png[\s\S]*\{\{designerContact\.phone\}\}/
  );
});

test('lead-detail hero pins profile edit and dials customer phone with packaged icons', () => {
  assert.match(
    template,
    /class="profile-edit-action sfp-icon-action"[\s\S]*\/images\/mine-icons\/edit\.png[\s\S]*补充资料/
  );
  assert.match(
    styles,
    /\.profile-edit-action\s*\{[^}]*position:\s*absolute;[^}]*top:\s*20rpx;[^}]*right:\s*20rpx;[^}]*z-index:\s*3;/s
  );
  assert.match(styles, /\.profile-edit-action\s*\{[^}]*font-size:\s*24rpx;/s);
  assert.doesNotMatch(template, /lead-status-summary[\s\S]*profile-edit-action/);
  assert.match(
    template,
    /class="hero-phone sfp-icon-action"[\s\S]*catchtap="onCallStaff"[\s\S]*class="info hero-phone-number">手机：\{\{lead\.phone\}\}[\s\S]*\/images\/leads-v4\/phone\.png/
  );
  assert.doesNotMatch(
    template,
    /class="hero-phone sfp-icon-action"[\s\S]*\/images\/leads-v4\/phone\.png[\s\S]*hero-phone-number/
  );
  assert.match(
    styles,
    /\.detail-hero \.hero-phone\s*\{[^}]*justify-content:\s*flex-start;/s
  );
  assert.match(
    styles,
    /\.detail-hero \.hero-phone-number\s*\{[^}]*flex:\s*none;/s
  );
  assert.match(template, /data-phone="\{\{lead\.phone\}\}"/);
  assert.match(template, /class="info hero-phone-number">手机：\{\{lead\.phone\}\}/);

  const phonePng = readPngRgba(
    path.join(__dirname, '..', 'images', 'leads-v4', 'phone.png')
  );
  assert.equal(phonePng.colorType, 6);
  assert.equal(phonePng.pixels[3], 0, 'hero phone icon corner must be transparent');
  let opaqueGlyph = 0;
  for (let i = 0; i < phonePng.pixels.length; i += 4) {
    if (phonePng.pixels[i + 3] > 200 && phonePng.pixels[i] < 180) opaqueGlyph += 1;
  }
  assert.ok(opaqueGlyph > 20, 'hero phone icon must keep an opaque handset glyph');
});

test('lead detail embeds the site photo gallery below the formal survey card', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.match(template, /房屋现场图/);
  assert.match(template, /site-photo-grid/);
  assert.match(template, /先选房间再拍/);
  assert.match(script, /sitePhotoService/);
  assert.match(script, /loadSitePhotos/);
});
