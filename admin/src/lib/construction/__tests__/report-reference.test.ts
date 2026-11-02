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
  assert.ok(text.includes(selection.cutoffAt) && text.includes('版本2'));
  assert.ok(text.includes('不是当前施工状态或验收结论') && text.includes('不包含生成正文中的推断') && text.includes('企业工艺须另取有效知识'));
  assert.ok(!text.includes('已确认插座位置'));
});
