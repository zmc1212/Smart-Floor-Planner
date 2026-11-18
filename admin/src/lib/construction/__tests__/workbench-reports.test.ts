import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReportRange, reportStatus, reportTitle, shanghaiToday } from '../workbench-reports';

test('worker report range defaults to Shanghai today and accepts a bounded explicit range', () => {
  const now = new Date('2026-11-18T15:30:00.000Z');
  assert.equal(shanghaiToday(now), '2026-11-18');
  assert.deepEqual(parseReportRange(undefined, undefined, now), { from: '2026-11-18', to: '2026-11-18' });
  assert.deepEqual(parseReportRange('2026-11-01', '2026-11-18', now), { from: '2026-11-01', to: '2026-11-18' });
  assert.throws(() => parseReportRange('2026-11-18', '2026-11-01', now), /invalid_construction/);
  assert.throws(() => parseReportRange('2026-01-01', '2026-11-18', now), /invalid_construction/);
  assert.throws(() => parseReportRange('2026-11-18', undefined, now), /invalid_construction/);
});

test('worker report status labels reuse the existing record statuses', () => {
  assert.deepEqual(reportStatus('organizing'), { code: 'pending', label: '待审核' });
  assert.deepEqual(reportStatus('draft'), { code: 'pending', label: '待审核' });
  assert.deepEqual(reportStatus('published'), { code: 'approved', label: '审核通过' });
  assert.deepEqual(reportStatus('changes_requested'), { code: 'returned', label: '需补充' });
  assert.deepEqual(reportStatus('withdrawn'), { code: 'withdrawn', label: '已撤回' });
});

test('worker report title falls back to photo or voice counts without inventing a title', () => {
  assert.equal(reportTitle('客厅线管铺设', 3, true), '客厅线管铺设');
  assert.equal(reportTitle('', 3, false), '现场照片 · 3张');
  assert.equal(reportTitle(null, 0, true), '语音上报');
  assert.equal(reportTitle('', 0, false), '现场上报');
});
