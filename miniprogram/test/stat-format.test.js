const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const stat = require('../utils/stat-format.wxs');

const root = path.resolve(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('shared WXS statistic formatter compacts counts and money across ranges', () => {
  assert.equal(stat.count(999), '999');
  assert.equal(stat.count(1_500), '1.5千');
  assert.equal(stat.count(50_000), '5万');
  assert.equal(stat.count(1_000_000), '100万');
  assert.equal(stat.money(50_000), '5万元');
  assert.equal(stat.money(100_000), '10万元');
  assert.equal(stat.money(1_000_000), '100万元');
  assert.equal(stat.money(10_000_000), '0.1亿元');
  assert.equal(stat.money(100_000_000_000), '0.1万亿元');
});

test('shared WXS statistic formatter preserves safe fallbacks and rates', () => {
  assert.equal(stat.count('invalid'), '—');
  assert.equal(stat.money(-5), '-5元');
  assert.equal(stat.percent(8.5), '8.5%');
  assert.equal(stat.percent(100), '100%');
  assert.equal(stat.percent('invalid'), '—');
});

test('statistical surfaces use the shared formatter while ledger details remain exact', () => {
  [
    'components/role-workbench/role-workbench.wxml',
    'packages/business/commission-records/commission-records.wxml',
    'packages/business/enterprise-commissions/enterprise-commissions.wxml',
    'packages/business/referrer-workbench/referrer-workbench.wxml',
    'packages/business/measurer-calendar/measurer-calendar.wxml',
    'pages/mine/mine.wxml',
    'pages/ai-design/ai-design.wxml',
    'packages/ai-workflow/scheme-studio/scheme-studio.wxml',
    'packages/ai-workflow/history/ai-design-history.wxml',
    'packages/ai-workflow/result/ai-design-result.wxml',
  ].forEach((relative) => {
    assert.match(source(relative), /stat-format\.wxs/);
  });

  const commissions = source('packages/business/commission-records/commission-records.wxml');
  const enterpriseCommissions = source('packages/business/enterprise-commissions/enterprise-commissions.wxml');
  assert.match(commissions, /stat\.moneyValue\(summary\.pendingAmount\)/);
  assert.match(commissions, /¥ \{\{item\.amountText\}\}/);
  assert.match(enterpriseCommissions, /stat\.money\(totals\.payable\)/);
  assert.match(enterpriseCommissions, /\{\{item\.amountLabel\}\}/);
});
