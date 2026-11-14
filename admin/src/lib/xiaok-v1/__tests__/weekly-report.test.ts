import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWeeklyDigest, weeklyReportDedupeKey, weeklySnapshotVersion, type WeeklyProjectFacts } from '../weekly-report';

function project(id: string, overrides: Partial<WeeklyProjectFacts> = {}): WeeklyProjectFacts {
  return {
    projectId: id, projectName: '工地' + id,
    stageId: 'utilities', stageKey: 'utilities', stageName: '水电',
    stageEnteredAt: '2026-11-09T09:00:00+08:00', stageEventId: 'e' + id, nextStageName: '泥木',
    plan: { available: true, version: 2, color: 'yellow', label: '正常', nodes: [
      { key: 'n1', roomName: '卫生间', stageName: '水电', color: 'yellow', label: '正常', plannedStart: '2026-11-08', plannedEnd: '2026-11-16', completion: 'in_progress' },
      { key: 'n2', roomName: '厨房', stageName: '水电', color: 'green', label: '提前', plannedStart: '2026-11-08', plannedEnd: '2026-11-15', completion: 'completed', completedAt: '2026-11-12T10:00:00+08:00' },
    ] },
    records: [{ id: 'r1', version: 3, room: '卫生间', publishedAt: '2026-11-12T18:00:00+08:00', completed: '管线布置完成', pending: '', coordination: '' }],
    issues: [{ id: 'i1', status: 'awaiting_review', title: '厨房插座待复核', room: '厨房', createdAt: '2026-11-12T09:00:00+08:00' }],
    arrangements: [{ id: 'a1', title: '客厅点位确认', room: '客厅', confirmedAt: '2026-11-11T10:00:00+08:00' }],
    pending: {
      ownerConfirmations: [{ id: 'c1', title: '确认主卧开关位置' }],
      designerReviews: [{ id: 'd1', title: '核对厨房图纸' }],
      workerTasks: [{ id: 'w1', title: '补拍卫生间管线' }],
      missingMaterials: [{ id: 'm1', title: '补传水电材料单' }],
    },
    ...overrides,
  };
}

const generatedAt = '2026-11-17T08:00:00+08:00';
const period = { periodStart: '2026-11-10T00:00:00+08:00', periodEnd: '2026-11-17T00:00:00+08:00' };

test('four roles receive the required role-specific sections from the same facts', () => {
  const owner = buildWeeklyDigest({ enterpriseId: '1454', role: 'owner', recipientId: '1', generatedAt, ...period, projects: [project('101')] });
  assert.deepEqual(owner.sections.map(item => item.label), ['本周施工进展', '当前装修阶段', '本周完成的事项', '目前正在处理的事项',
    '需要你确认的需求或事项', '当前问题和整改情况', '下周需要关注的事项', '重要资料和现场照片']);
  const designer = buildWeeklyDigest({ enterpriseId: '1454', role: 'designer', recipientId: '2', generatedAt, ...period, projects: [project('101')] });
  assert.deepEqual(designer.sections.map(item => item.label), ['本周需求变化', '待核对图纸和方案', '待完善的设计意见',
    '设计相关问题', '需要确认的版本', '已完成核对', '下周设计工作']);
  const boss = buildWeeklyDigest({ enterpriseId: '1454', role: 'boss', recipientId: '4', generatedAt, ...period, projects: [project('101'), project('102')] });
  assert.deepEqual(boss.sections.map(item => item.label), ['授权范围内项目总览', '各项目当前阶段', '提前、正常、落后三种计划状态',
    '本周新增问题', '待整改问题', '已整改待复核', '已修正问题', '需要老板介入的例外', '下周重点事项']);
  assert.equal(boss.contract.projectId, null);
  assert.equal(boss.contract.sourceRefs.length > 0, true);
  const worker = buildWeeklyDigest({ enterpriseId: '1454', role: 'worker', recipientId: '3', generatedAt, ...period, projects: [project('101')] });
  assert.deepEqual(worker.sections.map(item => item.label), ['本周负责项目和施工任务', '已提交的现场记录', '已处理事项',
    '尚未完成事项', '待补充的资料', '需要配合的下一步工作']);
});

test('roles never contradict the shared stage and plan facts', () => {
  const source = project('101');
  const roleReports = (['owner', 'designer', 'boss', 'worker'] as const).map(role =>
    buildWeeklyDigest({ enterpriseId: '1454', role, recipientId: '1', generatedAt, ...period, projects: [source] }));
  for (const report of roleReports) {
    assert.equal(report.contract.sourceSnapshotVersion, weeklySnapshotVersion([source]));
    const text = report.sections.flatMap(section => section.lines.map(line => line.text)).join('\n');
    assert.match(text, /水电/u);
    assert.doesNotMatch(text, /泥木阶段已完成/u);
  }
});

test('weekly reports are idempotent per recipient and period and keep a source snapshot', () => {
  const input = { enterpriseId: '1454', role: 'owner' as const, recipientId: '1', projectId: '101', ...period };
  assert.equal(weeklyReportDedupeKey(input), weeklyReportDedupeKey({ ...input }));
  assert.notEqual(weeklyReportDedupeKey(input), weeklyReportDedupeKey({ ...input, periodEnd: '2026-11-18T00:00:00+08:00' }));
  const first = buildWeeklyDigest({ ...input, generatedAt, projects: [project('101')] });
  const second = buildWeeklyDigest({ ...input, generatedAt, projects: [project('101')] });
  assert.equal(first.contract.reportId, second.contract.reportId);
  assert.equal(first.contract.sourceSnapshotVersion, second.contract.sourceSnapshotVersion);
  const changed = buildWeeklyDigest({ ...input, generatedAt, projects: [project('101', { stageName: '泥木', stageKey: 'masonry_carpentry', stageId: 'masonry' })] });
  assert.notEqual(first.contract.sourceSnapshotVersion, changed.contract.sourceSnapshotVersion);
});

test('a missing plan stays gray and no workload-free percentage is produced', () => {
  const report = buildWeeklyDigest({ enterpriseId: '1454', role: 'boss', recipientId: '4', generatedAt, ...period,
    projects: [project('101', { plan: null })] });
  const text = report.sections.flatMap(section => section.lines.map(line => line.text)).join('\n');
  assert.match(text, /未排期|待核实/u);
  assert.doesNotMatch(text, /完成度\s*\d+%/u);
  assert.ok(report.exceptions.some(item => item.includes('尚未发布施工计划')));
});

test('empty authorized scope produces an explicit empty report instead of invented facts', () => {
  const report = buildWeeklyDigest({ enterpriseId: '1454', role: 'boss', recipientId: '4', generatedAt, ...period, projects: [] });
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].emptyText, '当前授权范围内没有可用项目。');
  assert.equal(report.contract.projectId, null);
});
