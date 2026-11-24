import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWechatReportSummary } from '../wechat/reports';

test('微信角色周报摘要包含企业工地总数和重点', () => {
  const text = buildWechatReportSummary({
    periodStart: '2026-11-16T00:00:00.000Z', periodEnd: '2026-11-22T00:00:00.000Z',
    facts: { projects: [
      { id: 'p1', name: '云栖花园', stageName: '水电施工', records: [{ room: '厨房', data: { completed: '线管已铺设' } }] },
      { id: 'p2', name: '江畔雅居', stageName: '泥木施工', records: [{ room: '客厅', data: { completed: '吊顶已完成' } }] },
    ] },
    weeklyReport: {
      summary: '本周共2个项目；计划状态已汇总。',
      sections: [{ label: '授权范围内项目总览', lines: [{ text: '云栖花园 · 水电施工 · 现场记录1条' }, { text: '江畔雅居 · 泥木施工 · 现场记录1条' }] }],
      exceptions: ['江畔雅居 · 需要确认施工计划'],
    },
  }, 'weekly', 'boss');
  assert.ok(text);
  assert.match(text, /本周共2个项目/);
  assert.match(text, /云栖花园/);
  assert.match(text, /江畔雅居/);
  assert.match(text, /完整报告可在小程序/);
});

test('微信业主日报摘要标明工地并保留已保存正文', () => {
  const text = buildWechatReportSummary({
    periodStart: '2026-11-24T00:00:00.000Z', periodEnd: '2026-11-24T00:00:00.000Z',
    facts: { projects: [{ id: 'p1', name: '云栖花园', stageName: '水电施工', records: [] }] },
    body: [{ projectId: 'p1', progress: [{ text: '插座点位已按现场记录复核。', citationStatus: 'verified' }], pending: [], arrangements: [] }],
  }, 'daily', 'customer');
  assert.ok(text);
  assert.match(text, /云栖花园/);
  assert.match(text, /插座点位已按现场记录复核/);
  assert.doesNotMatch(text, /暂无可展示/);
  assert.match(text, /完整报告可在小程序/);
});

test('微信施工角色周报摘要覆盖本人参与的多个工地', () => {
  const text = buildWechatReportSummary({
    facts: { projects: [
      { id: 'p1', name: '云栖花园', stageName: '水电施工', records: [{ data: {} }] },
      { id: 'p2', name: '江畔雅居', stageName: '泥木施工', records: [{ data: {} }, { data: {} }] },
    ] },
    weeklyReport: { summary: '本周云栖花园有待处理任务。', sections: [], exceptions: [] },
  }, 'weekly', 'worker');
  assert.ok(text);
  assert.match(text, /云栖花园 · 水电施工 · 现场记录1条/);
  assert.match(text, /江畔雅居 · 泥木施工 · 现场记录2条/);
});

test('微信摘要超长时不截断正文链接', () => {
  const text = buildWechatReportSummary({
    facts: { projects: [{ id: 'p1', name: '云栖花园', stageName: '水电施工', records: [] }] },
    body: [{ projectId: 'p1', progress: Array.from({ length: 40 }, (_, index) => ({ text: `重点${index}：${'现场进展'.repeat(40)}`, citationStatus: 'verified' })), pending: [], arrangements: [] }],
  }, 'daily', 'customer');
  assert.ok(text);
  assert.ok(text.length <= 1600);
  assert.match(text, /完整报告可在小程序「工地日报与周报」查看。$/u);
});
