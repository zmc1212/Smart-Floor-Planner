import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const miniRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/miniprogram/enterprise-commissions/mark-paid/route.ts'),
  'utf8'
);
const adminRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/lead-commissions/mark-paid/route.ts'),
  'utf8'
);
const adminPage = fs.readFileSync(
  path.resolve(__dirname, '../../app/(admin)/(merchant)/lead-commissions/page.tsx'),
  'utf8'
);
const parser = fs.readFileSync(path.resolve(__dirname, '../commission-payment.ts'), 'utf8');

test('Admin and Mini Program confirm final amounts and paid status through the same transaction contract', () => {
  assert.match(miniRoute, /requireMiniProgramEnterpriseAdmin\(context\)/);
  assert.match(miniRoute, /withMiniProgramPostgresTransaction\(context/);
  assert.match(adminRoute, /withTenantTransaction\(enterpriseId/);
  assert.match(miniRoute, /confirmPayments\(enterpriseId, payments, actorId\)/);
  assert.match(adminRoute, /confirmPayments\(enterpriseId, payments, actorId\)/);
  assert.match(parser, /0\.01 至 999999999999\.99/);
  assert.match(parser, /commission_payment_duplicate/);
});

test('Admin payable rows expose one confirmation action with prefilled editable amounts', () => {
  assert.match(adminPage, /record\.status === 'payable' \? \(/);
  assert.match(adminPage, /onClick=\{\(\) => openPayment\(\[record\]\)\}/);
  assert.match(adminPage, /批量确认打款/);
  assert.match(adminPage, /paymentRecords\.map\(\(record, index\)/);
  assert.match(adminPage, /payments: paymentRecords\.map/);
  assert.match(adminPage, /paidAmount: values\.payments\[index\]\.paidAmount/);
  assert.doesNotMatch(adminPage, /openAdjust|submitAdjust|调整金额|确认调整/);
  assert.doesNotMatch(adminPage, /record\.role !== 'referrer'/);
});
