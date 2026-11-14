import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReminderDrafts, dedupeDrafts, reconcileReminders, type ReminderProjectFacts } from '../reminder-engine';
import { reminderPolicyForStage } from '../stage-reminder-policies';

const now = new Date('2026-11-14T10:00:00+08:00');
const policy = reminderPolicyForStage('utilities')!;

function facts(overrides: Partial<ReminderProjectFacts> = {}): ReminderProjectFacts {
  return {
    enterpriseId: '1454', projectId: '101', projectName: '测试工地',
    projectStatus: 'active', constructionStageKey: 'utilities', stageName: '水电',
    stageEventId: '501', stageEnteredAt: '2026-11-13T09:00:00+08:00',
    schedule: { available: true, version: 3, nodes: [{
      key: 'utilities_bath', stageId: 'utilities', roomId: '9', roomName: '卫生间',
      plannedStart: '2026-11-10', plannedEnd: '2026-11-20', color: 'yellow', completion: 'in_progress',
    }] },
    pending: { ownerConfirmations: [], designerReviews: [], workerMissingMaterials: [], managerTodos: [] },
    issues: [], lastRecordAt: '2026-11-13T12:00:00+08:00',
    recipients: { owner: ['1'], designer: ['2'], worker: ['3'], boss: ['4'], manager: ['5'] },
    ...overrides,
  };
}

test('stage entry creates one deduplicated reminder per authorized recipient', () => {
  const first = buildReminderDrafts(facts(), policy, now);
  const second = buildReminderDrafts(facts(), policy, now);
  assert.deepEqual(first.map(item => item.dedupeKey).sort(), second.map(item => item.dedupeKey).sort());
  const stage = first.filter(item => item.triggerType === 'stage_entered');
  assert.deepEqual(stage.map(item => item.targetRole).sort(), ['designer', 'manager', 'owner', 'worker']);
  for (const item of stage) assert.equal(item.status, 'pending');
  assert.equal(new Set(first.map(item => item.reminderId)).size, first.length);
});

test('a missing plan never produces precise due or stage-ending reminders', () => {
  const drafts = buildReminderDrafts(facts({ schedule: { available: false, version: null, nodes: [] } }), policy, now);
  assert.deepEqual(drafts.map(item => item.triggerType), ['stage_entered', 'stage_entered', 'stage_entered', 'stage_entered']);
});

test('no record means unknown, not stalled', () => {
  assert.ok(!buildReminderDrafts(facts({ lastRecordAt: null }), policy, now).some(item => item.triggerType === 'data_stale'));
  const stale = buildReminderDrafts(facts({ lastRecordAt: '2026-11-01T12:00:00+08:00' }), policy, now);
  assert.equal(stale.filter(item => item.triggerType === 'data_stale').length, 2);
  assert.equal(new Set(stale.filter(item => item.triggerType === 'data_stale').map(item => item.dedupeKey.split(':').at(-1))).size, 1);
});

test('pending items are role addressed and never claim they are read or promised', () => {
  const drafts = buildReminderDrafts(facts({ pending: {
    ownerConfirmations: [{ id: 'c1', title: '确认客厅点位', createdAt: '2026-11-14T08:00:00+08:00' }],
    designerReviews: [{ id: 'd1', title: '核对厨房图纸', createdAt: '2026-11-14T08:00:00+08:00' }],
    workerMissingMaterials: [{ id: 'w1', title: '补拍卫生间管线照片', createdAt: '2026-11-14T08:00:00+08:00' }],
    managerTodos: [{ id: 'm1', title: '安排隐蔽前核对', createdAt: '2026-11-14T08:00:00+08:00' }],
  } }), policy, now);
  const byRole = Object.fromEntries(drafts.filter(item => item.triggerType !== 'stage_entered').map(item => [item.targetRole, item]));
  assert.equal(byRole.owner.relatedTaskId, 'c1');
  assert.equal(byRole.designer.relatedTaskId, 'd1');
  assert.equal(byRole.worker.relatedTaskId, 'w1');
  assert.equal(byRole.manager.relatedTaskId, 'm1');
  for (const item of Object.values(byRole)) assert.match(item.body, /不代表对方已读、已承诺或已完成/u);
});

test('project, stage and permission changes cancel or expire pending reminders', () => {
  const drafts = buildReminderDrafts(facts(), policy, now);
  const existing = drafts.map(item => ({ reminderId: item.reminderId, dedupeKey: item.dedupeKey, stageId: item.stageId,
    targetRole: item.targetRole, targetUserId: item.targetUserId, status: 'pending' as const }));
  const stageChanged = reconcileReminders({ facts: facts({ constructionStageKey: 'masonry_carpentry', stageName: '泥木' }),
    current: [], existing });
  assert.ok(stageChanged.length > 0);
  assert.ok(stageChanged.every(item => item.status === 'expired' && item.reason === 'stage_changed'));
  const revoked = reconcileReminders({ facts: facts({ recipients: { owner: [], designer: ['2'], worker: ['3'], boss: [], manager: ['5'] } }),
    current: [], existing });
  assert.ok(revoked.some(item => item.reason === 'permission_revoked'));
  const paused = reconcileReminders({ facts: facts(), current: drafts, existing,
    pausedPrefixes: ['1454:101:stage_entered'] });
  assert.ok(paused.some(item => item.status === 'paused' && item.reason === 'paused'));
});

test('delivery failure remains retryable while the condition still exists', () => {
  const drafts = buildReminderDrafts(facts(), policy, now);
  const existing = drafts.map(item => ({ reminderId: item.reminderId, dedupeKey: item.dedupeKey, stageId: item.stageId,
    targetRole: item.targetRole, targetUserId: item.targetUserId, status: 'failed' as const }));
  assert.deepEqual(reconcileReminders({ facts: facts(), current: drafts, existing }), []);
  assert.deepEqual(dedupeDrafts([...drafts, ...drafts]).length, drafts.length);
});

test('only a real plan or issue breach reaches the company boss', () => {
  const ordinary = buildReminderDrafts(facts(), policy, now);
  assert.ok(!ordinary.some(item => item.targetRole === 'boss'));
  const overdue = buildReminderDrafts(facts({ schedule: { available: true, version: 3, nodes: [{
    key: 'utilities_bath', stageId: 'utilities', roomId: '9', roomName: '卫生间',
    plannedStart: '2026-11-01', plannedEnd: '2026-11-09', color: 'red', completion: 'in_progress',
  }] } }), policy, now);
  const boss = overdue.filter(item => item.targetRole === 'boss');
  assert.equal(boss.length, 1);
  assert.equal(boss[0].triggerType, 'plan_node_overdue');
  assert.equal(boss[0].triggerEvidence.subject, 'plan:utilities_bath:2026-11-09');
  assert.match(boss[0].body, /公司介入/u);
});

test('an issue without an agreed deadline never escalates to the boss', () => {
  const draft = buildReminderDrafts(facts({ issues: [{ id: 'i1', title: '墙面空鼓', status: 'awaiting_rectification',
    updatedAt: '2026-11-01T00:00:00+08:00', dueAt: null }] }), policy, now);
  assert.ok(!draft.some(item => item.targetRole === 'boss'));
  const real = buildReminderDrafts(facts({ issues: [{ id: 'i1', title: '墙面空鼓', status: 'awaiting_rectification',
    updatedAt: '2026-11-01T00:00:00+08:00', dueAt: '2026-11-08' }] }), policy, now);
  assert.ok(real.some(item => item.targetRole === 'boss' && item.triggerType === 'issue_overdue'));
});

test('quiet hours shift rather than drop a reminder', () => {
  const night = new Date('2026-11-14T22:30:00+08:00');
  const drafts = buildReminderDrafts(facts(), policy, night);
  for (const item of drafts) {
    const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })
      .formatToParts(new Date(item.scheduledAt));
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    assert.ok(hour >= 8 && hour < 21, 'reminder scheduled in quiet hours: ' + item.scheduledAt);
  }
});
