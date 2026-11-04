import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportChoice, reportContext, reportContextProtocol } from '../report-reference';
import { parseReportSelection } from '../report-context';
import { reportFactText } from '@/lib/assistant/agent/report-context';
import { userContent } from '@/lib/assistant/contracts';

const choice = { bindingId: '1', reportId: '2', revision: 3, projectId: '4' };
test('report selection accepts exact locators, never client facts, tenant or recipient authority', () => {
  assert.deepEqual(reportChoice(choice), choice);
  assert.deepEqual(parseReportSelection({ expectedVersion: 0, selection: choice }), { expectedVersion: 0, selection: choice });
  assert.deepEqual(parseReportSelection({ expectedVersion: 1, selection: null }), { expectedVersion: 1, selection: null });
  for (const v of [null, [], { ...choice, enterpriseId: '1454' }, { ...choice, factsHash: 'client' }, { ...choice, revision: 0 },
    { ...choice, projectId: '4 OR true' }, { ...choice, reportId: '9223372036854775808' }]) assert.throws(() => reportChoice(v));
  for (const v of [{ selection: choice }, { expectedVersion: 1 }, { expectedVersion: -1, selection: null },
    { expectedVersion: 1, selection: choice, conversationId: '9' }]) assert.throws(() => parseReportSelection(v));
});
test('a plain entry has no implicit latest-report selection', () => {
  assert.deepEqual(reportContext({ kind: 'lead', id: '4' }), { protocol: reportContextProtocol, revision: 0, selection: null });
  assert.equal(reportContext({ reportContext: { protocol: 'other', revision: 1, selection: choice } }).selection, null);
});
test('message context binds the reviewed selection version without client-supplied facts', () => {
  const message = { version: 1 as const, blocks: [{ type: 'text' as const, text: '厨房还需要我核对什么？' }] };
  assert.deepEqual(userContent(message), message);
  assert.deepEqual(userContent({ ...message, reportContextVersion: 2 }), { ...message, reportContextVersion: 2 });
  for (const value of [0, -1, 1.5, '2', NaN]) assert.throws(() => userContent({ ...message, reportContextVersion: value }));
  assert.throws(() => userContent({ ...message, report: choice }));
});
test('the report model view keeps original facts, cutoff and missing-state distinctions', () => {
  const selection = { ...choice, conversationId: '8', kind: 'daily', periodStart: '2026-10-30T00:00:00Z',
    periodEnd: '2026-10-30T12:00:00Z', cutoffAt: '2026-10-30T12:00:00Z', factsHash: 'saved' };
  const text = reportFactText(selection, { id: '4', name: '合成工地', stageKey: 'electrical', progressRevision: 1,
    stageEvents: [], stageEventsTruncated: false, recordsTruncated: false, noPublishedRecords: false,
    records: [{ id: '10', version: 2, hash: 'original', publishedAt: '2026-10-30T01:00:00Z', room: '厨房',
      data: { title: '合成记录', completed: '仅核对线路走向', pending: '插座位置待本人确认', coordination: '', note: '', photos: [] } }] });
  assert.ok(text.includes('仅核对线路走向') && text.includes('插座位置待本人确认'));
  assert.ok(text.includes('事实截止：2026-10-30 20:00:00（Asia/Shanghai，UTC+08:00）') && text.includes('版本2'));
  assert.ok(text.includes('不是当前施工状态或验收结论') && text.includes('不包含生成正文中的推断') && text.includes('企业工艺须另取有效知识'));
  assert.ok(!text.includes('已确认插座位置'));
});

test('new scheduled weekly input includes in-period stage history and marks bounded facts', () => {
  const selection = { ...choice, conversationId: '8', kind: 'weekly', periodStart: '2026-10-26T00:00:00Z',
    periodEnd: '2026-11-02T00:00:00Z', cutoffAt: '2026-11-02T00:00:00Z', factsHash: 'saved' };
  const project = { id: '4', name: '合成工地', stageKey: 'utilities', progressRevision: 5,
    stageEvents: [
      { id: '1', revision: 1, stageKey: 'design', at: '2026-10-25T00:00:00Z' },
      { id: '2', revision: 2, stageKey: 'demolition', at: '2026-10-26T00:00:00Z' },
      { id: '3', revision: 3, stageKey: 'demolition', at: '2026-10-27T00:00:00Z' },
      { id: '4', revision: 4, stageKey: 'utilities', at: '2026-10-28T00:00:00Z' },
      { id: '5', revision: 5, stageKey: 'carpentry', at: selection.cutoffAt },
    ], stageEventsTruncated: true, recordsTruncated: false, noPublishedRecords: true, records: [] };
  const original = reportFactText(selection, project);
  assert.ok(!original.includes('报告周期内团队标记阶段') && !original.includes('有界读取'));
  const scheduled = reportFactText(selection, project, true);
  const stages = scheduled.split('\n').filter(line => line.startsWith('报告周期内团队标记阶段'));
  assert.deepEqual(stages, [
    '报告周期内团队标记阶段：2026-10-26 08:00:00（Asia/Shanghai，UTC+08:00），demolition。',
    '报告周期内团队标记阶段：2026-10-28 08:00:00（Asia/Shanghai，UTC+08:00），utilities。',
  ]);
  assert.ok(scheduled.includes('本次有界读取未覆盖全部阶段记录。'));
  assert.ok(scheduled.includes('未记录不等于未施工'));
});
