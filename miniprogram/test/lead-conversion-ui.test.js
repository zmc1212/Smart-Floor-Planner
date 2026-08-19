const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const detailJs = fs.readFileSync(
  path.join(root, 'packages', 'business', 'lead-detail', 'lead-detail.js'),
  'utf8'
);
const detailWxml = fs.readFileSync(
  path.join(root, 'packages', 'business', 'lead-detail', 'lead-detail.wxml'),
  'utf8'
);
const detailWxss = fs.readFileSync(
  path.join(root, 'packages', 'business', 'lead-detail', 'lead-detail.less'),
  'utf8'
);

test('lead detail exposes conversion only through server-provided actions', () => {
  assert.match(detailJs, /conversionActions\.canMarkConverted/);
  assert.match(detailJs, /conversionActions\.canRevertConversion/);
  assert.match(detailWxml, /wx:if="\{\{canMarkConverted\}\}"/);
  assert.match(detailWxml, /wx:if="\{\{canRevertConversion\}\}"/);
  assert.match(detailJs, /showInternalConversionDetails:\s*\[[^\]]*'enterprise_admin'[^\]]*'designer'[^\]]*\]\.includes\(staffRole\)/);
  assert.match(detailWxml, /showInternalConversionDetails && lead\.conversionNote/);
});

test('conversion uses dedicated endpoints and preserves the business boundary copy', () => {
  assert.match(detailJs, /\/leads\/\$\{this\.data\.leadId\}\/convert/);
  assert.match(detailJs, /\/leads\/\$\{this\.data\.leadId\}\/revert-conversion/);
  assert.match(detailWxml, /不会自动生成订单、扣款或生成提成记录/);
  assert.match(detailWxml, /mode="date"/);
  assert.match(detailWxml, /maxlength="200"/);
});

test('conversion controls keep readable type and full mobile touch targets', () => {
  assert.match(detailWxss, /\.conversion-primary-action\s*\{[^}]*height:\s*82rpx;/s);
  assert.match(detailWxss, /\.conversion-sheet-primary,[\s\S]*min-height:\s*88rpx;/);
  assert.match(detailWxss, /\.conversion-field-label\s*\{[^}]*font-size:\s*24rpx;/s);
  assert.match(detailWxss, /padding:\s*14rpx 28rpx calc\(28rpx \+ env\(safe-area-inset-bottom\)\)/);
});
