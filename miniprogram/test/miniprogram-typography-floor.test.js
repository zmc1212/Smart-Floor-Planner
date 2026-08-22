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
