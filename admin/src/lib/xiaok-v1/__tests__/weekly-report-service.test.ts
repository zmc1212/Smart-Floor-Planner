import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReportFacts, ReportProject } from '@/lib/construction/report-scope';
import { buildRoleWeeklyDigest } from '../weekly-report-service';

const hash = 'a'.repeat(64);
function project(id: string, overrides: Partial<ReportProject> = {}): ReportProject {
  return {
    id, name: '工地' + id, stageKey: 'utilities', stageName: '水电', progressRevision: 3,
    weekStageNames: { utilities: '水电' }, stageEvents: [{ id: 'e' + id, revision: 3, stageKey: 'utilities', at: '2026-11-09T09:00:00+08:00' }],
    stageEventsTruncated: false, recordsTruncated: false, noPublishedRecords: false,
    weekSchedule: { available: true, version: 2, color: 'yellow', label: '正常', nodes: [
      { key: 'n1', roomName: '卫生间', stageName: '水电', color: 'yellow', label: '正常', plannedStart: '2026-11-08', plannedEnd: '2026-11-16', completion: 'in_progress' },
    ] },
    records: [{ id: 'r1', version: 2, hash, publishedAt: '2026-11-12T18:00:00+08:00', room: '卫生间',
      data: { completed: '管线布置完成', pending: '', coordination: '' } }],
    issues: [{ id: 'i1', revision: 2, status: 'awaiting_review', room: '厨房', ownerId: '2', ownerName: '设计师',
      recordId: 'r1', recordVersion: 2, sourceHash: hash, eventId: 'e1', createdAt: '2026-11-12T09:00:00+08:00',
      updatedAt: '2026-11-13T09:00:00+08:00', carriedOver: false, text: '厨房插座待复核', hash }],
    arrangements: [{ id: 'a1', revision: 1, number: 1, issueId: 'i1', issueRevision: 2, title: '客厅点位确认', difference: '调整', room: '客厅',
      costDeltaCents: 0, scheduleDeltaDays: 0, decisionEventId: 'd1', confirmedAt: '2026-11-11T10:00:00+08:00', carriedOver: false, hash }],
    ...overrides,
  };
}
function facts(projects: ReportProject[]): ReportFacts {
  return { protocol: 'construction-report-facts-v1', projects, projectsTruncated: false, knowledgeStatus: 'not_generated',
    arrangementsStatus: 'aggregated', issuesStatus: 'aggregated' };
}
const report = { id: '77', revision: 2, period_start: '2026-11-10T00:00:00+08:00', period_end: '2026-11-17T00:00:00+08:00',
  generated_at: '2026-11-17T08:00:00+08:00', facts_hash: hash, delivery_state: 'delivered' };

test('owner weekly digest only uses customer-published record items', () => {
  const ownerProject = project('101', {
    publishedRecordItems: [{ recordId: 'r1', recordVersion: 2, sourceHash: hash, publishedAt: '2026-11-12T18:00:00+08:00',
      room: '卫生间', pending: '等待业主确认检修口位置', coordination: '需要业主到场确认', carriedOver: false }],
  });
  const digest = buildRoleWeeklyDigest({ facts: facts([ownerProject]), binding: { enterprise_id: '1454', user_id: '1', admin_id: null, audience: 'customer' }, report });
  assert.ok(digest);
  assert.equal(digest.contract.recipientRole, 'owner');
  assert.equal(digest.contract.projectId, '101');
  assert.equal(digest.contract.sourceSnapshotVersion, hash);
  assert.equal(digest.contract.reportVersion, 2);
  assert.equal(digest.contract.deliveryStatus, 'delivered');
  assert.equal(digest.sections.length, 8);
  const text = digest.sections.flatMap(section => section.lines.map(line => line.text)).join('\n');
  assert.match(text, /等待业主确认检修口位置/u);
  assert.match(text, /需要业主到场确认/u);
  assert.doesNotMatch(text, /厨房插座待复核/u);
});

test('designer and worker digests use only their assigned items', () => {
  const designer = buildRoleWeeklyDigest({ facts: facts([project('101')]),
    binding: { enterprise_id: '1454', user_id: null, admin_id: '2', audience: 'designer' }, report });
  assert.ok(designer);
  assert.equal(designer.contract.recipientRole, 'designer');
  assert.match(designer.sections.flatMap(section => section.lines.map(line => line.text)).join('\n'), /厨房插座待复核/u);
  const worker = buildRoleWeeklyDigest({ facts: facts([project('101')]),
    binding: { enterprise_id: '1454', user_id: null, admin_id: '3', audience: 'worker' }, report });
  assert.ok(worker);
  assert.equal(worker.contract.recipientRole, 'worker');
  assert.doesNotMatch(worker.sections.flatMap(section => section.lines.map(line => line.text)).join('\n'), /厨房插座待复核/u);
});

test('boss weekly digest is cross-project and keeps the shared plan facts', () => {
  const digest = buildRoleWeeklyDigest({ facts: facts([project('101'), project('102')]),
    binding: { enterprise_id: '1454', user_id: null, admin_id: '4', audience: 'boss' }, report });
  assert.ok(digest);
  assert.equal(digest.contract.projectId, null);
  assert.equal(digest.sections.length, 9);
  const text = digest.sections.flatMap(section => section.lines.map(line => line.text)).join('\n');
  assert.match(text, /工地101/u);
  assert.match(text, /工地102/u);
  assert.match(text, /水电/u);
});

test('old weekly facts without a schedule snapshot stay unknown instead of fabricating colors', () => {
  const digest = buildRoleWeeklyDigest({ facts: facts([project('101', { weekSchedule: undefined })]),
    binding: { enterprise_id: '1454', user_id: null, admin_id: '4', audience: 'boss' }, report });
  assert.ok(digest);
  const text = digest.sections.flatMap(section => section.lines.map(line => line.text)).join('\n');
  assert.match(text, /未排期|待核实/u);
  assert.doesNotMatch(text, /\d+%/u);
});
