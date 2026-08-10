const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.wxss'),
  'utf8'
);
const template = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'business', 'lead-detail', 'lead-detail.wxml'),
  'utf8'
);

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
  assert.doesNotMatch(template, /class="lead-next-action"/);
});
