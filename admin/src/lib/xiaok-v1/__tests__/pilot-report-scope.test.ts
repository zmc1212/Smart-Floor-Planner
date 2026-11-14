import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computePilotReportScope } from '../pilot-report-scope';

// A. 企业周报无项目限制时返回全部试点项目，试点范围仍是上限。
test('A. an empty enterprise report filter returns every pilot project', () => {
  const result = computePilotReportScope({ pilotProjectIds: ['101', '205'], reportProjectIds: [] });

  assert.deepEqual(result, { projectIds: ['101', '205'], status: 'active',
    pilotScopeApplied: true, reportFilterApplied: false });
});

// B. 企业限制项目与试点部分重叠时只返回交集。
test('B. a partial enterprise filter returns the intersection', () => {
  const result = computePilotReportScope({
    pilotProjectIds: ['101', '205', '306'],
    reportProjectIds: ['205', '306', '409'],
  });

  assert.deepEqual(result, { projectIds: ['205', '306'], status: 'active',
    pilotScopeApplied: true, reportFilterApplied: true });
});

// C. 完全不重叠时返回 empty，不回退全企业。
test('C. no overlap returns empty without expanding to the enterprise', () => {
  const result = computePilotReportScope({
    pilotProjectIds: ['101', '205'],
    reportProjectIds: ['306'],
  });

  assert.deepEqual(result, { projectIds: [], status: 'empty',
    pilotScopeApplied: true, reportFilterApplied: true });
});

// D. 试点范围为空时无论企业筛选如何都返回 empty。
test('D. an empty pilot scope returns empty', () => {
  assert.deepEqual(computePilotReportScope({ pilotProjectIds: [], reportProjectIds: [] }), {
    projectIds: [], status: 'empty', pilotScopeApplied: true, reportFilterApplied: false,
  });
  assert.deepEqual(computePilotReportScope({ pilotProjectIds: [], reportProjectIds: ['101'] }), {
    projectIds: [], status: 'empty', pilotScopeApplied: true, reportFilterApplied: true,
  });
});

// E. 两个输入中的重复 ID 都去重。
test('E. duplicate project ids are removed', () => {
  const result = computePilotReportScope({
    pilotProjectIds: ['101', '101', '205', '205'],
    reportProjectIds: ['205', '205', '205'],
  });

  assert.deepEqual(result.projectIds, ['205']);
  assert.equal(result.status, 'active');
});

// F. 非法项目 ID 按现有正 bigint 字符串格式拒绝。
test('F. invalid project ids are rejected', () => {
  for (const value of ['0', '001', '101.0', '-1', '', ' 101', 'abc', '99999999999999999999']) {
    assert.throws(() => computePilotReportScope({ pilotProjectIds: [value], reportProjectIds: [] }),
      { code: 'invalid_message', status: 422 });
    assert.throws(() => computePilotReportScope({ pilotProjectIds: [], reportProjectIds: [value] }),
      { code: 'invalid_message', status: 422 });
  }
  assert.throws(() => computePilotReportScope({
    pilotProjectIds: ['101', 101 as unknown as string], reportProjectIds: [],
  }), { code: 'invalid_message', status: 422 });
  assert.throws(() => computePilotReportScope({
    pilotProjectIds: '101' as unknown as string[], reportProjectIds: [],
  }), { code: 'pilot_report_scope_invalid', status: 422 });
});

// G. 不修改输入数组，并返回新的项目数组。
test('G. the input arrays are not modified', () => {
  const pilotProjectIds = Object.freeze(['101', '205', '101']);
  const reportProjectIds = Object.freeze(['205', '306']);

  const result = computePilotReportScope({ pilotProjectIds, reportProjectIds });

  assert.deepEqual([...pilotProjectIds], ['101', '205', '101']);
  assert.deepEqual([...reportProjectIds], ['205', '306']);
  assert.notEqual(result.projectIds, pilotProjectIds);
  assert.deepEqual(result.projectIds, ['205']);
});

// H. 输出顺序固定为试点输入顺序，重复调用稳定。
test('H. output order follows the pilot scope and stays stable', () => {
  const input = { pilotProjectIds: ['306', '205', '101'], reportProjectIds: ['101', '306', '205'] };

  const first = computePilotReportScope(input);
  const second = computePilotReportScope(input);
  const reorderedFilter = computePilotReportScope({
    ...input, reportProjectIds: ['205', '306', '101'],
  });

  assert.deepEqual(first.projectIds, ['306', '205', '101']);
  assert.deepEqual(second.projectIds, first.projectIds);
  assert.deepEqual(reorderedFilter.projectIds, first.projectIds);
  assert.deepEqual(computePilotReportScope({
    pilotProjectIds: ['306', '205', '101'], reportProjectIds: ['101', '205'],
  }).projectIds, ['205', '101']);
});
