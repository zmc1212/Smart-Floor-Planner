const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');

/**
 * AI workflow Less surfaces covered by the typography-floor plan.
 * Keep in sync with AGENTS.md / miniprogram/DESIGN.md floors.
 */
const AI_WORKFLOW_LESS = [
  'packages/ai-workflow/scheme-studio/scheme-studio.less',
  'components/ai-scheme-composer/ai-scheme-composer.less',
  'pages/ai-design/ai-design.less',
  'packages/ai-workflow/create/ai-design-create.less',
  'packages/ai-workflow/recipe-detail/recipe-detail.less',
  'packages/ai-workflow/recipe-project/recipe-project.less',
  'packages/ai-workflow/recipe-confirm/recipe-confirm.less',
  'packages/ai-workflow/result/ai-design-result.less',
  'packages/ai-workflow/history/ai-design-history.less',
];

/**
 * Acquisition, booking, customer-service, and referrer workflow surfaces.
 * These pages use 22rpx only for supporting information; business/action text
 * is raised by the individual stylesheet to 24rpx or higher where applicable.
 */
const SERVICE_WORKFLOW_LESS = [
  'components/customer-service-home/customer-service-home.less',
  'components/designer-contact-sheet/designer-contact-sheet.less',
  'components/role-workbench/role-workbench.less',
  'packages/business/onboarding/onboarding.less',
  'packages/business/free-design-service/free-design-service.less',
  'packages/business/service-needs/service-needs.less',
  'packages/business/enterprise-register/enterprise-register.less',
  'packages/guides/referrer-guide/referrer-guide.less',
  'packages/guides/enterprise-owner-guide/enterprise-owner-guide.less',
  'packages/guides/designer-guide/designer-guide.less',
  'packages/guides/measurer-guide/measurer-guide.less',
  'packages/business/enterprise-staff/enterprise-staff.less',
  'packages/business/enterprise-referrers/enterprise-referrers.less',
  'packages/business/enterprise-join-codes/enterprise-join-codes.less',
  'packages/business/referrer-workbench/referrer-workbench.less',
  'packages/business/referrer-progress/referrer-progress.less',
  'packages/business/referrer-earnings/referrer-earnings.less',
  'packages/business/staff-earnings/staff-earnings.less',
  'packages/business/enterprise-commissions/enterprise-commissions.less',
  'packages/business/customer-projects/customer-projects.less',
  'packages/business/customer-project/customer-project.less',
  'packages/business/customer-ai-schemes/customer-ai-schemes.less',
  'packages/business/appointment-booking/appointment-booking.less',
  'packages/business/appointment-detail/appointment-detail.less',
  'packages/business/measurer-calendar/measurer-calendar.less',
  'packages/business/enterprise-appointments/enterprise-appointments.less',
  'packages/business/measurer-unavailability/measurer-unavailability.less',
  'packages/platform/devices/devices.less',
  'packages/platform/enterprise-review/enterprise-review.less',
  'packages/platform/enterprise-review-detail/enterprise-review-detail.less',
  'packages/platform/registration-code/registration-code.less',
  'packages/business/promotion-service-code/promotion-service-code.less',
  'packages/business/staff-activity-code/staff-activity-code.less',
  'packages/business/lead-form/lead-form.less',
  'packages/business/lead-detail/lead-detail.less',
  'components/site-photo-grid/site-photo-grid.less',
  'packages/business/commission-records/commission-records.less',
  'packages/business/identity-recovery/identity-recovery.less',
  'packages/business/identity-switch/identity-switch.less',
];

const NON_TEXT_DECORATIVE_SELECTORS = ['area-icon'];

/**
 * Tertiary on-image badges may use exactly 20rpx.
 * Selectors must match one of these patterns (substring after normalize).
 */
const BADGE_20RPX_WHITELIST = [
  'published-badge',
  'waterfall-bookmark',
  'detail-bookmark',
  'photo-status',
  'project-cover text',
  'customer-result-card text',
  'template-zoom-hint',
  'control-badge',
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function selectorForFontSizeAt(source, matchIndex) {
  let depth = 0;
  let brace = -1;
  for (let i = matchIndex; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === '}') depth += 1;
    else if (ch === '{') {
      if (depth === 0) {
        brace = i;
        break;
      }
      depth -= 1;
    }
  }
  if (brace < 0) return '';
  let start = brace - 1;
  while (start >= 0 && source[start] !== '}' && source[start] !== '{') start -= 1;
  return source.slice(start + 1, brace).trim().replace(/\s+/g, ' ');
}

function isWhitelistedBadgeSelector(selector) {
  const normalized = selector.replace(/\s+/g, ' ').trim();
  return BADGE_20RPX_WHITELIST.some((allowed) => {
    if (normalized === allowed || normalized.endsWith(`.${allowed}`)) return true;
    if (normalized.includes(`.${allowed}`) || normalized.includes(allowed)) return true;
    return false;
  });
}

function collectTypographyHits(relativePath) {
  const absolute = path.join(miniRoot, relativePath);
  const raw = fs.readFileSync(absolute, 'utf8');
  const source = stripComments(raw);
  const hits = [];
  const re = /font-size:\s*(\d+)rpx/gi;
  let match;
  while ((match = re.exec(source))) {
    const size = Number(match[1]);
    if (size > 20) continue;
    const selector = selectorForFontSizeAt(source, match.index);
    hits.push({ file: relativePath, size, selector });
  }
  return hits;
}

function collectBelowSize(relativePath, minimum) {
  const absolute = path.join(miniRoot, relativePath);
  const source = stripComments(fs.readFileSync(absolute, 'utf8'));
  const hits = [];
  const re = /font-size:\s*(\d+)rpx/gi;
  let match;
  while ((match = re.exec(source))) {
    const size = Number(match[1]);
    if (size >= minimum) continue;
    const selector = selectorForFontSizeAt(source, match.index);
    if (NON_TEXT_DECORATIVE_SELECTORS.some((allowed) => selector.includes(allowed))) continue;
    hits.push({ file: relativePath, size, selector });
  }
  return hits;
}

test('AI workflow Less has no font-size below 20rpx', () => {
  const belowFloor = [];
  for (const relativePath of AI_WORKFLOW_LESS) {
    assert.ok(
      fs.existsSync(path.join(miniRoot, relativePath)),
      `missing Less file: ${relativePath}`
    );
    for (const hit of collectTypographyHits(relativePath)) {
      if (hit.size < 20) belowFloor.push(hit);
    }
  }
  assert.deepEqual(
    belowFloor,
    [],
    `font-size below 20rpx is forbidden:\n${belowFloor
      .map((h) => `  ${h.file} → ${h.size}rpx (${h.selector || '?'})`)
      .join('\n')}`
  );
});

test('AI workflow 20rpx font-size is limited to tertiary badge whitelist', () => {
  const violations = [];
  for (const relativePath of AI_WORKFLOW_LESS) {
    for (const hit of collectTypographyHits(relativePath)) {
      if (hit.size !== 20) continue;
      if (!isWhitelistedBadgeSelector(hit.selector)) {
        violations.push(hit);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `20rpx allowed only for badge selectors ${BADGE_20RPX_WHITELIST.join(', ')}:\n${violations
      .map((h) => `  ${h.file} → (${h.selector || '?'})`)
      .join('\n')}`
  );
});

test('new service workflow keeps visible text at or above the 22rpx helper floor', () => {
  const violations = [];
  for (const relativePath of SERVICE_WORKFLOW_LESS) {
    assert.ok(
      fs.existsSync(path.join(miniRoot, relativePath)),
      `missing Less file: ${relativePath}`
    );
    violations.push(...collectBelowSize(relativePath, 22));
  }
  assert.deepEqual(
    violations,
    [],
    `new service workflow text below 22rpx is forbidden:\n${violations
      .map((h) => `  ${h.file} → ${h.size}rpx (${h.selector || '?'})`)
      .join('\n')}`
  );
});
