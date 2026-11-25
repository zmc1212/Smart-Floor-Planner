import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReportReading } from '@/lib/construction/report-reading';
import { renderReportPoster } from '@/lib/construction/report-poster';
import type { ReportFacts, ReportProject } from '@/lib/construction/report-scope';
import { bossWeeklyNotebookText, buildBossWeeklyNotebook, renderBossWeeklyNotebook } from '../wechat/weekly-notebook';

function site(id: string, name: string, completed?: string): ReportProject {
  const records = completed ? [{ id, version: 1, hash: '', publishedAt: '2026-11-20T03:00:00.000Z',
    room: '厨房', data: { completed } }] : [];
  return { id, name, stageKey: completed ? 'utilities' : null, weekStageNames: { utilities: '水电' },
    progressRevision: 0, stageEvents: [], stageEventsTruncated: false, records,
    recordsTruncated: false, noPublishedRecords: !records.length };
}

const period = { reportId: '35', revision: 1, periodStart: '2026-11-16T16:00:00Z', periodEnd: '2026-11-23T16:00:00Z' };

test('the boss sheet takes each site’s own current stage and update and only prints known schedule facts', () => {
  const garden = site('a', '云栖花园', '云栖花园厨房线管已铺设。');
  garden.weekSchedule = { available: true, version: 1, color: 'red', label: '落后', nodes: [
    { key: 'overdue', roomName: '客厅', stageName: '水电复核', color: 'red', label: '落后',
      plannedStart: '2026-11-17', plannedEnd: '2026-11-22', completion: 'in_progress' },
    { key: 'next', roomName: '厨房', stageName: '水电验收', color: 'gray', label: '待核实',
      plannedStart: '2026-11-26', plannedEnd: '2026-11-26', completion: 'unknown' },
  ] };
  const quiet = site('b', '下一期工地');
  const note = buildBossWeeklyNotebook({ ...period, projects: [garden, quiet] });
  assert.equal(note.period, '2026.11.17—11.24');
  assert.equal(note.withUpdates, 1);
  assert.equal(note.waitingSchedule, 1);
  assert.equal(note.projects[0].progress, '厨房线管已铺设。');
  assert.equal(note.projects[0].stage, '水电');
  assert.match(note.projects[0].attention, /计划落后 · 客厅水电复核/u);
  assert.match(note.projects[0].next, /11\/26 厨房水电验收/u);
  assert.deepEqual(note.projects[1], { id: 'b', name: '下一期工地', stage: null, progress: '本周暂无新现场记录。',
    attention: '', next: '', late: false });
  assert.match(bossWeeklyNotebookText(note), /下一期工地 · 阶段待确认 · 本周暂无新现场记录。/u);
});

test('the notebook PNG is repeatable and extends to all twenty sites at a fixed width', () => {
  const projects = Array.from({ length: 20 }, (_, index) => site(String(index), `工地${index}号${'长名称'.repeat(8)}`,
    '厨房施工记录内容'.repeat(32)));
  const note = buildBossWeeklyNotebook({ ...period, projects });
  const short = renderBossWeeklyNotebook(buildBossWeeklyNotebook({ ...period, projects: projects.slice(0, 2) }));
  const full = renderBossWeeklyNotebook(note);
  assert.deepEqual(renderBossWeeklyNotebook(note), full);
  assert.equal(full.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(short.readUInt32BE(16), 780);
  assert.equal(full.readUInt32BE(16), 780);
  assert.ok(full.readUInt32BE(20) > short.readUInt32BE(20) + 18 * 70 * 2);
  const text = bossWeeklyNotebookText(note);
  assert.ok(text.length <= 1600);
  for (const project of projects) assert.ok(text.includes(project.name));
  assert.match(text, /完整报告可在小程序「企业日周报」查看。$/u);
});

test('the Mini Program pages share the saved period, counts, site order and published arrangement', async () => {
  const active = site('10', '云栖花园', '云栖花园厨房线管已铺设。');
  active.issues = [{ id: '81', revision: 1, status: 'awaiting_owner', room: '厨房', ownerId: null, ownerName: '',
    recordId: '10', recordVersion: 1, sourceHash: '', eventId: '82', createdAt: period.periodStart, updatedAt: period.periodStart,
    carriedOver: false, text: '等待面板颜色确认', hash: '' }];
  active.arrangements = [{ id: '2', revision: 1, number: 1, issueId: '81', issueRevision: 1,
    title: '复核柜体尺寸', difference: '周四到场复核', room: '厨房', costDeltaCents: 0, scheduleDeltaDays: 0,
    decisionEventId: '84', confirmedAt: '2026-11-20T03:00:00Z', carriedOver: false, hash: '' }];
  const quiet = { ...site('20', '下一期工地'), issues: [] };
  const facts: ReportFacts = { protocol: 'construction-report-facts-v1', projects: [quiet, active], projectsTruncated: false,
    knowledgeStatus: 'not_generated', arrangementsStatus: 'aggregated', issuesStatus: 'aggregated' };
  const input = { ...period, periodEnd: '2026-11-24T16:00:00Z', cutoffAt: '2026-11-24T12:00:00Z',
    kind: 'weekly' as const, audience: 'boss' as const, facts };
  const reading = buildReportReading(input);
  assert.equal(reading.title, '企业工地周报');
  assert.equal(reading.period, '2026.11.17—11.24');
  assert.deepEqual(reading.stats.map(stat => stat.value), ['2', '1', '1']);
  assert.deepEqual(reading.projects.map(project => project.id), ['20', '10']);
  assert.equal(reading.projects[1].progress, '厨房线管已铺设。');
  assert.equal(reading.projects[1].arrangement, '已确认安排 · 复核柜体尺寸 · 周四到场复核');
  assert.equal(buildReportReading(input).key, reading.key);
  const scoped = buildReportReading({ ...input, projectId: '10' });
  assert.deepEqual(scoped.stats.map(stat => stat.value), ['1', '1', '1']);
  assert.notEqual(scoped.key, reading.key);
  const poster = await renderReportPoster({ reading, weekly: true, updatedProjectIds: new Set(['10']) });
  assert.equal(poster.readUInt32BE(16), 780);
  const older = buildReportReading({ ...input, kind: 'daily', facts: { ...facts, projects: [{ ...quiet, issues: undefined }] } });
  assert.equal(older.stats[2].value, '—');
  assert.match(older.projects[0].progress, /当日暂无/u);
});

test('the daily poster supports a quiet day and expands for twenty sites with long records', async () => {
  const facts: ReportFacts = { protocol: 'construction-report-facts-v1', projects: [site('1', '云栖花园')], projectsTruncated: false,
    knowledgeStatus: 'not_generated', arrangementsStatus: 'aggregated', issuesStatus: 'aggregated' };
  const input = { ...period, cutoffAt: '2026-11-24T12:00:00Z', kind: 'daily' as const, audience: 'boss' as const, facts };
  const quiet = { reading: buildReportReading(input), weekly: false, updatedProjectIds: new Set<string>() };
  const small = await renderReportPoster(quiet);
  assert.deepEqual(await renderReportPoster(quiet), small);
  const projects = Array.from({ length: 20 }, (_, index) => site(String(index), `长名称工地${index}号${'端到端'.repeat(8)}`,
    '厨房施工进行中。'.repeat(13)));
  const full = await renderReportPoster({ reading: buildReportReading({ ...input, facts: { ...facts, projects } }),
    weekly: false, updatedProjectIds: new Set(projects.map(project => project.id)) });
  assert.equal(full.readUInt32BE(16), 780);
  assert.ok(full.readUInt32BE(20) > small.readUInt32BE(20) + 1_500);
});
