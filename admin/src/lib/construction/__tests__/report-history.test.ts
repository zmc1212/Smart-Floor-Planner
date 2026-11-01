import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportHistoryFilters, type ReportHistoryFilters } from '../report-history';

test('Shanghai month includes its local first and excludes next local first, including leap/December boundaries', () => {
  for (const [month, start, end] of [
    ['2026-11','2026-10-31T16:00:00.000Z','2026-11-30T16:00:00.000Z'],
    ['2028-02','2028-01-31T16:00:00.000Z','2028-02-29T16:00:00.000Z'],
    ['2026-12','2026-11-30T16:00:00.000Z','2026-12-31T16:00:00.000Z'],
  ]) {
    const filters = reportHistoryFilters({ month });
    assert.equal(filters.start!.toISOString(), start); assert.equal(filters.end!.toISOString(), end);
  }
});
test('existing cursor-only callers retain an unfiltered range; only explicit daily/weekly and exact positive project IDs are accepted', () => {
  assert.deepEqual(reportHistoryFilters(), { projectId: undefined, kind: undefined, start: undefined, end: undefined });
  assert.equal(reportHistoryFilters({ projectId: '248', kind: 'weekly' }).projectId, '248');
  for (const value of [{ month: '' }, { month: '2026-1' }, { month: '2026-13' }, { month: '26-01' }, { month: '0000-01' },
    { kind: 'stage' }, { kind: '' }, { projectId: '0' }, { projectId: '248 OR true' }])
    assert.throws(() => reportHistoryFilters(value as ReportHistoryFilters));
});
